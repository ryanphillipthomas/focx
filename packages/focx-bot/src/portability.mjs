import { isDeepStrictEqual as same } from 'node:util'
import { requireThat, slugOf,assertInvariants } from './invariants.mjs'
import { approvalDigest } from './digest.mjs'
import { bundleExtension, yaml, overlayAgent, INCLUDE, secretInputs, renderAdapter, composeEnv, parseMarkdown, removeSkillFiles, RESERVED_SKILL_PREFIX } from './bundle.mjs'
import { fresh } from './fresh.mjs'
import { readSnapshot, idMap } from './api.mjs'
import { projectSummary, portableProjects, agentConfigs, renderedClaude, compareRoundTrip, assertRestoredSkills } from './roundtrip.mjs'
import { instanceRoot } from './host.mjs'

// F15: inventory refresh seeds Paperclip's bundled skills before package import
// (installed company-skills.js:4949,2487,2271); never manufacture a commit.
export function stripRestoreSkills(contract,bundle) {
  const result=structuredClone(bundle)
  const reservedFiles=Object.keys(result.files).filter(p=>p.startsWith('skills/'+RESERVED_SKILL_PREFIX))
  result.strippedReservedSkills=[...new Set([
    ...reservedFiles.map(p=>p.split('/').slice(1,4).join('/')),
    ...(result.manifest?.skills??[]).filter(s=>s.key?.startsWith(RESERVED_SKILL_PREFIX)).map(s=>s.key),
  ])].sort()
  removeSkillFiles(result,reservedFiles,s=>s.key?.startsWith(RESERVED_SKILL_PREFIX) || reservedFiles.includes(s.path))
  deduplicateCompanySkills(contract,result)
  return result
}
function comparableSkill(text) {
  const doc=parseMarkdown(text)
  // Native export adds identity only; preserve all other metadata in comparison.
  delete doc.meta.key;delete doc.meta.slug
  if(doc.meta.metadata) {
    delete doc.meta.metadata.skillKey;delete doc.meta.metadata.paperclipSkillKey
    if(doc.meta.metadata.paperclip) {
      delete doc.meta.metadata.paperclip.skillKey;delete doc.meta.metadata.paperclip.slug
      if(!Object.keys(doc.meta.metadata.paperclip).length)delete doc.meta.metadata.paperclip
    }
  }
  return doc
}
function deduplicateCompanySkills(contract,bundle) {
  const paths=Object.keys(bundle.files).filter(p=>p.startsWith('skills/company/'))
  const roots=[...new Set(paths.map(p=>p.split('/').slice(0,4).join('/')))]
  for(const root of roots) {
    const name=root.split('/').at(-1),copies=contract.agents.filter(a=>a.skills.includes(name)).map(a=>'agents/'+a.slug+'/skills/'+name)
    const inventory=prefix=>Object.fromEntries(Object.entries(bundle.files).filter(([p])=>p.startsWith(prefix+'/')).map(([p,text])=>[p.slice(prefix.length+1),p===prefix+'/SKILL.md'?comparableSkill(text):text]))
    requireThat(Object.hasOwn(bundle.files,root+'/SKILL.md') && copies.length>0 && copies.every(copy=>same(inventory(root),inventory(copy))), 'Company skill copy differs from retained agent instruction skill: '+root)
  }
  bundle.deduplicatedCompanySkills=roots.sort()
  removeSkillFiles(bundle,paths,s=>s.key?.startsWith('company/') && roots.some(root=>s.path===root+'/SKILL.md') || paths.includes(s.path))
  requireThat(!(bundle.manifest?.skills??[]).some(s=>s.key?.startsWith('company/')), 'Unmatched company skill manifest entry; refuse silent loss')
}

