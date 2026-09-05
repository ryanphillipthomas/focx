import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { source,fixture,writes,corruptInvariant } from './test-support.mjs'
import { validateSchema,validateContract,loadSource,PACKAGE } from './src/contract.mjs'
import { approvalDigest,hash,sha256 } from './src/digest.mjs'
import { assess,assertInvariants,tighter,tighterDaily } from './src/invariants.mjs'
import { fresh,bindSecrets,preflightFresh,freshPlan,permissionsDone,secretLinkFindings,resolveEnv } from './src/fresh.mjs'
import { createFakeApi,memoryIO } from './src/fake-api.mjs'
import { Client,readSnapshot } from './src/api.mjs'
import { synchronize } from './src/index.mjs'
import { snapshot,restore,overlayRestore,prunedFalseKeys,renderHost } from './src/portability.mjs'
import { renderFreshBundle,bundleExtension,parseYaml,yaml,parseMarkdown } from './src/bundle.mjs'
import { catalogEntries,installPlan,installPinned,renderSkillHomes,verifySkills,validateGrants } from './src/skills.mjs'
import { modelEvidence } from './src/host.mjs'
import { nativePluginPlan,assertNativePin,installNativePlugins,NativePluginRuntime } from './src/native-plugins.mjs'
import { pluginReadbackMatches } from './src/plugins.mjs'

