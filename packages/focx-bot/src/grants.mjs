import { join, resolve, dirname } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { loadRoleSource } from './roles.mjs'
import { mergeSettings, COMMAND } from '../../../tools/qa-claude-agent-acp/index.mjs'
import { readSnapshot, idMap } from './api.mjs'
import { requireThat, slugOf } from './invariants.mjs'
import { instanceRoot, defaultHost } from './host.mjs'
import { catalogEntries, renderSkillHomes } from './skills.mjs'
import { readPluginInventory, readClaudePluginRecords, pluginReadbackMatches, metadataReadable } from './plugins.mjs'

export const F1 = 'codex_local: reported only — declared permissions and plugin sets do not bound Codex behavior (F1); the Claude lane is bounded by its settings and permission rules.'
export const F10 = "F10 resolved (rev 2.7): the launcher resolves QA through Paperclip by url-key and company; no ids in source."
const sorted=values=>[...new Set(values)].sort()
const strings=value=>Array.isArray(value)&&value.every(v=>typeof v==='string')
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
const difference=(left,right)=>sorted(left.filter(v=>!right.includes(v)))

// This detects H7's ineffective TEMP rule, not arbitrary permission semantics.
export function deadTempRules(rules,tempDir) {
  return rules.filter(rule=>rule==='Write(/tmp/**)' && tempDir && !resolve(tempDir).startsWith('/tmp/') && resolve(tempDir)!=='/tmp').map(rule=>({rule,namedPath:'/tmp/**',tempDir,reason:`${rule} names /tmp/**; the runtime temp directory is ${tempDir}. That path is outside /tmp/, so this rule cannot match runtime temp writes (H7).`}))
}