export function overlayRestore(contract,bundle) {
  portableProjects(contract,bundle)
  const result=stripRestoreSkills(contract,bundle),{key,extension}=bundleExtension(result)
  requireThat(JSON.stringify(Object.keys(extension.agents??{}).sort())===JSON.stringify(contract.agents.map(a=>a.slug).sort()), 'Restore bundle must have the exact contract slug set')
  for (const a of contract.agents) {
    const entry=extension.agents[a.slug]
    requireThat(entry.adapter?.type===a.adapterType, `${a.slug}: restore cannot migrate adapters`)
    const config={...renderAdapter(contract,a),...entry.adapter.config}
    // Native export omits PATH and all system-dependent env. Restore declared
    // plain env from the contract; leave secret inputs unbound for hand entry.
    config.env={...entry.adapter.config?.env,...renderAdapter(contract,a).env}
    for(const [key,v] of Object.entries(config.env))if(v?.type==='secret_ref')delete config.env[key]
    for(const key of ['CLAUDE_CONFIG_DIR','CLAUDE_CODE_PLUGIN_CACHE_DIR'])delete config.env[key]
    const safe=overlayAgent(a,{adapterConfig:config,runtimeConfig:entry.runtime})
    entry.adapter.config=safe.adapterConfig
    entry.runtime=safe.runtimeConfig
    entry.permissions=safe.permissions
    entry.inputs??={};entry.inputs.env??={}
    for(const [key,value] of Object.entries(composeEnv(contract,a)))if(value && typeof value==='object')entry.inputs.env[key]={kind:'secret',requirement:'optional',default:'',description:'Paperclip secret name: '+value.secret}
    for(const input of Object.values(entry.inputs.env))if(input.kind==='secret'){input.requirement='optional';input.default='';delete input.defaultValue}
    // An export can also carry explicit grants. Paused import's creation grant
    // is still revoked by step 2, regardless of this bundle representation.
    entry.permissionGrants=(entry.permissionGrants??[]).filter(g=>g.permissionKey!=='tasks:assign')
    if (result.manifest?.agents) {
      const manifest=result.manifest.agents.find(b=>b.slug===a.slug)
      requireThat(manifest, 'Export manifest and files disagree on agent identity')
      Object.assign(manifest,safe,{permissionGrants:entry.permissionGrants})
    }
  }
  result.files[key]=yaml(extension)
  return result
}
export function prunedFalseKeys(live,bundle) {
  const {extension}=bundleExtension(bundle),pruned=[]
  const walk=(value,exported,path)=>{
    if (value===false && exported!==false) pruned.push(path)
    if (value && typeof value==='object') for(const [key,v] of Object.entries(value)) walk(v,exported?.[key],`${path}.${key}`)
  }
  for (const a of live.agents) {
    const slug=slugOf(a),entry=extension.agents?.[slug]??{}
    walk(a.adapterConfig,entry.adapter?.config,`agents.${slug}.adapter.config`)
    walk(a.runtimeConfig,entry.runtime,`agents.${slug}.runtime`)
    walk(a.permissions,entry.permissions,`agents.${slug}.permissions`)
  }
  return pruned.sort()
}
export async function snapshot(api,source,options={}) {
  const {companyId,apply=false,emit=()=>{},io,hostRecord={}}=options
  requireThat(companyId, 'snapshot requires the company id output by provisioning')
  const operation={method:'POST',path:`/api/companies/${companyId}/export`,body:{include:INCLUDE}}
  const operations=[operation,{method:'WRITE_SNAPSHOT',path:options.outputPath??'<required output path>'}]
  const digest=approvalDigest(operations,{baseUrl:api.baseUrl,companyId},source.sha)
  emit({digest,changes:operations})
  if(!apply) return {digest,changes:operations}
  requireThat(options.approvedDigest===digest && io && options.outputPath, 'snapshot needs approved digest and an explicit local output path')
  const live=await readSnapshot(api,companyId)
  emit({write:operation})
  const bundle=await api.request(operation.method,operation.path,operation.body)
  const fidelity=await api.request('GET',`/api/companies/${companyId}/export/fidelity`)
  emit({exportWarnings:bundle.warnings})
  const projects=portableProjects(source.contract,bundle,projectSummary(live.projects))
  const root=options.instanceRoot??instanceRoot(source.contract)
  const sourceRecord={companyId:live.company.id,agents:agentConfigs(source.contract,live),claudeConfigDirs:renderedClaude(source.contract,root,live.company.id,idMap(live))}
  const record={contractSha:source.sha,bundle,fidelity,projects,exportWarnings:structuredClone(bundle.warnings),source:sourceRecord,prunedFalseKeys:prunedFalseKeys(live,bundle),host:hostRecord,secretInputs:secretInputs(bundle),prerequisite:'Ryan must enter secret values by hand and run codex login before an authorized Codex run; secrets are rebound using secrets/catalog only.'}
  emit({write:{method:'WRITE_SNAPSHOT',path:options.outputPath}})
  await io.writeSnapshot(options.outputPath,record)
  emit({fidelity,prunedFalseKeys:record.prunedFalseKeys,secretInputs:record.secretInputs})
  return record
}
export async function restore(api,source,record,options={}) {
  requireThat(typeof options.target?.newCompanyName==='string' && options.target.newCompanyName.trim().length>0, 'restore requires an explicit unique target.newCompanyName')
  requireThat(record?.bundle?.files && record.fidelity && Array.isArray(record.prunedFalseKeys), 'restore requires the native bundle with fidelity and pruned-key sidecars')
  requireThat(record.source?.agents && record.source?.claudeConfigDirs && Array.isArray(record.projects) && Array.isArray(record.exportWarnings), 'restore requires source configuration, project and warning sidecars; take a new snapshot')
  requireThat(JSON.stringify(record.exportWarnings)===JSON.stringify(record.bundle.warnings), 'Export warning sidecar differs from native warnings')
  requireThat(record.contractSha===source.sha, 'Snapshot contract differs; parity requires the same contract')
  requireThat(JSON.stringify(Object.keys(record.source.agents).sort())===JSON.stringify(source.contract.agents.map(a=>a.slug).sort()) && source.contract.agents.filter(a=>a.adapterType==='claude_local').every(a=>record.source.claudeConfigDirs[a.slug]?.files), 'Incomplete source configuration sidecar')
  portableProjects(source.contract,record.bundle,record.projects)
  const bundle=overlayRestore(source.contract,record.bundle)
  const original=bundleExtension(record.bundle).extension.agents
  const stripping={strippedReservedSkills:bundle.strippedReservedSkills,deduplicatedCompanySkills:bundle.deduplicatedCompanySkills}
  options.emit?.(stripping)
  const result=await fresh(api,source,{...options,bundle,finishState:async(live,state)=>{
    const {synchronize}=await import('./index.mjs')
    const verify=await synchronize(api,source,{companyId:live.company.id,expectedName:state.expectedName})
    requireThat(!verify.changes.length && !verify.invariants.length && verify.permissionsRevoked && verify.catalog.every(m=>m.present), 'Restored configuration must verify invariants 1–9 with changes: []')
    live=await readSnapshot(api,live.company.id)
    assertRestoredSkills(source.contract,live,bundle)
    requireThat(live.agents.every(a=>!Object.values(a.adapterConfig?.env??{}).some(v=>v?.type==='secret_ref')) && live.secretCatalog.length===0, 'Restored secrets must remain unbound')
    const compare=compareRoundTrip(source.contract,record,live,options.instanceRoot??instanceRoot(source.contract))
    options.emit?.({compare})
    requireThat(compare.differences.length===0, 'Restored configuration differs from source; see compare block')
    state.restoration={...stripping,configurationParity:true,sourceCompanyId:record.source.companyId,secretInputs:state.secretInputs,plugins:'unprovisioned'}
    return {verify,compare,expectedFindings:{secretInputs:state.secretInputs,secretLinks:verify.secretLinks,plugins:'unprovisioned'},configurationParity:compare.differences.length===0}
  },validateImportedState:live=>{
    const previous={agents:live.agents.map(a=>({id:a.id,adapterConfig:original[slugOf(a)]?.adapter?.config??{},runtimeConfig:original[slugOf(a)]?.runtime??{}}))}
    assertInvariants(source.contract,{...live,previous},[7,8])
  }})
  return {...result,...stripping}
}
const xml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const plistValue = v => {
  if (typeof v==='boolean') return v?'<true/>':'<false/>'
  if (typeof v==='number') return `<integer>${v}</integer>`
  if (typeof v==='string') return `<string>${xml(v)}</string>`
  if (Array.isArray(v)) return `<array>${v.map(plistValue).join('')}</array>`
  return `<dict>${Object.entries(v).map(([k,v])=>`<key>${xml(k)}</key>${plistValue(v)}`).join('')}</dict>`
}
export function renderHost(contract) {
  const plists={}
  for (const definition of [contract.service.paperclip.launchd,contract.network.daemon.launchd]) {
    const args=definition.programArguments.map(v=>typeof v==='object'?'[REDACTED SECRET PATH]':v)
    const value={Label:definition.label,ProgramArguments:args,EnvironmentVariables:definition.env,StandardOutPath:definition.logs.stdout,StandardErrorPath:definition.logs.stderr,RunAtLoad:definition.runAtLoad,KeepAlive:definition.keepAlive,ThrottleInterval:definition.throttleInterval,...(definition.exitTimeOut?{ExitTimeOut:definition.exitTimeOut}:{})}
    plists[`${definition.label}.plist`]=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${plistValue(value)}</plist>\n`
  }
  return {plists,database:contract.database,network:{provider:contract.network.provider,managed:contract.network.managed,hostname:contract.network.hostname},pins:contract.skills,installServices:false,credentialValues:false}
}