test('contract validates against its schema; ids are outputs and model keys are adapter data',()=>{
  assert.deepEqual(validateSchema(source.contract,source.schema),[])
  for(const a of source.contract.agents){assert(!('id' in a));assert.equal(a.reasoning,'high')}
  assert.deepEqual(Object.keys(source.contract.company),['name'])
  assert.equal(source.contract.agents[0].model,'gpt-6-astra')
  assert.equal(source.contract.adapters.codex_local.reasoningKey,'modelReasoningEffort')
  assert.equal(source.contract.adapters.claude_local.reasoningKey,'effort')
})
test('FB3 rev 2.2 skills bytes are preserved verbatim as the skills property',()=>{
  const raw=readFileSync(resolve(PACKAGE,'contract.json'),'utf8'),skills=raw.slice(raw.indexOf('\n  "skills": {')+'\n  "skills": '.length,-3)
  assert.equal(sha256(skills),'cb9ed22e8194b1648ca1742a142660a012f29cb0330a292143789fa76ad22320')
})
test('schema requires pinned on every plugin entry in every catalog family',()=>{
  const cases=[['claudePlugins','plugins'],['codexPlugins','plugins'],['codexPlugins','observedNotPinned'],['codexPlugins','communityNotPinned','entries'],['codexPlugins','thirdPartyDevelopedNotPinned','entries'],['claudePluginsOfficialOpenAI'],['claudePluginsNonOfficialInUse']]
  for(const path of cases){const c=structuredClone(source.contract),map=path.reduce((x,k)=>x[k],c.skills),key=Object.keys(map).find(k=>k.includes('@'));delete map[key].pinned;assert(validateSchema(c,source.schema).some(s=>s.includes('pinned')))}
})
test('schema refuses ids, missing independence, unpaused activation and empty desiredSkills',()=>{
  for(const mutate of [c=>c.company.id='old',c=>c.agents[0].id='old',c=>delete c.independence,c=>c.activation='active',c=>c.agents[0].desiredSkills=[]]){const c=structuredClone(source.contract);mutate(c);assert.throws(()=>validateContract(c,source.schema))}
})
test('registry catalog retains duplicate names with distinct full source identities',()=>{
  const entries=catalogEntries(source.contract.skills),web=entries.filter(e=>e.key==='webmcp@openai-curated-remote')
  assert.equal(web.length,2);assert.notEqual(web[0].sourceId,web[1].sourceId)
  assert.equal(entries.filter(e=>e.adapter==='codex_local'&&e.pinned).length,73)
  assert.equal(source.contract.skills.codexPlugins.communityNotPinned.count,436)
})
test('grants are adapter-specific and Codex company scope cannot be narrowed',()=>{
  for(const mutate of [c=>c.agents[0].grants.claudePlugins.push('codex@openai-codex'),c=>c.agents[0].grants.codexPlugins.pop(),c=>c.agents[1].grants.claudePlugins.push('unknown@unknown')]){const c=structuredClone(source.contract);mutate(c);assert.throws(()=>validateGrants(c))}
})
test('P24/P26 native bundle uses YAML keys, nested heartbeat, optional unbound secret inputs and no fabricated Paperclip skill',()=>{
  const b=renderFreshBundle(source.contract,source.files),{extension}=bundleExtension(b)
  assert.equal(extension.schemaVersion,7)
  assert(!Object.keys(b.files).some(p=>p==='skills/paperclip/SKILL.md'))
  for(const a of source.contract.agents){const entry=extension.agents[a.slug];assert.equal(entry.runtime.heartbeat.wakeOnDemand,false);assert.deepEqual(entry.runtime.heartbeat.maxTurnContinuation,{enabled:false});assert.equal(entry.adapter.config[source.contract.adapters[a.adapterType].reasoningKey],'high');assert.deepEqual(parseMarkdown(b.files[`agents/${a.slug}/AGENTS.md`]).meta.skills,a.desiredSkills);for(const input of Object.values(entry.inputs.env))assert.equal(input.requirement,'optional')}
  assert(!JSON.stringify(b).includes('secretValues'))
  assert(!JSON.stringify(extension.agents).includes('"type":"secret_ref"'))
})
test('portable parser reads native block arrays and refuses ambiguous or malformed YAML',()=>{
  assert.deepEqual(parseYaml('schemaVersion: 7\nagents:\n  qa:\n    runtime:\n      heartbeat:\n        enabled: false\nlabels:\n  -\n    name: "one"\n'),{schemaVersion:7,agents:{qa:{runtime:{heartbeat:{enabled:false}}}},labels:[{name:'one'}]})
  for(const raw of ['x: 1\nx: 2\n','x:\n   y: 2\n','x: &anchor\n'])assert.throws(()=>parseYaml(raw))
})
test('fresh is dry-run by default and names all three stages without using create routes',async()=>{
  const api=createFakeApi(),io=memoryIO(),emitted=[]
  const p=await fresh(api,source,{io,catalogCompanyId:'catalog-company',emit:e=>emitted.push(e)})
  assert.equal(p.changes[0].path,'/api/companies/import');assert.equal(p.changes[0].body.pauseAutomations,true)
  assert.equal(writes(api).length,0);assert.equal(io.writes.length,0)
  assert.equal(emitted[0].later.length,2);assert.match(emitted[0].window,/tasks:assign/)
})
test('three-stage fake provisioning: born paused, explicit grant revoked, hand-entry pause, merge-only refs, zero changes',async()=>{
  const f=await fixture({instanceRoot:'/fake-instance'})
  assertInvariants(source.contract,f.live)
  assert(permissionsDone(f.live));assert.deepEqual(secretLinkFindings(source.contract,f.live),[])
  const calls=writes(f.api);assert.equal(calls.filter(c=>c.path==='/api/companies/import').length,1)
  assert.equal(calls.filter(c=>c.path.endsWith('/permissions')).length,2)
  for(const c of calls.filter(c=>c.body?.adapterConfig?.env)){assert(!('replaceAdapterConfig' in c.body));assert.equal(Object.keys(c.body.adapterConfig).length,1)}
  assert(f.live.agents.every(a=>a.access.canAssignTasks===true && a.access.taskAssignSource==='simple_default'))
  assert.equal(Object.keys(f.io.files).length,1)
  const r=await synchronize(f.api,source,{companyId:f.companyId});assert.deepEqual(r.changes,[])
})
for(let n=1;n<=8;n++)test(`invariant ${n} rejects its independent adversarial state`,async()=>{
  const {live}=await fixture();corruptInvariant(n,live);assert(assess(source.contract,live).some(f=>f.invariant===n))
})
test('finite daily caps and stricter live policies survive apply and restore overlay',async()=>{
  const f=await fixture();for(const a of f.api.state.agents){a.runtimeConfig.heartbeat.maxDailyRuns=1;a.adapterConfig.permissionMode='deny-all';a.adapterConfig.nonInteractivePermissions='fail';a.adapterConfig.timeoutSec=200;if(a.adapterType==='claude_local')a.adapterConfig.maxTurnsPerRun=4;a.runtimeConfig.heartbeat.wakeOnDemand=true}
  const p=await synchronize(f.api,source,{companyId:f.companyId})
  await synchronize(f.api,source,{companyId:f.companyId,io:f.io,apply:true,approvedDigest:p.digest})
  for(const a of f.api.state.agents){assert.equal(a.runtimeConfig.heartbeat.maxDailyRuns,1);assert.equal(a.adapterConfig.permissionMode,'deny-all');assert.equal(a.adapterConfig.nonInteractivePermissions,'fail');assert.equal(a.adapterConfig.timeoutSec,200)}
  assert.equal(tighter(2,null),2);assert.equal(tighter(0,900),900)
  const live=await readSnapshot(f.api,f.companyId),after=structuredClone(live);after.previous=live;after.agents[0].runtimeConfig.heartbeat.maxDailyRuns=null;assert(assess(source.contract,after).some(f=>f.invariant===7))
})
test('digest binds actual operations, target URL, company id and contract sha',()=>{
  const ops=[{method:'PATCH',path:'/api/agents/a',body:{model:'first'}}],target={baseUrl:'http://fake.invalid',companyId:'c'}
  const d=approvalDigest(ops,target,source.sha)
  for(const actual of [approvalDigest([{...ops[0],body:{model:'second'}}],target,source.sha),approvalDigest(ops,{...target,baseUrl:'http://other.invalid'},source.sha),approvalDigest(ops,{...target,companyId:'other'},source.sha),approvalDigest(ops,target,'new-sha')])assert.notEqual(d,actual)
})
test('apply refuses stale digest and live-state races before writes',async()=>{
  const f=await fixture();f.api.state.agents[0].runtimeConfig.heartbeat.wakeOnDemand=true
  const p=await synchronize(f.api,source,{companyId:f.companyId});const before=writes(f.api).length
  await assert.rejects(synchronize(f.api,source,{companyId:f.companyId,io:f.io,apply:true,approvedDigest:'wrong'}),/digest/)
  assert.equal(writes(f.api).length,before)
  f.api.state.agents[0].adapterConfig.timeoutSec=100
  await assert.rejects(synchronize(f.api,source,{companyId:f.companyId,io:f.io,apply:true,approvedDigest:p.digest}),/digest/)
})
test('apply repairs declared plain env without dropping bound secrets',async()=>{
  const f=await fixture();f.api.state.agents[0].adapterConfig.env.PATH={type:'plain',value:'/wrong'}
  const refs=structuredClone(f.api.state.agents[0].adapterConfig.env.GH_TOKEN),p=await synchronize(f.api,source,{companyId:f.companyId})
  await synchronize(f.api,source,{companyId:f.companyId,io:f.io,apply:true,approvedDigest:p.digest})
  assert.equal(f.api.state.agents[0].adapterConfig.env.PATH.value,source.contract.env.common.PATH)
  assert.deepEqual(f.api.state.agents[0].adapterConfig.env.GH_TOKEN,refs)
})
for(const kind of ['admin','collision','catalog','target','approval','lock','preview','state-race'])test(`fresh gate: ${kind} refuses without import`,async()=>{
  const api=createFakeApi(),io=memoryIO(),options={io,catalogCompanyId:'catalog-company'},p=await fresh(api,source,options)
  if(kind==='admin')api.state.isInstanceAdmin=false
  if(kind==='collision')api.state.companies.push({id:'collision',name:source.contract.company.name})
  if(kind==='catalog')api.state.models.codex_local=[]
  if(kind==='target')options.target={mode:'existing_company',companyId:'catalog-company'}
  if(kind==='lock')io.locked=true
  if(kind==='preview')api.state.previewErrors=['invalid package']
  if(kind==='state-race'){const old=io.acquire;io.acquire=async()=>{const release=await old();api.state.companies.push({id:'concurrent',name:'Unrelated concurrent creation'});return release}}
  await assert.rejects(fresh(api,source,{...options,apply:true,approvedDigest:kind==='approval'?'wrong':p.digest}))
  assert.equal(writes(api).length,0)
})
test('expected singleton preview warnings pass; any other warning fails before import',async()=>{
  const api=createFakeApi(),io=memoryIO(),p=await fresh(api,source,{io,catalogCompanyId:'catalog-company'})
  api.state.extraWarnings=['Unexpected materialization problem']
  await assert.rejects(fresh(api,source,{io,catalogCompanyId:'catalog-company',apply:true,approvedDigest:p.digest}),/preview warning/)
  assert.equal(writes(api).length,0)
})
test('partial import reports step 1 and created ids, marks failed, and never retries/adopts',async()=>{
  const api=createFakeApi({partialImport:true}),io=memoryIO(),options={io,catalogCompanyId:'catalog-company'},p=await fresh(api,source,options)
  await assert.rejects(fresh(api,source,{...options,apply:true,approvedDigest:p.digest}),e=>e.step===1 && Object.keys(e.state.ids).length===1)
  const state=await io.readState();assert.equal(state.phase,'failed')
  await assert.rejects(fresh(api,source,{...options,apply:true,approvedDigest:p.digest}))
  assert.equal(writes(api).filter(c=>c.path==='/api/companies/import').length,1)
  assert.deepEqual(await io.readState(),state)
})
test('step 2 failure retains both identities and reports permissions, not invariant 1',async()=>{
  const api=createFakeApi(),io=memoryIO(),options={io,catalogCompanyId:'catalog-company'},p=await fresh(api,source,options)
  api.state.fail=({path,method})=>method==='PATCH'&&path.endsWith('/permissions')
  await assert.rejects(fresh(api,source,{...options,apply:true,approvedDigest:p.digest}),e=>e.step===2 && Object.keys(e.state.ids).length===2 && /permissions/.test(e.unmet))
})
test('unresolved or ambiguous secret names refuse all env writes; binding failure stops step 3',async()=>{
  assert.throws(()=>resolveEnv({TOKEN:{secret:'needed'}},[]),/resolve uniquely/)
  assert.throws(()=>resolveEnv({TOKEN:{secret:'needed'}},[{id:'1',name:'needed'},{id:'2',name:'needed'}]),/resolve uniquely/)
  const f=await fixture({bound:false});const before=writes(f.api).length
  await assert.rejects(bindSecrets(f.api,source,{io:f.io}),/resolve uniquely/);assert.equal(writes(f.api).length,before)
  f.api.state.secrets=source.contract.secrets.map((s,i)=>({id:`secret-${i}`,name:s.name,companyId:f.companyId}))
  const p=await bindSecrets(f.api,source,{io:f.io});f.api.state.fail=({method,path})=>method==='PATCH'&&!path.endsWith('/permissions')
  await assert.rejects(bindSecrets(f.api,source,{io:f.io,apply:true,approvedDigest:p.digest}),e=>e.step===3 && /secret-link/.test(e.unmet))
  assert.equal((await f.io.readState()).phase,'failed')
})
test('no success when a permissions or config PATCH is acknowledged but ignored',async()=>{
  const api=createFakeApi(),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company'},p=await fresh(api,source,opts);api.state.ignoreWrites=true
  await assert.rejects(fresh(api,source,{...opts,apply:true,approvedDigest:p.digest}),/Step 2/)
})
test('snapshot uses native export includes, records fidelity and false losses; restore overlays before import',async()=>{
  const f=await fixture(),opts={companyId:f.companyId,outputPath:'/fake/snapshot.json',io:f.io}
  const preview=await snapshot(f.api,source,opts)
  const record=await snapshot(f.api,source,{...opts,apply:true,approvedDigest:preview.digest})
  assert(record.prunedFalseKeys.some(k=>k.endsWith('dangerouslyBypassApprovalsAndSandbox')))
  assert(record.prunedFalseKeys.some(k=>k.endsWith('wakeOnDemand')))
  const io=memoryIO(),options={io,catalogCompanyId:'catalog-company',target:{mode:'new_company',newCompanyName:'Round trip'}}
  const p=await restore(f.api,source,record,options),r=await restore(f.api,source,record,{...options,apply:true,approvedDigest:p.digest})
  const live=await readSnapshot(f.api,r.state.companyId);assertInvariants(source.contract,live,[7,8]);assert.equal(live.company.name,'Round trip');assert.notEqual(r.state.ids['qa-engineer'],f.live.agents[1].id)
  assert.equal(r.state.phase,'awaiting-secret-entry')
})
test('restore requires explicit unique name and reconstructs flags without loosening a finite cap',async()=>{
  const f=await fixture();f.api.state.agents[0].runtimeConfig.heartbeat.maxDailyRuns=1
  const bundle=await f.api.request('POST',`/api/companies/${f.companyId}/export`,{include:{company:true,agents:true,projects:true,skills:true,issues:false}})
  const record={bundle,fidelity:{},prunedFalseKeys:prunedFalseKeys(f.live,bundle)}
  await assert.rejects(restore(f.api,source,record,{io:memoryIO(),catalogCompanyId:'catalog-company',target:{mode:'new_company'}}),/explicit unique/)
  const restored=overlayRestore(source.contract,bundle),entry=bundleExtension(restored).extension.agents['implementation-engineer']
  assert.equal(entry.runtime.heartbeat.maxDailyRuns,1);assert.equal(entry.adapter.config.dangerouslyBypassApprovalsAndSandbox,false)
  assert.equal(bundleExtension(bundle).extension.agents['implementation-engineer'].adapter.config.dangerouslyBypassApprovalsAndSandbox,undefined)
})
test('unpinned entries only appear as available; install executor refuses them even if directly supplied',async()=>{
  const ops=installPlan(source.contract.skills);assert(ops.length>0);assert(ops.every(o=>o.entry.pinned))
  let installed=0;const entry=catalogEntries(source.contract.skills).find(e=>!e.pinned)
  await assert.rejects(installPinned([{kind:'install-pinned-plugin',entry}],{installPinned:async()=>{installed++}},()=>{}),/never installed/);assert.equal(installed,0)
})
test('Claude settings and adapterLocal derive from grants; materialization reports injection failures without log text',()=>{
  const c=structuredClone(source.contract);c.agents[1].adapterLocal.claudeCodePlugins=[]
  const homes=renderSkillHomes(c,'/fake/.paperclip/instances/default','company',{'implementation-engineer':'impl','qa-engineer':'qa'})
  const text=Object.values(homes.files)[0];assert(Object.keys(JSON.parse(text).enabledPlugins).length===3);assert.equal(homes.adapterLocal['qa-engineer'].claudeCodePlugins.length,3)
  const host={readText:p=>homes.files[p]??null,exists:()=>true,entries:()=>['paperclip'],isSymlink:()=>true,runLogs:()=>[{path:'/fake/run.log',text:'Failed to inject sensitive log content'}]}
  const result=verifySkills(c,homes,host);assert.equal(result.injectionFailures.length,1);assert.equal(result.executionProven,false);assert(!JSON.stringify(result).includes('sensitive log content'));assert(result.available.length>0)
})
test('model catalog, ACP cache mtime, and binary literal evidence are separate; no binary execution',()=>{
  const calls=[],host={readJson:p=>{calls.push(p);return {models:[{slug:'gpt-5.6-sol'}]}},mtime:()=> '2026-09-05T08:00:00.000Z',containsLiteral:()=>false}
  const lines=modelEvidence(source.contract,'company',[{slug:'implementation-engineer',present:true}],host)
  assert.equal(lines.length,3);assert.match(lines[0],/present/);assert.match(lines[1],/absent; mtime=2026/);assert.match(lines[2],/false.*no execution/);assert.equal(calls.length,1)
})
test('host snapshot renders exactly two plists with a redacted tunnel secret path and no service installation',()=>{
  const host=renderHost(source.contract);assert.equal(Object.keys(host.plists).length,2);assert.equal(host.installServices,false);assert.match(host.plists['com.cloudflare.cloudflared.plist'],/REDACTED SECRET PATH/)
})
test('Client transport contract uses an in-process fake without sockets and rejects secret-value routes',async()=>{
  const api=createFakeApi(),transport=async(url,init)=>new Response(JSON.stringify(await api.request(init.method,new URL(url).pathname,init.body?JSON.parse(init.body):undefined)),{status:200,headers:{'content-type':'application/json'}})
  const client=new Client(api.baseUrl,undefined,transport);assert((await client.request('GET','/api/companies')).length>0);await assert.rejects(client.request('GET','/api/companies/catalog-company/secrets'),/catalog/)
})
test('CLI schema validation is offline and exits zero',()=>{
  const p=spawnSync(process.execPath,[resolve(PACKAGE,'src/index.mjs'),'--check'],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/"contractSchema": "pass"/)
})
test('finite daily zero is never replaced with null; invalid caps are refused',()=>{
  assert.equal(tighterDaily(0,null),0);assert.equal(tighterDaily(0,3),0)
  assert.throws(()=>tighterDaily(-1,null));assert.throws(()=>tighterDaily(1.5,null))
})
test('a failed state save is never retried and the original failure keeps its step and identities',async()=>{
  const api=createFakeApi(),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company'},p=await fresh(api,source,opts)
  let saves=0;io.save=async()=>{saves++;throw new Error('disk failure')}
  await assert.rejects(fresh(api,source,{...opts,apply:true,approvedDigest:p.digest}),e=>e.step===1 && /state persistence failed/.test(e.message))
  assert.equal(saves,1);assert.equal(writes(api).length,0);assert.equal(io.locked,false)
})
test('native installation uses only pinned source identities and installed protocol fields',()=>{
  const ops=nativePluginPlan(source.contract,'/fake/company-home'),schema=JSON.parse(readFileSync(resolve(PACKAGE,'native-schema/v2/PluginInstallParams.json'),'utf8'))
  assert.equal(ops.length,73)
  for(const op of ops){assert(op.entry.pinned);assert(Object.keys(op.params).every(k=>k in schema.properties));if(op.entry.sourceId)assert.equal(op.params.pluginName,op.entry.sourceId)}
  const web=ops.filter(op=>op.entry.key==='webmcp@openai-curated-remote');assert.equal(web.length,1);assert.equal(web[0].params.pluginName,'Plugin_671d912bf3d88191a88bc76fe741e84b')
})
test('native install rejects wrong source identity/version before writing and reports manual auth separately',async()=>{
  const op=nativePluginPlan(source.contract,'/fake/company-home').find(op=>op.entry.sourceId),calls=[],emitted=[]
  let installed=false
  const runtime={async request(method,params){calls.push({method,params});if(method==='app/installed')return {apps:[{id:'app',enabled:true,callable:false}]};if(method==='plugin/install'){installed=true;return {appsNeedingAuth:[{id:'app',name:'Needs sign-in'}],authPolicy:'ON_INSTALL'}}return {plugin:{apps:[{id:'app',name:'Needs sign-in'}],summary:{remotePluginId:op.entry.sourceId,version:op.entry.version,localVersion:installed?op.entry.version:null,source:{type:'remote'},installed,enabled:installed,availability:'AVAILABLE'}}}}}
  const result=await installNativePlugins([op],runtime,e=>emitted.push(e));assert.equal(result.oauthPerformed,false);assert.equal(result.needsAuth.length,1);assert.equal(emitted.length,1);assert(calls.every(c=>['plugin/read','plugin/install','app/installed'].includes(c.method)))
  for(const change of [{remotePluginId:'wrong-source'},{version:'wrong-version'}]){let wrote=false;const wrong={request:async method=>{if(method==='plugin/install')wrote=true;return {plugin:{summary:{remotePluginId:op.entry.sourceId,version:op.entry.version,...change}}}}};await assert.rejects(installNativePlugins([op],wrong,()=>{}));assert.equal(wrote,false)}
  const manager=new NativePluginRuntime('/not-executed','/fake',()=>{})
  assert.throws(()=>manager.request('turn/start',{}),/never run/);assert.throws(()=>manager.request('mcpServer/oauth/login',{}),/never run/)
})
test('installed plugin evidence checks full source and version, including old local cache versions',()=>{
  const entry={key:'example@market',adapter:'codex_local',version:'1',sourceId:'source'}
  assert(pluginReadbackMatches(entry,{...entry,installed:true}));assert(!pluginReadbackMatches(entry,{...entry,sourceId:'different'}))
  assert.throws(()=>assertNativePin({key:'local@market',version:'2'},{plugin:{summary:{installed:true,enabled:true,localVersion:'1',source:{type:'local',path:'/unused'}}}},{installed:true}),/version mismatch/)
})

