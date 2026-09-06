import { requireThat,slugOf } from './invariants.mjs'

export function catalogEntries(skills) {
  const entries=[]
  const walk=(object,path=[])=>{
    if (!object || typeof object!=='object' || Array.isArray(object)) return
    for (const [key,value] of Object.entries(object)) {
      if (key.includes('@') && value && typeof value==='object') {
        requireThat(typeof value.pinned==='boolean', `${path.join('.')}.${key}: pinned boolean is required`)
        entries.push({key,adapter:path[0]?.startsWith('claude')?'claude_local':'codex_local',...value})
      } else walk(value,[...path,key])
    }
  }
  walk(skills)
  requireThat(new Set(entries.map(e=>`${e.adapter}:${e.key}:${e.sourceId??''}`)).size===entries.length, 'Duplicate skill catalog identity')
  return entries
}
export function installPlan(skills, installed=[]) {
  return catalogEntries(skills).filter(entry=>entry.pinned===true).filter(entry=>!installed.some(row=>row.key===entry.key && row.sourceId===entry.sourceId && row.adapter===entry.adapter && row.pinMatches===true)).map(entry=>({kind:'install-pinned-plugin',entry}))
}
export async function installPinned(operations, host, emit) {
  for (const op of operations) {
    requireThat(op.kind==='install-pinned-plugin' && op.entry.pinned===true, 'Unpinned catalog entries are available only; never installed')
    emit({write:op})
    await host.installPinned(op.entry)
  }
}
export function validateGrants(contract) {
  const entries=catalogEntries(contract.skills)
  for (const a of contract.agents) {
    for (const [field,adapter] of [['claudePlugins','claude_local'],['codexPlugins','codex_local']]) {
      const grants=a.grants[field]
      requireThat(Array.isArray(grants) && new Set(grants).size===grants.length, `${a.slug}: grants must be unique arrays`)
      requireThat(!grants.length || a.adapterType===adapter, `${a.slug}: cross-adapter grants are forbidden`)
      for (const key of grants) requireThat(entries.some(e=>e.adapter===adapter && e.key===key && e.pinned===true), `${a.slug}: grant ${key} must refer to an applicable pinned catalog entry`)
      if (adapter==='codex_local' && a.adapterType===adapter) requireThat(JSON.stringify([...grants].sort())===JSON.stringify(entries.filter(e=>e.adapter===adapter && e.pinned).map(e=>e.key).sort()), 'Codex company-wide grants cannot narrow the pinned set')
    }
  }
}
export function renderSkillHomes(contract, instanceRoot, companyId, ids) {
  const files={},adapterLocal={},agentEnv={}
  for (const a of contract.agents.filter(a=>a.adapterType==='claude_local')) {
    requireThat(ids[a.slug], `${a.slug}: generated id is required for a config directory`)
    const dir=`${instanceRoot}/workspaces/${ids[a.slug]}/.claude`
    adapterLocal[a.slug]={...a.adapterLocal,claudeCodePlugins:[...a.grants.claudePlugins]}
    files[`${dir}/settings.json`]=JSON.stringify({enabledPlugins:Object.fromEntries(a.grants.claudePlugins.map(key=>[key,true]))},null,2)+'\n'
    agentEnv[a.slug]={CLAUDE_CONFIG_DIR:dir,CLAUDE_CODE_PLUGIN_CACHE_DIR:contract.instance.home.replace(/^~/,instanceRoot.split('/.paperclip/')[0]) .replace(/\/.paperclip$/, '/.claude/plugins')}
  }
  return {files,adapterLocal,agentEnv,codex:{home:`${instanceRoot}/companies/${companyId}/codex-home`,skills:`${instanceRoot}/companies/${companyId}/codex-home/skills`,authLink:`${instanceRoot}/companies/${companyId}/codex-home/auth.json`,seed:'~/.codex; auth link only if present; Ryan must run codex login',plugins:catalogEntries(contract.skills).filter(e=>e.adapter==='codex_local' && e.pinned).map(e=>e.key)}}
}
export function verifySkills(contract, homes, host,live) {
  const materialization=[]
  if(live)for(const a of contract.agents.filter(a=>a.adapterType==='claude_local')){
    const actual=live.agents.find(b=>slugOf(b)===a.slug)?.adapterConfig?.env??{}
    for(const [key,value]of Object.entries(homes.agentEnv[a.slug]))materialization.push({kind:'claude-env',slug:a.slug,key,matches:(actual[key]?.value??actual[key])===value})
  }
  for (const path of Object.keys(homes.files)) {
    materialization.push({kind:'claude-settings',path,matches:host.readText(path)===homes.files[path]})
    const runtime=path.replace(/\/settings.json$/,'/runtime-skills')
    materialization.push({kind:'claude-runtime-skills',path:runtime,exists:host.exists(runtime),entries:host.entries(runtime)})
  }
  materialization.push({kind:'codex-company-skills',path:homes.codex.skills,exists:host.exists(homes.codex.skills),entries:host.entries(homes.codex.skills)})
  // Auth bytes are never opened. Presence and symlink metadata prove no login.
  materialization.push({kind:'codex-auth-link',path:homes.codex.authLink,symlink:host.isSymlink(homes.codex.authLink),exists:host.exists(homes.codex.authLink),prerequisite:'Ryan: codex login before the first authorized run'})
  const injectionFailures=host.runLogs().flatMap(({path,text})=>text.split(/\r?\n/).flatMap((line,index)=>line.includes('Failed to inject')?[{path,line:index+1,message:'Failed to inject (log content withheld)'}]:[]))
  const available=catalogEntries(contract.skills).filter(e=>!e.pinned).map(({key,adapter,version,sourceId,requiresOAuth})=>({key,adapter,version,sourceId,requiresOAuth,status:'available; never installed by the provisioner'}))
  return {materialization,injectionFailures,available,executionProven:false,auth:'OAuth is performed by Ryan; credential contents are never inspected'}
}
