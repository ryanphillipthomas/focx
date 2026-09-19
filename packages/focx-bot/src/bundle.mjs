import { requireThat, tighter, tighterDaily, bypassFlag, REGISTRY_SKILLS, slugOf } from './invariants.mjs'

// Paperclip's portable YAML dialect accepts a JSON scalar after each key,
// including objects and arrays. A whole JSON document is NOT a YAML document
// to its installed parser. Keep the top-level keys in its key: value syntax.
export const yaml = object => Object.entries(object).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n'
export const markdown = (meta,body='') => `---\n${yaml(meta)}---\n\n${body.trim()}\n`

// Read the restricted block/JSON-scalar dialect emitted by Paperclip's own
// renderYamlBlock (2026.831.1). Fail closed on duplicate keys or unconsumed
// syntax; never silently drop an export field while applying the overlay.
export function parseYaml(raw) {
  requireThat(typeof raw === 'string', 'Expected portable YAML text')
  const lines = raw.split(/\r?\n/).filter(s => s.trim() && !s.trimStart().startsWith('#')).map(s => ({indent:s.match(/^ */)[0].length,text:s.trim()}))
  const scalar = s => {
    if (s === '~') return null
    if (/^(true|false|null|-?\d+(\.\d+)?)$/.test(s) || /^["\[{]/.test(s)) {
      try { return JSON.parse(s) } catch { throw new Error('Unsupported portable YAML scalar') }
    }
    requireThat(!/^[!&*|'">]/.test(s), 'Unsupported YAML feature in native bundle')
    return s
  }
  let cursor=0
  const block = indent => {
    requireThat(lines[cursor]?.indent === indent, 'Malformed portable YAML indentation')
    const array = lines[cursor].text.startsWith('-')
    const out = array ? [] : {}
    while (cursor < lines.length && lines[cursor].indent >= indent) {
      const l=lines[cursor++]
      requireThat(l.indent === indent, 'Unconsumed portable YAML block')
      if (array) {
        requireThat(l.text === '-' || l.text.startsWith('- '), 'Mixed YAML array and map')
        const tail=l.text.slice(1).trim()
        out.push(tail ? scalar(tail) : block(indent+2))
      } else {
        const at=l.text.indexOf(':'); requireThat(at>0, 'Malformed portable YAML key')
        const key=l.text.slice(0,at),tail=l.text.slice(at+1).trim()
        requireThat(!Object.hasOwn(out,key) && !['__proto__','constructor','prototype'].includes(key), 'Duplicate or unsafe portable YAML key')
        out[key]=tail ? scalar(tail) : (cursor<lines.length && lines[cursor].indent>indent ? block(indent+2) : {})
      }
    }
    return out
  }
  if (!lines.length) return {}
  const result=block(0)
  requireThat(cursor===lines.length && !Array.isArray(result), 'Expected complete portable YAML map')
  return result
}
export function parseMarkdown(raw) {
  const m=raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)
  return m ? {meta:parseYaml(m[1]),body:m[2].trim()} : {meta:{},body:raw.trim()}
}
export const INCLUDE = {company:true,agents:true,projects:true,skills:true,issues:false}
export function composeEnv(contract, agent) {
  return {...contract.env.common,...(agent.adapterType==='claude_local'?contract.env.claudeAuth:{}),...(agent.git==='write'?contract.env.gitWrite:{})}
}
export function overlayAgent(agent, live = {}) {
  const adapterConfig = structuredClone(live.adapterConfig ?? {})
  const runtimeConfig = structuredClone(live.runtimeConfig ?? {})
  runtimeConfig.heartbeat = {...runtimeConfig.heartbeat,...agent.run.heartbeat,maxTurnContinuation:{enabled:false},maxDailyRuns:tighterDaily(runtimeConfig.heartbeat?.maxDailyRuns,agent.limits.maxDailyRuns)}
  const mode=adapterConfig.permissionMode ?? adapterConfig.acpPermissionMode
  const unattended=adapterConfig.nonInteractivePermissions ?? adapterConfig.acpNonInteractivePermissions
  Object.assign(adapterConfig,{engine:'acp',permissionMode:mode==='deny-all'?'deny-all':agent.executionPermissions.permissionMode,nonInteractivePermissions:unattended==='fail'?'fail':agent.executionPermissions.nonInteractivePermissions,[bypassFlag(agent)]:false,timeoutSec:tighter(adapterConfig.timeoutSec,agent.limits.timeoutSec)})
  if (agent.limits.maxTurnsPerRun !== null) adapterConfig.maxTurnsPerRun=tighter(adapterConfig.maxTurnsPerRun,agent.limits.maxTurnsPerRun)
  // Never keep a stray other-lane bypass enabled in an old export.
  for (const key of ['dangerouslySkipPermissions','dangerouslyBypassApprovalsAndSandbox']) if (key in adapterConfig) adapterConfig[key]=false
  return {adapterConfig,runtimeConfig,permissions:{...agent.permissions}}
}
export function renderAdapter(contract, agent) {
  const config={model:agent.model,[contract.adapters[agent.adapterType].reasoningKey]:agent.reasoning,...(contract.workspaces[agent.workspace].workspaceStrategy?{workspaceStrategy:contract.workspaces[agent.workspace].workspaceStrategy}:{})}
  config.env=Object.fromEntries(Object.entries(composeEnv(contract,agent)).filter(([,v])=>typeof v==='string'))
  // Any role declaring worktree-local delivery gets the launcher, not just QA.
  if (agent.adapterLocal?.permissionDelivery?.endsWith('-worktree-local')) config.agentCommand='node tools/qa-claude-agent-acp/index.mjs'
  return overlayAgent(agent,{adapterConfig:config}).adapterConfig
}
export function renderFreshBundle(contract, sourceFiles) {
  const files={'COMPANY.md':markdown({name:contract.company.name})}, agents={}
  for (const a of contract.agents) {
    const source=sourceFiles[a.slug]
    requireThat(source?.['AGENTS.md']?.trim(), `${a.slug}: missing instruction source`)
    for (const [path,content] of Object.entries(source)) files[`agents/${a.slug}/${path}`]=path==='AGENTS.md'?markdown({slug:a.slug,name:a.name,title:a.title,skills:REGISTRY_SKILLS},content):content
    const env=Object.fromEntries(Object.entries(composeEnv(contract,a)).filter(([,v])=>v && typeof v==='object').map(([key,v])=>[key,{kind:'secret',requirement:'optional',default:'',description:`Paperclip secret name: ${v.secret}`}]))
    agents[a.slug]={role:a.role,icon:a.icon,permissions:a.permissions,adapter:{type:a.adapterType,config:renderAdapter(contract,a)},runtime:overlayAgent(a).runtimeConfig,...(Object.keys(env).length?{inputs:{env}}:{})}
  }
  const project=contract.project,slug=slugOf(project)
  files[`projects/${slug}/PROJECT.md`]=markdown({name:project.name,description:null,owner:null})
  const projects={[slug]:{status:'backlog',workspaces:Object.fromEntries(project.workspaces.map(w=>[w.name,{...w,repoRef:w.repoRef??null,defaultRef:w.defaultRef??null,visibility:null}]))}}
  files['.paperclip.yaml']=yaml({schemaVersion:7,agents,projects})
  return {files}
}
export function bundleExtension(bundle) {
  const key=bundle.paperclipExtensionPath ?? '.paperclip.yaml'
  requireThat(Object.hasOwn(bundle.files,key), 'Native export is missing its .paperclip.yaml')
  const extension=parseYaml(bundle.files[key])
  requireThat(extension.schemaVersion === 7, 'Expected native bundle schemaVersion 7')
  return {key,extension}
}
export function secretInputs(bundle) {
  const {extension}=bundleExtension(bundle)
  return ['agents','projects'].flatMap(kind=>Object.entries(extension[kind]??{}).flatMap(([slug,entry])=>Object.entries(entry.inputs?.env??{}).filter(([,v])=>v.kind==='secret').map(([key,v])=>({kind:'secret',scope:kind,slug,key,requirement:v.requirement??'optional',description:v.description??null}))))
}
export function importOperation(bundle, target) {
  return {method:'POST',path:'/api/companies/import',body:{source:{type:'inline',files:bundle.files,expectedFileCount:Object.keys(bundle.files).length},include:INCLUDE,target,pauseAutomations:true}}
}

export const RESERVED_SKILL_PREFIX = 'paperclipai/paperclip/'
// Native blobs are content addressed; embeddedAssets.ownedBy holds categories,
// not paths. Remove only assets referenced by removed files and no retained text,
// preserving shared blobs and attachment references in the extension/manifest.
export function removeSkillFiles(bundle, paths, removeEntry) {
  const removed=paths.map(path=>bundle.files[path]).filter(v=>typeof v==='string')
  for(const path of paths)delete bundle.files[path]
  if(bundle.manifest?.skills)bundle.manifest.skills=bundle.manifest.skills.filter(s=>!removeEntry(s))
  const {key,extension}=bundleExtension(bundle)
  const texts=Object.entries(bundle.files).filter(([p,v])=>p!==key && typeof v==='string')
  const references=(text,id)=>text.toLowerCase().includes('/api/assets/'+id.toLowerCase()+'/content')
  const removedHashes=new Set()
  for(const index of [extension,bundle.manifest].filter(Boolean))if(index.embeddedAssets) {
    index.embeddedAssets=index.embeddedAssets.filter(asset=>{
      if(!removed.some(text=>references(text,asset.assetId)))return true
      const retained=texts.filter(([,text])=>references(text,asset.assetId))
      const extensionText=JSON.stringify({...extension,blobs:undefined,embeddedAssets:undefined})
      if(!retained.length && !references(extensionText,asset.assetId)){removedHashes.add(asset.sha256);return false}
      if(asset.ownedBy?.includes('skills') && !retained.some(([p])=>p.startsWith('skills/')))asset.ownedBy=asset.ownedBy.filter(owner=>owner!=='skills')
      return true
    })
  }
  const retainedMetadata=JSON.stringify([extension,bundle.manifest].filter(Boolean).map(index=>({...index,blobs:undefined})))
  for(const hash of removedHashes)if(!retainedMetadata.includes(hash) && !texts.some(([p,text])=>p!=='blobs/'+hash && text.includes(hash))) {
    delete bundle.files['blobs/'+hash]
    for(const index of [extension,bundle.manifest].filter(Boolean))if(index.blobs)index.blobs=index.blobs.filter(blob=>blob.sha256!==hash)
  }
  bundle.files[key]=yaml(extension)
}