// Actual source knock-outs in isolated child node:test processes. Mutated
// module bytes exist only in a data URL: no repository files are overwritten,
// no copy is left behind, and there is no production disable-guard switch.
const url=p=>pathToFileURL(resolve(PACKAGE,p)).href
function moduleURL(file,transform) {
  const path=resolve(PACKAGE,file),original=readFileSync(path,'utf8'),changed=transform(original)
  assert.notEqual(changed,original,'Knock-out must actually change the source')
  const absolute=changed.replace(/from '(\.\.?\/[^']+)'/g,(_,p)=>`from '${pathToFileURL(resolve(path,'..',p)).href}'`)
  return 'data:text/javascript;base64,'+Buffer.from(absolute).toString('base64')
}
function child(module,body) {
  const code=`import {test} from 'node:test'; import assert from 'node:assert/strict'; import * as subject from ${JSON.stringify(module)}; import {source,fixture,corruptInvariant,writes} from ${JSON.stringify(url('test-support.mjs'))}; import {createFakeApi,memoryIO} from ${JSON.stringify(url('src/fake-api.mjs'))}; import {freshPlan,fresh,preflightFresh} from ${JSON.stringify(url('src/fresh.mjs'))}; import {readSnapshot} from ${JSON.stringify(url('src/api.mjs'))}; test('guard witness',async()=>{${body}});`
  const env={...process.env};delete env.NODE_TEST_CONTEXT
  return spawnSync(process.execPath,['--input-type=module','--test-reporter=tap'],{input:code,encoding:'utf8',timeout:20000,env})
}
function knockout(label,file,transform,body) {
  test(`KNOCK-OUT ${label}`,()=>{
    const baseline=child(url(file),body);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr)
    const broken=child(moduleURL(file,transform),body);assert.equal(broken.status,1,broken.stdout+broken.stderr);assert.match(broken.stdout,/not ok 1 - guard witness/)
    if(label.startsWith('restore overlay')){assert.match(broken.stdout,/Invariant 7:/);assert.match(broken.stdout,/Invariant 8:/)}
    const restored=child(url(file),body);assert.equal(restored.status,0,restored.stdout+restored.stderr)
    console.log(`KNOCK-OUT ${label}: guard broken -> guard witness FAIL (1); restored -> PASS (1)`)
  })
}
for(let n=1;n<=8;n++)knockout(`invariant ${n}`,'src/invariants.mjs',s=>s.replace(`export function invariant${n}(contract, live) {`,`export function invariant${n}(contract, live) { return [];`),`const f=await fixture();corruptInvariant(${n},f.live);assert(subject.assess(source.contract,f.live).some(f=>f.invariant===${n}));`)
for(const [label,needle,setup]of [
  ['fresh new-company gate',"requireThat(options.target?.mode==='new_company' && !options.target.companyId, 'fresh/restore requires a new company target')", "options.target={mode:'existing_company',companyId:'catalog-company'}"],
  ['fresh paused-import gate',"requireThat(plan.operations[0].body.pauseAutomations===true, 'Import must create agents paused')",'p.operations[0].body.pauseAutomations=false'],
  ['fresh secretValues gate',"requireThat(!Object.hasOwn(plan.operations[0].body,'secretValues'), 'Import may never supply secretValues')",'p.operations[0].body.secretValues={}'],
  ['fresh complete-file gate',"requireThat(plan.operations[0].body.source.expectedFileCount===Object.keys(plan.bundle.files).length, 'Inline source file count mismatch')",'p.operations[0].body.source.expectedFileCount++'],
  ['fresh instance-admin gate',"requireThat(who?.isInstanceAdmin===true, 'new_company requires an instance-admin board token')",'api.state.isInstanceAdmin=false'],
  ['fresh unique-name gate',"requireThat(typeof name==='string' && name.trim()===name && name.length>0 && !companies.some(c=>c.name.trim().toLowerCase()===name.toLowerCase()), 'Explicit target company name must be unique; no suffix/adoption')",'api.state.companies.push({id:"duplicate",name:source.contract.company.name})'],
  ['fresh catalog-company gate',"requireThat(typeof options.catalogCompanyId==='string' && options.catalogCompanyId.length>0, 'Read-only catalog company id is required before new-company creation')",'delete options.catalogCompanyId'],
  ['fresh model-catalog gate',"requireThat(catalog.every(m=>m.present), 'Contract model missing from Paperclip adapter catalog')",'api.state.models.codex_local=[]'],
])knockout(label,'src/fresh.mjs',s=>s.replace(needle,'/* knocked out */'),`const api=createFakeApi(),options={target:{mode:'new_company'},catalogCompanyId:'catalog-company'},p=freshPlan(source,options.target);${setup};await assert.rejects(subject.preflightFresh(api,source,options,p));`)
knockout('approval digest binds rendered operations','src/digest.mjs',s=>s.replace('return hash({ operations, target:','return hash({ target:'),`const t={baseUrl:'http://fake.invalid',companyId:'c'};assert.notEqual(subject.approvalDigest([{body:{model:'a'}}],t,source.sha),subject.approvalDigest([{body:{model:'b'}}],t,source.sha));`)
knockout('pinned:false installation selection','src/skills.mjs',s=>s.replace('.filter(entry=>entry.pinned===true)',''),`assert(subject.installPlan(source.contract.skills).every(o=>o.entry.pinned===true));`)
knockout('pinned:false executor guard','src/skills.mjs',s=>s.replace("requireThat(op.kind==='install-pinned-plugin' && op.entry.pinned===true, 'Unpinned catalog entries are available only; never installed')",'/* knocked out */'),`const entry=subject.catalogEntries(source.contract.skills).find(e=>!e.pinned);await assert.rejects(subject.installPinned([{kind:'install-pinned-plugin',entry}],{installPinned:async()=>{}},()=>{}));`)
knockout('restore overlay (pruned export must fail invariants 7/8 when guard removed)','src/portability.mjs',s=>s.replace('const bundle=overlayRestore(source.contract,record.bundle)','const bundle=record.bundle'),`const f=await fixture();const bundle=await f.api.request('POST', '/api/companies/'+f.companyId+'/export',{include:{company:true,agents:true,projects:true,skills:true,issues:false}});const record={bundle,fidelity:{},prunedFalseKeys:subject.prunedFalseKeys(f.live,bundle)},io=memoryIO(),opts={io,catalogCompanyId:'catalog-company',target:{mode:'new_company',newCompanyName:'Restore witness'}};const p=await subject.restore(f.api,source,record,opts);await subject.restore(f.api,source,record,{...opts,apply:true,approvedDigest:p.digest});`)
knockout('fresh approval digest gate','src/fresh.mjs',s=>s.replace("requireThat(options.approvedDigest===digest, 'Preview changed or not approved; obtain a fresh digest')",'/* knocked out */'),`const api=createFakeApi(),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company'};await assert.rejects(subject.fresh(api,source,{...opts,apply:true,approvedDigest:'unapproved'}));assert.equal(writes(api).length,0);`)
knockout('fresh lock acquisition','src/fresh.mjs',s=>s.replace('const release=await io.acquire()','const release=async()=>{}'),`const api=createFakeApi(),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company'},p=await subject.fresh(api,source,opts);io.locked=true;await assert.rejects(subject.fresh(api,source,{...opts,apply:true,approvedDigest:p.digest}));assert.equal(writes(api).length,0);`)
knockout('fresh prior-state refusal','src/fresh.mjs',s=>s.replace("if (await io.readState()) { await release(); throw new Error('Prior state exists; partial imports must be reviewed, never retried or adopted') }",'/* knocked out */'),`const api=createFakeApi(),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company'},p=await subject.fresh(api,source,opts);await io.save({phase:'failed',ids:{old:'old'}});await assert.rejects(subject.fresh(api,source,{...opts,apply:true,approvedDigest:p.digest}));assert.equal(writes(api).length,0);`)
knockout('fresh state recheck gate','src/fresh.mjs',s=>s.replace("requireThat(hash(checked)===hash(preflight), 'Preflight state changed; no import made')",'/* knocked out */'),`const api=createFakeApi(),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company'},p=await subject.fresh(api,source,opts),acquire=io.acquire;io.acquire=async()=>{const release=await acquire();api.state.companies.push({id:'race',name:'Unrelated concurrent company'});return release};await assert.rejects(subject.fresh(api,source,{...opts,apply:true,approvedDigest:p.digest}));assert.equal(writes(api).length,0);`)
knockout('fresh preview errors gate','src/fresh.mjs',s=>s.replace("requireThat(Array.isArray(preview?.errors) && preview.errors.length===0, 'Native import preview errors')",'/* knocked out */'),`const api=createFakeApi(),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company'},p=await subject.fresh(api,source,opts),request=api.request.bind(api);api.request=async(m,p,b)=>p.endsWith('/preview')?{errors:['invalid'],warnings:[]}:request(m,p,b);await assert.rejects(subject.fresh(api,source,{...opts,apply:true,approvedDigest:p.digest}));assert.equal(writes(api).length,0);`)
knockout('fresh unexpected-preview-warning gate','src/fresh.mjs',s=>s.replace("requireThat(Array.isArray(preview.warnings) && preview.warnings.every(w=>source.contract.agents.some(a=>w===expectedSkillWarning(a.slug))), 'Unexpected native import preview warning; review required')",'/* knocked out */'),`const api=createFakeApi(),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company'},p=await subject.fresh(api,source,opts);api.state.extraWarnings=['unexpected'];await assert.rejects(subject.fresh(api,source,{...opts,apply:true,approvedDigest:p.digest}));assert.equal(writes(api).length,0);`)
knockout('fresh imported-name readback gate','src/fresh.mjs',s=>s.replace("requireThat(live.company.name===state.expectedName, 'Imported company name mismatch')",'/* knocked out */'),`const api=createFakeApi(),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company'},p=await subject.fresh(api,source,opts),request=api.request.bind(api);api.request=async(m,p,b)=>{const r=await request(m,p,b);if(m==='POST'&&p==='/api/companies/import')api.state.companies.find(c=>c.id===r.company.id).name='Wrong company name';return r};await assert.rejects(subject.fresh(api,source,{...opts,apply:true,approvedDigest:p.digest}));`)
knockout('fresh permissions-revocation completion gate','src/fresh.mjs',s=>s.replace("requireThat(permissionsDone(live), 'Step 2 did not revoke the explicit tasks:assign grant')",'/* knocked out */'),`const api=createFakeApi(),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company'},p=await subject.fresh(api,source,opts);api.state.ignoreWrites=true;await assert.rejects(subject.fresh(api,source,{...opts,apply:true,approvedDigest:p.digest}));`)
knockout('fresh post-import invariants are asserted','src/fresh.mjs',s=>s.replaceAll('assertInvariants(effectiveContract,live)','/* knocked out */').replaceAll('assertInvariants(effectiveContract,await readSnapshot(api,state.companyId))','/* knocked out */'),`const api=createFakeApi(),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company'},p=await subject.fresh(api,source,opts),request=api.request.bind(api);api.request=async(m,p,b)=>{const r=await request(m,p,b);if(m==='POST'&&p==='/api/companies/import')api.state.agents[0].runtimeConfig.heartbeat.wakeOnDemand=true;return r};await assert.rejects(subject.fresh(api,source,{...opts,apply:true,approvedDigest:p.digest}));`)
knockout('native pinned:false selection','src/native-plugins.mjs',s=>s.replace(".filter(e=>e.adapter==='codex_local' && e.pinned)",".filter(e=>e.adapter==='codex_local')"),`assert(subject.nativePluginPlan(source.contract,'/fake').every(op=>op.entry.pinned===true));`)
knockout('native source identity guard','src/native-plugins.mjs',s=>s.replace("requireThat(s && (!entry.sourceId || s.remotePluginId===entry.sourceId), `${entry.key}: native readback has a different remote source identity`)",'/* knocked out */'),`assert.throws(()=>subject.assertNativePin({key:'pin@market',sourceId:'expected',version:'1'},{plugin:{summary:{remotePluginId:'wrong',version:'1'}}}));`)
knockout('native version pin guard','src/native-plugins.mjs',s=>s.replace("requireThat(version===entry.version,`${entry.key}: native pin version mismatch`)",'/* knocked out */'),`assert.throws(()=>subject.assertNativePin({key:'pin@market',sourceId:'expected',version:'1'},{plugin:{summary:{remotePluginId:'expected',version:'2'}}}));`)
