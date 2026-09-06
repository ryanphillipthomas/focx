#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual as same } from 'node:util'
import { loadSource, PACKAGE } from './contract.mjs'
import { requireThat, assertInvariants, assess, accessReport, slugOf, projectReport } from './invariants.mjs'
import { approvalDigest, hash } from './digest.mjs'
import { Client, readSnapshot, models, idMap } from './api.mjs'
import { renderAdapter, overlayAgent,composeEnv } from './bundle.mjs'
import { fresh, bindSecrets, permissionsDone, secretLinkFindings } from './fresh.mjs'
import { snapshot, restore, renderHost } from './portability.mjs'
import { renderSkillHomes, verifySkills, catalogEntries } from './skills.mjs'
import { localIO, instanceRoot, defaultHost, checkInstalledAdapters, modelEvidence, checkHostPrerequisites } from './host.mjs'
import { readPluginInventory,pluginOperations,executePluginOperations } from './plugins.mjs'
import { nativePluginPlan,installNativePlugins,NativePluginRuntime } from './native-plugins.mjs'
import { grants, grantReport, assertGrantReport } from './grants.mjs'

export function plan(source,live) {
  assertInvariants(source.contract,live,[1,2,3,4,5,6])
  const operations=[]
  for(const a of source.contract.agents) {
    const b=live.agents.find(b=>slugOf(b)===a.slug)
    const desired=renderAdapter(source.contract,a)
    const safe=overlayAgent(a,b)
    const adapterConfig={...b.adapterConfig,...desired,...safe.adapterConfig,model:desired.model,[source.contract.adapters[a.adapterType].reasoningKey]:a.reasoning,workspaceStrategy:desired.workspaceStrategy}
    adapterConfig.env={...b.adapterConfig.env}
    for(const [key,value]of Object.entries(composeEnv(source.contract,a)))if(typeof value==='string' && (adapterConfig.env[key]?.value??adapterConfig.env[key])!==value)adapterConfig.env[key]={type:'plain',value}
    if(desired.agentCommand)adapterConfig.agentCommand=desired.agentCommand
    const body={name:a.name,title:a.title,reportsTo:null,adapterConfig,runtimeConfig:safe.runtimeConfig}
    const fields=Object.keys(body).filter(k=>!same(body[k],b[k]))
    if(fields.length)operations.push({method:'PATCH',path:`/api/agents/${b.id}`,body,fields})
    if(b.permissions.canCreateAgents!==false || b.permissions.canCreateSkills!==false || !permissionsDone({agents:[b]})) operations.push({method:'PATCH',path:`/api/agents/${b.id}/permissions`,body:a.permissions})
    if(b.entryFile!=='AGENTS.md' || b.legacyPromptTemplateActive || b.legacyBootstrapPromptTemplateActive)operations.push({method:'PATCH',path:`/api/agents/${b.id}/instructions-bundle`,body:{entryFile:'AGENTS.md',clearLegacyPromptTemplate:true}})
    for(const [path,content] of Object.entries(source.files[a.slug]))if(b.files[path]?.trim()!==content.trim())operations.push({method:'PUT',path:`/api/agents/${b.id}/instructions-bundle/file`,body:{path,content,clearLegacyPromptTemplate:true}})
  }
  return operations
}
export async function synchronize(api,source,options={}) {
  const {companyId,apply=false,emit=()=>{},io}=options
  requireThat(companyId,'verify/apply requires the generated company id')
  const contract=options.expectedName?{...source.contract,company:{name:options.expectedName}}:source.contract
  const effectiveSource={...source,contract}
  const live=await readSnapshot(api,companyId)
  const state=await io?.readState()
  const configurationOnly=!apply && state?.restoration?.configurationParity===true && state.phase==='awaiting-secret-entry' && state.companyId===companyId && state.baseUrl===api.baseUrl && state.contractSha===source.sha && same(state.ids,idMap(live))
  requireThat(live.company.name===contract.company.name,'Unexpected company name')
  const catalog=await models(api,companyId,contract)
  const evidence=options.host?modelEvidence(contract,companyId,catalog,options.host):undefined
  if(evidence)options.reportModelEvidence?.(evidence)
  const operations=plan(effectiveSource,live)
  const digest=approvalDigest(operations,{baseUrl:api.baseUrl,companyId},source.sha)
  const report={digest,changes:operations,invariants:assess(contract,live),projects:projectReport(live),secretLinks:secretLinkFindings(contract,live),access:accessReport(live),catalog,permissionsRevoked:permissionsDone(live)}
  if(configurationOnly) {
    requireThat(live.agents.every(a=>!Object.values(a.adapterConfig?.env??{}).some(v=>v?.type==='secret_ref')) && live.secretCatalog.length===0, 'Restored configuration verification requires secrets to remain unbound')
    report.scope='restored-configuration'
    report.expectedFindings={secretInputs:state.restoration.secretInputs,secretLinks:report.secretLinks,plugins:'unprovisioned'}
  }
  if(options.host){
    const homes=renderSkillHomes(contract,options.instanceRoot??instanceRoot(contract),companyId,idMap(live));report.skills=verifySkills(contract,homes,options.host,live);report.modelEvidence=evidence
    report.grants=grantReport(contract,live,homes,options.host,options)
    if(options.pluginInventory)report.pins=catalogEntries(contract.skills).filter(e=>e.pinned).map(entry=>{
      const row=options.pluginInventory.find(r=>r.installed&&r.key===entry.key&&r.adapter===entry.adapter)
      return {key:entry.key,adapter:entry.adapter,installed:!!row,expectedVersion:entry.version??null,observedVersion:row?.version??null,contentHashMatches:entry.contentHash?row?.contentHash===entry.contentHash:null,sourceIdentityVerified:entry.sourceId?row?.sourceId===entry.sourceId:null}
    })
  }
  emit(report)
  if(!apply)return report
  assertInvariants(contract,live,[9])
  requireThat(options.approvedDigest===digest,'Apply requires the current rendered-operation digest')
  requireThat(catalog.every(c=>c.present),'Contract model missing from Paperclip adapter catalog')
  requireThat(!report.secretLinks.length,'Resolve secret links through bind-secrets before apply')
  requireThat(io,'Apply requires the instance single-writer lock')
  emit({write:{method:'LOCK',path:io.lockPath}});const release=await io.acquire()
  try {
    const checked=await readSnapshot(api,companyId)
    assertInvariants(contract,checked,[1,2,3,4,5,6])
    requireThat(hash(checked)===hash(live),'Live state changed during preflight; no writes made')
    requireThat(approvalDigest(plan(effectiveSource,checked),{baseUrl:api.baseUrl,companyId},source.sha)===digest,'Rendered operations changed during preflight')
    for(const operation of operations){assertInvariants(contract,await readSnapshot(api,companyId),[1,2,3,4,5,6]);emit({write:operation});await api.request(operation.method,operation.path,operation.body);if(operation.body?.adapterConfig)assertInvariants(contract,await readSnapshot(api,companyId),[8])}
    const after=await readSnapshot(api,companyId)
    assertInvariants(contract,{...after,previous:live})
    requireThat(permissionsDone(after) && secretLinkFindings(contract,after).length===0 && plan(effectiveSource,after).length===0,'Post-apply convergence failed; no retry')
    return {digest,changes:[],verified:true,access:accessReport(after)}
  } finally{emit({write:{method:'UNLOCK',path:io.lockPath}});await release()}
}
function args(argv) {
  const options={verb:'verify'},values=new Set(['base-url','company-id','catalog-company-id','state-file','snapshot-file','new-company-name','approved-digest','contract'])
  if(argv[0] && !argv[0].startsWith('--'))options.verb=argv.shift()
  for(let i=0;i<argv.length;i++){
    const key=argv[i].replace(/^--/,'')
    requireThat(argv[i].startsWith('--'),'Unexpected CLI argument')
    if(values.has(key)){requireThat(argv[i+1] && !argv[i+1].startsWith('--'),`Missing --${key} value`);options[key]=argv[++i]}
    else{requireThat(['apply','verify-only','check','validate-contract','fake','host'].includes(key),`Unknown flag --${key}`);options[key]=true}
  }
  if(options['verify-only']){if(options.verb!=='grants')options.verb='verify';options.apply=false}
  requireThat(['verify','grants','apply','fresh','snapshot','restore','bind-secrets'].includes(options.verb),'Unknown verb')
  return options
}
export async function main(argv=process.argv.slice(2),runtime={}) {
  const flags=args([...argv]),source=loadSource(flags.contract??resolve(PACKAGE,'contract.json'))
  const emit=value=>console.log(JSON.stringify(value,null,2))
  if(flags.check || flags['validate-contract']){emit({contractSchema:'pass',agents:source.contract.agents.map(a=>a.slug),runtimeDependencies:0});return}
  requireThat(flags.fake || flags['base-url'],'An explicit --base-url is required; no default live target')
  let api,io,fakeHost
  if(flags.fake){const fake=await import('./fake-api.mjs');api=runtime.api??fake.createFakeApi();io=runtime.io??fake.memoryIO();fakeHost=runtime.host??fake.memoryHost()}
  else{api=new Client(flags['base-url'],process.env.PAPERCLIP_API_KEY);io=localIO(source.contract,flags['state-file'])}
  const state=await io.readState()
  const options={...(flags.fake?{pilotManifest:runtime.pilotManifest}:{}),apply:!!flags.apply,approvedDigest:flags['approved-digest'],companyId:flags['company-id']??state?.companyId,catalogCompanyId:flags['catalog-company-id']??(flags.fake?'catalog-company':undefined),target:{mode:'new_company',...(flags['new-company-name']?{newCompanyName:flags['new-company-name']}:{})},expectedName:flags['new-company-name']??state?.expectedName,outputPath:flags['snapshot-file'],emit,io,instanceRoot:flags.fake?'/fake-instance':instanceRoot(source.contract)}
  if(['verify','grants'].includes(flags.verb))options.apply=false
  options.reportModelEvidence=lines=>lines.forEach(line=>console.log(line))
  if(!flags.fake && flags.verb!=='grants'){options.hostPrerequisites=checkHostPrerequisites(source.contract);emit({adapters:await checkInstalledAdapters(source.contract),host:options.hostPrerequisites});options.host=defaultHost(source.contract);if(options.companyId)options.pluginInventory=readPluginInventory(source.contract,`${instanceRoot(source.contract)}/companies/${options.companyId}/codex-home`)}
  if(flags.fake && ['verify','grants'].includes(flags.verb))options.host=fakeHost
  let result
  if(flags.verb==='grants'){
    result=await grants(api,source,options)
    result.lines.forEach(line=>console.log(line))
    assertGrantReport(result)
    return result
  }
  if(['verify','apply'].includes(flags.verb))result=await synchronize(api,source,options)
  else if(flags.verb==='fresh')result=await fresh(api,source,options)
  else if(flags.verb==='snapshot')result=await snapshot(api,source,{...options,hostRecord:renderHost(source.contract)})
  else if(flags.verb==='restore'){requireThat(flags['snapshot-file'],'restore requires --snapshot-file');result=await restore(api,source,JSON.parse(readFileSync(flags['snapshot-file'],'utf8')),options)}
  else {
    requireThat(state?.companyId,'bind-secrets requires import state')
    const homes=renderSkillHomes(source.contract,instanceRoot(source.contract),state.companyId,state.ids)
    const inventory=readPluginInventory(source.contract,homes.codex.home)
    const claude=pluginOperations(source.contract,inventory,homes.codex.home,{adapter:'claude_local'})
    const codex=nativePluginPlan(source.contract,homes.codex.home)
    const command=resolve(instanceRoot(source.contract),'../../cli/current/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex')
    const manager={method:'START_PLUGIN_MANAGER',command,args:['app-server'],home:homes.codex.home}
    result=await bindSecrets(api,source,{...options,agentEnv:homes.agentEnv,pluginOperations:[...claude,manager,...codex],provisionPlugins:async()=>{
      requireThat(defaultHost(source.contract).exists(homes.codex.authLink),`Ryan must complete codex login for CODEX_HOME=${homes.codex.home} before native plugin installation`)
      await executePluginOperations(claude,{readInventory:()=>readPluginInventory(source.contract,homes.codex.home),emit})
      const runtime=new NativePluginRuntime(command,homes.codex.home,emit)
      try{await runtime.open();return await installNativePlugins(codex,runtime,emit)}finally{runtime.close()}
    }})
  }
  emit(result)
  if(flags.verb==='verify'){
    if(result.scope==='restored-configuration') {
      requireThat(!result.changes.length && !result.invariants.length && result.permissionsRevoked && result.catalog.every(m=>m.present), 'Restored configuration verification failed')
      if(result.skills)requireThat(result.skills.materialization.filter(r=>r.kind==='claude-settings').every(r=>r.matches), 'Restored Claude settings differ from rendered settings')
      return result
    }
    if(result.grants)assertGrantReport(result.grants)
    requireThat(!result.changes.length && !result.invariants.length && !result.secretLinks.length && result.permissionsRevoked && result.catalog.every(m=>m.present),'Verification found unmet checks')
    if(options.hostPrerequisites)requireThat(options.hostPrerequisites.postgresql17.listener && options.hostPrerequisites.claudeRuntime.matches,'Host prerequisites are unmet')
    if(result.skills)requireThat(result.skills.materialization.filter(r=>['claude-settings','claude-env'].includes(r.kind)).every(r=>r.matches) && !result.skills.injectionFailures.length,'Host declarations or skill injection checks failed')
    if(result.pins)requireThat(result.pins.filter(p=>p.adapter==='claude_local').every(p=>p.installed && (!p.expectedVersion || p.observedVersion===p.expectedVersion) && p.contentHashMatches!==false),'Pinned Claude plugin installation metadata is incomplete or mismatched')
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1})