// Only explicit [plugins."key@marketplace"] enabled booleans are evidence.
// Other TOML forms are reported as unparsed, never inferred from cache presence.
export function readCodexEnablement(host,home) {
  const path=join(home,'config.toml'),text=metadataReadable(host,path)?host.readText(path):null
  const entries=[],unparsed=[]
  let section=null
  for(const [index,line]of (text??'').split(/\r?\n/).entries()){
    if(/^\s*\[/.test(line)){
      const match=line.match(/^\s*\[plugins\.(?:"([^"\\]+)"|'([^']+)'|([\w-]+))\]\s*(?:#.*)?$/)
      section=match?(match[1]??match[2]??match[3]):null
      if(!match && /^\s*\[\s*plugins\b/.test(line))unparsed.push(index+1)
      continue
    }
    if(section && /^\s*enabled\s*=/.test(line)){
      const match=line.match(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/)
      if(match)entries.push({key:section,enabled:match[1]==='true',line:index+1})
      else unparsed.push(index+1)
    }else if(/^\s*plugins\s*[.=]/.test(line))unparsed.push(index+1)
  }
  const duplicate=entries.some((r,i)=>entries.slice(0,i).some(p=>p.key===r.key))
  return {path,present:text!==null,entries,unparsed,duplicate,complete:text!==null&&!unparsed.length&&!duplicate}
}

// Mirror only the five vendor baseline rules accepted by mergeSettings (:26).
export function renderPermissions(local,cwd) {
  return mergeSettings({permissions:{defaultMode:'default',allow:vendorBaseline(cwd)}},local.permissionsAllow??[],cwd,local.permissionsDeny).permissions
}

export const vendorBaseline = cwd => ['Bash(curl:*)','Bash(env:*)','Bash(env)',`Bash(${cwd}/scripts/paperclip-issue-update.sh:*)`,`Bash(${cwd}/scripts/paperclip:*)`]

// Paperclip keeps each company's project checkouts under
// <instanceRoot>/projects/<companyId>/<projectId>/<checkout>/ and per-issue
// worktrees under <checkout>/.paperclip/worktrees/<issue>/ — the location the
// QA launcher enforces (tools/qa-claude-agent-acp/index.mjs:36-38). Bounded
// walk, scoped to the live company; no recursion into checkouts.
export function readWorktreeSettings(host,root,companyId) {
  const rows=[]
  const dirs=p=>metadataReadable(host,p)&&host.isDirectory(p)?host.entries(p).filter(n=>n!=='.'&&n!=='..'&&!n.includes('/')).sort().map(n=>join(p,n)).filter(d=>metadataReadable(host,d)&&host.isDirectory(d)):[]
  for(const project of dirs(join(root,'projects',companyId)))for(const checkout of dirs(project))for(const cwd of dirs(join(checkout,'.paperclip','worktrees'))){
    const settingsPath=join(cwd,'.claude','settings.local.json')
    if(host.exists(settingsPath))rows.push({path:settingsPath,cwd,permissions:metadataReadable(host,settingsPath)?host.readJson(settingsPath)?.permissions:null})
  }
  return rows
}

// The mandated pilot source validator reads repository .focx instruction files.
// Runtime host readers above never open plugin payloads, auth or catalogs.
export function grantReport(contract,live,homes,host,{pilotManifest=loadRoleSource().manifest,instanceRoot:root=dirname(dirname(dirname(homes.codex.home)))}={}) {
  const lines=[`declared: ${F1}`, 'observed on disk: effect evidence is reported by verifySkills: runtime-skills/ presence and run-log injection failures; grants checks metadata only.'],agents=[]
  const worktrees=readWorktreeSettings(host,root,live.company.id)
  const inventory=readPluginInventory(contract,homes.codex.home,{metadataOnly:true,host,userHome:host.userHome})
  const claudeIndex=readClaudePluginRecords(host,host.userHome),codex=readCodexEnablement(host,homes.codex.home),pins=catalogEntries(contract.skills).filter(e=>e.pinned)
  for(const a of contract.agents){
    const b=live.agents.find(b=>slugOf(b)===a.slug),diffs=[]
    const say=(label,surface,data)=>lines.push(`${label}: ${a.slug} ${surface} ${JSON.stringify(data)}`)
    const diff=(surface,kind,key,detail)=>{
      diffs.push({surface,kind,key,detail})
      say(surface.startsWith('rendered')?'rendered':surface.startsWith('declared')?'declared':'observed on disk','DIFF',{surface,kind,key,detail})
    }
    const compare=(surface,declared,enabled)=>{
      for(const key of difference(declared,enabled))diff(surface,'granted-but-not-enabled',key)
      for(const key of difference(enabled,declared))diff(surface,'enabled-but-not-granted',key)
    }
    say('declared','grants',a.grants)
    if(!b || b.adapterType!==a.adapterType)diff('live adapter','adapter-mismatch',a.slug)
    const field=a.adapterType==='claude_local'?'claudePlugins':'codexPlugins',granted=a.grants[field]
    let enabled=[]
    if(a.adapterType==='claude_local'){
      const path=join(homes.agentEnv[a.slug].CLAUDE_CONFIG_DIR,'settings.json')
      const rendered=JSON.parse(homes.files[path]).enabledPlugins,local=homes.adapterLocal[a.slug]
      say('rendered','settings.json enabledPlugins',rendered)
      say('rendered','adapterLocal',local)
      compare('rendered settings',granted,Object.keys(rendered).filter(k=>rendered[k]===true))
      compare('rendered adapterLocal',granted,local.claudeCodePlugins)
      const settings=metadataReadable(host,path)?host.readJson(path):null,actual=settings?.enabledPlugins
      say('observed on disk',path,{enabledPlugins:actual??null})
      if(!object(actual)||Object.values(actual).some(v=>typeof v!=='boolean'))diff('settings','metadata-unavailable',path)
      const onDisk=object(actual)?Object.keys(actual).filter(k=>actual[k]===true):[]
      compare('settings',granted,onDisk)
      enabled=sorted(onDisk)
      const sourceAgent=pilotManifest?.agents.find(s=>s.roleKey===a.roleKey)
      say('declared','adapterLocal',a.adapterLocal)
      say('declared','.focx/agents.json adapterLocal',sourceAgent?.adapterLocal??null)
      if(!isDeepStrictEqual(a.adapterLocal,sourceAgent?.adapterLocal))diff('declared sources','declared-source-divergence',a.roleKey)
      if(a.adapterLocal.permissionDelivery?.endsWith('-worktree-local')){
        const adapter=b?.adapterConfig??{},env=adapter.env??{}
        const present=Object.fromEntries(['CLAUDE_CONFIG_DIR','CLAUDE_CODE_PLUGIN_CACHE_DIR'].map(key=>[key,Object.hasOwn(env,key)]))
        // API observations carry the required output label with explicit provenance.
        say('observed on disk','live API readSnapshot delivery (API metadata)',{agentCommand:adapter.agentCommand??null,envPresent:present,valueComparison:'verifySkills claude-env compares values against renderSkillHomes agentEnv'})
        if(adapter.agentCommand!==COMMAND)diff('live API delivery','delivery-command-missing','agentCommand',{expected:COMMAND})
        for(const [key,exists]of Object.entries(present))if(!exists)diff('live API delivery','delivery-env-missing',key)
        say('declared','launcher identity',{urlKey:a.roleKey,adapterType:'claude_local',company:'live company'})
        say('observed on disk','live API readSnapshot identity (API metadata)',{urlKey:b?.urlKey,adapterType:b?.adapterType,companyId:b?.companyId})
        // Compare each agent against its OWN declared role, not one role's literal.
        if(b?.urlKey!==a.roleKey || b?.adapterType!=='claude_local' || b?.companyId!==live.company.id)diff('live API delivery','delivery-identity-mismatch',a.roleKey)
        lines.push(`declared: ${F10}`)
        const placeholder=join(root,'projects',live.company.id,'<projectId>','<checkout>','.paperclip','worktrees',`<${a.roleKey}-worktree>`)
        const permissions=renderPermissions(a.adapterLocal,placeholder)
        say('rendered',`${a.roleKey} settings.local.json permissions`,{cwd:placeholder,...permissions})
        for(const dead of deadTempRules(permissions.allow,host.tempDir))diff('rendered permissions','dead-rule',dead.rule,dead.reason)
        if(!worktrees.length)lines.push(`observed on disk: no ${a.roleKey} worktree settings yet — unobserved until an authorised run (FB8)`)
        // A worktree carries the rules of the one role that ran there. With more than
        // one worktree-local role, comparing every role against every worktree makes
        // each role's own worktree look wrong to the others. So attribute the file
        // first, and skip the ones that demonstrably belong to another declared role.
        // A worktree matching no declared role is still compared here, so an
        // unrecognised settings file cannot pass silently.
        const localRoles=contract.agents.filter(x=>x.adapterLocal?.permissionDelivery?.endsWith('-worktree-local'))
        const ownerOf=row=>localRoles.find(r=>isDeepStrictEqual(sorted(renderPermissions(r.adapterLocal,row.cwd).allow),sorted(row.permissions?.allow??[])))
        for(const row of worktrees){
          const owner=ownerOf(row)
          if(owner&&owner.roleKey!==a.roleKey)continue
          const expected=renderPermissions(a.adapterLocal,row.cwd)
          const observed={allow:strings(row.permissions?.allow)?row.permissions.allow:null,deny:strings(row.permissions?.deny)?row.permissions.deny:null,defaultMode:typeof row.permissions?.defaultMode==='string'?row.permissions.defaultMode:null}
          // Paperclip's writer keeps any pre-existing defaultMode other than dontAsk (acpx-engine/execute.js:815-816),
          // so a worktree can carry bypassPermissions; the launcher refuses anything but 'default' (mergeSettings) and so does this check.
          if(observed.defaultMode!=='default')diff('worktree permissions','permission-mode-unexpected',row.path,{defaultMode:observed.defaultMode,expected:'default',launcher:'mergeSettings refuses any other mode'})
          // Paperclip's writer seeds every Claude worktree with the five vendor rules, defaultMode 'default' and no deny
          // before the launcher merges QA's rules: that file is a pre-launch baseline, evidence of nothing.
          if(observed.defaultMode==='default'&&observed.allow&&isDeepStrictEqual(sorted(observed.allow),sorted(vendorBaseline(row.cwd)))&&!(observed.deny??[]).length){say('observed on disk',`${a.roleKey} settings.local.json pre-launch baseline (Paperclip writer only; launcher has not merged rules) — not evidence`,{path:row.path});continue}
          say('observed on disk',`${a.roleKey} settings.local.json`,{path:row.path,permissions:observed})
          for(const field of ['allow','deny']){
            if(observed[field]===null)diff('worktree permissions','metadata-unavailable',row.path,field)
            // Vendor rules are rendered delivery plumbing; compare agent rules
            // plus that required baseline, so the five vendor rules are not extras.
            for(const rule of difference(expected[field],observed[field]??[]))diff('worktree permissions','permission-missing',rule,{path:row.path,field})
            for(const rule of difference(observed[field]??[],expected[field]))diff('worktree permissions','permission-extra',rule,{path:row.path,field})
          }
          for(const dead of deadTempRules(observed.allow??[],host.tempDir))diff('worktree permissions','dead-rule',dead.rule,dead.reason)
        }
      }
      say('observed on disk','Claude installation index',{path:claudeIndex.path,available:claudeIndex.available})
      if(!claudeIndex.available)diff('installed plugins','metadata-unavailable',claudeIndex.path)
    }else{
      say('rendered','company plugin set',{home:homes.codex.home,plugins:homes.codex.plugins})
      compare('rendered company plugin set',granted,homes.codex.plugins)
      say('observed on disk','Codex plugin enablement',codex)
      enabled=sorted(codex.entries.filter(e=>e.enabled).map(e=>e.key))
      if(!codex.complete)diff('config.toml','metadata-unavailable',codex.path,'Enablement is unknown where absent or unparsed; cache presence does not imply enablement.')
      for(const row of codex.entries)if(!row.enabled&&granted.includes(row.key))diff('config.toml','granted-but-not-enabled',row.key)
      for(const key of difference(enabled,granted))diff('config.toml','enabled-but-not-granted',key)
      const unknown=granted.filter(key=>!codex.entries.some(e=>e.key===key))
      say('observed on disk','enablement unknown (no explicit boolean)',unknown)
    }
    const installed=inventory.filter(r=>r.adapter===a.adapterType)
    for(const row of installed)say('observed on disk','installed plugin metadata',row)
    for(const key of sorted([...enabled,...(a.adapterType==='codex_local'?granted:[])])){
      const rows=installed.filter(r=>r.key===key&&r.installed)
      if(!rows.length){if(enabled.includes(key))diff('installed plugins','enabled-but-not-installed',key);continue}
      const pin=pins.find(e=>e.adapter===a.adapterType&&e.key===key)
      if(pin && !rows.some(r=>pluginReadbackMatches(pin,r)))diff('installed plugins','installed-at-wrong-pin',key,{expected:pin.contentHash?{contentHash:pin.contentHash}:pin.pin==='manifestSha'?{sourceSha:pin.source?.sha}:{version:pin.version,sourceId:pin.sourceId,gitCommitSha:pin.gitCommitSha},note:'No matching installed pin in metadata; absent hash/source evidence is unverified, not a computed content mismatch.'})
    }
    for(const row of installed.filter(r=>r.installed||r.retained)){
      const pin=pins.find(e=>e.adapter===a.adapterType&&e.key===row.key)
      const times=pin?installed.filter(r=>r.installed&&r.key===pin.key&&pluginReadbackMatches(pin,r)).map(r=>r.installedAt).filter(t=>typeof t==='string'&&Number.isFinite(Date.parse(t))).sort((a,b)=>Date.parse(a)-Date.parse(b)):[]
      const expectedInstall=times[0]??null
      if(expectedInstall && Date.parse(row.mtime)>Date.parse(expectedInstall))say('observed on disk','unattributed',{path:row.installPath,mtime:row.mtime,expectedInstall,baseline:'installedAt metadata for the matching pinned version'})
      else if(!expectedInstall)say('observed on disk','mtime baseline unavailable',{path:row.installPath,mtime:row.mtime,expectedInstall:null})
    }
    const fatal=a.adapterType==='claude_local' && diffs.length>0
    say('observed on disk','grant check result',{fatal,findings:diffs.length})
    agents.push({slug:a.slug,adapter:a.adapterType,diffs,fatal})
  }
  return {ok:!agents.some(a=>a.fatal),lines,agents}
}

export function assertGrantReport(report) {
  requireThat(report.ok,'Claude plugin grants or permission metadata mismatch')
}

export async function grants(api,source,options={}) {
  requireThat(options.companyId,'grants requires the generated company id')
  const live=await readSnapshot(api,options.companyId)
  requireThat(live.company.name===(options.expectedName??source.contract.company.name),'Unexpected company name')
  const host=options.host??defaultHost(source.contract)
  const homes=renderSkillHomes(source.contract,options.instanceRoot??instanceRoot(source.contract),options.companyId,idMap(live))
  return grantReport(source.contract,live,homes,host,options)
}
