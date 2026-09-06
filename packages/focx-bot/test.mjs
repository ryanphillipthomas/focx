import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
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

// FB5: metadata-only grant checks, using the existing fake and an in-memory host.
import { grantReport, grants, assertGrantReport, deadTempRules, readCodexEnablement, renderPermissions, readWorktreeSettings, vendorBaseline } from './src/grants.mjs'
import { memoryHost } from './src/fake-api.mjs'
import { idMap } from './src/api.mjs'
import { main } from './src/index.mjs'
import { readPluginInventory } from './src/plugins.mjs'
const f1Sentence='codex_local: reported only — declared permissions and plugin sets do not bound Codex behavior (F1); the Claude lane is bounded by its settings and permission rules.'
import { loadSource as loadPilotSource } from '../../tools/pilot-org/index.mjs'
const pilotManifest=loadPilotSource().manifest
async function grantFixture() {
  const api=createFakeApi()
  const f=await fixture({api,instanceRoot:'/fake-instance'}),c=source.contract
  const homes=renderSkillHomes(c,'/fake-instance',f.companyId,idMap(f.live)),files={...homes.files},plugins={}
  for(const pin of catalogEntries(c.skills).filter(p=>p.pinned)){
    const [name,marketplace]=pin.key.split('@'),version=pin.version??'unknown'
    if(pin.adapter==='claude_local'){
      const path=`/fake-user/.claude/plugins/cache/${marketplace}/${name}/${version}`
      const row={installPath:path,version,contentHash:pin.contentHash,gitCommitSha:pin.pin==='manifestSha'?pin.source.sha:pin.gitCommitSha,installedAt:'2026-09-05T00:00:00Z',scope:'user'}
      plugins[pin.key]=[row];files[`${path}/.claude-plugin/plugin.json`]=JSON.stringify({version})
    }else{
      files[`${homes.codex.home}/plugins/cache/${marketplace}/${name}/${version}/.codex-plugin/plugin.json`]=JSON.stringify({version,sourceId:pin.sourceId})
    }
  }
  const indexPath='/fake-user/.claude/plugins/installed_plugins.json'
  files[indexPath]=JSON.stringify({version:2,plugins})
  files[`${homes.codex.home}/config.toml`]=homes.codex.plugins.map(k=>`[plugins."${k}"]\nenabled = true`).join('\n')
  const host=memoryHost(files),claude=c.agents.find(a=>a.adapterType==='claude_local'),settingsPath=Object.keys(homes.files)[0]
  const report=()=>grantReport(c,f.live,homes,host,{pilotManifest})
  f.api.state.calls.length=0;f.io.writes.length=0
  return {...f,pilotManifest,host,homes,claude,settingsPath,indexPath,plugins,report,options:{companyId:f.companyId,instanceRoot:'/fake-instance',host,io:f.io,pilotManifest}}
}
const hasDiff=(r,kind,adapter='claude_local')=>r.agents.some(a=>a.adapter===adapter&&a.diffs.some(d=>d.kind===kind))
const worktreeOf=(f,name)=>`/fake-instance/projects/${f.companyId}/proj/focx/.paperclip/worktrees/${name}`
const addDirs=(host,p)=>{for(let d=p;d!==dirname(d);d=dirname(d))host.dirs.add(d)}

test('FB5 clean grants: canonical declarations, both rendered surfaces, launcher delivery and disk pins agree',async()=>{
  const f=await grantFixture(),r=f.report()
  assert.equal(r.ok,true);assert(r.agents.every(a=>!a.diffs.length));assertGrantReport(r)
  assert(r.lines.every(l=>/^(declared|rendered|observed on disk): /.test(l)))
  for(const needle of [f1Sentence,'settings.json enabledPlugins','adapterLocal','permissionsAllow','permissionsDeny','verifySkills','runtime-skills/','run-log injection failures'])assert(r.lines.some(l=>l.includes(needle)))
  assert(!r.lines.some(l=>/plugin works/i.test(l)))
})
for(const kind of ['granted-but-not-enabled','enabled-but-not-granted','enabled-but-not-installed','installed-at-wrong-pin'])test(`FB5 Claude diff ${kind} is fatal`,async()=>{
  const f=await grantFixture(),key=f.claude.grants.claudePlugins[0],settings=JSON.parse(f.host.files[f.settingsPath])
  if(kind==='granted-but-not-enabled')settings.enabledPlugins[key]=false
  if(kind==='enabled-but-not-granted')settings.enabledPlugins['extra@market']=true
  if(kind==='enabled-but-not-installed')delete f.plugins[key]
  if(kind==='installed-at-wrong-pin'){
    const p=f.plugins[key][0];p.version='wrong';f.host.files[`${p.installPath}/.claude-plugin/plugin.json`]=JSON.stringify({version:'wrong'})
  }
  f.host.files[f.settingsPath]=JSON.stringify(settings);f.host.files[f.indexPath]=JSON.stringify({plugins:f.plugins})
  const r=f.report();assert(hasDiff(r,kind));assert.equal(r.ok,false);assert.throws(()=>assertGrantReport(r),/Claude/)
})
test('FB5 worktree permission deltas and H7 are independently checked',async()=>{
  const f=await grantFixture(),cwd=worktreeOf(f,'QA'),path=`${cwd}/.claude/settings.local.json`
  const permissions=renderPermissions(f.claude.adapterLocal,cwd)
  permissions.allow.push('Write(/tmp/**)');permissions.deny=[]
  f.host.files[path]=JSON.stringify({permissions})
  addDirs(f.host,`${cwd}/.claude`)
  const r=f.report()
  for(const kind of ['permission-extra','permission-missing','dead-rule'])assert(hasDiff(r,kind))
  assert(r.lines.some(l=>l.includes('/tmp/**')&&l.includes(f.host.tempDir)))
  assert.equal(r.ok,false)
})
test('FB5 no worktree settings is one nonfatal unobserved line; vendor baseline is not an extra grant',async()=>{
  const f=await grantFixture(),line='observed on disk: no QA worktree settings yet — unobserved until an authorised run (FB8)'
  assert.equal(f.report().lines.filter(l=>l===line).length,1);assert.equal(f.report().ok,true)
  const cwd=worktreeOf(f,'QA'),path=`${cwd}/.claude/settings.local.json`
  f.host.files[path]=JSON.stringify({permissions:renderPermissions(f.claude.adapterLocal,cwd)})
  addDirs(f.host,`${cwd}/.claude`)
  assert.equal(f.report().ok,true);assert(!f.report().lines.includes(line))
  f.host.files[path]='not JSON';assert(hasDiff(f.report(),'metadata-unavailable'))
})
test('FB5 a worktree holding only Paperclip\'s five vendor rules is the pre-launch baseline, not a permission diff',async()=>{
  const f=await grantFixture(),cwd=worktreeOf(f,'FOC-1-fresh'),path=`${cwd}/.claude/settings.local.json`
  f.host.files[path]=JSON.stringify({permissions:{defaultMode:'default',allow:vendorBaseline(cwd),additionalDirectories:[]}});addDirs(f.host,`${cwd}/.claude`)
  const r=f.report();assert.equal(r.ok,true);assert(!hasDiff(r,'permission-missing'))
  assert(r.lines.some(l=>l.includes('pre-launch baseline')&&l.includes(path)))
})
test('FB5 a worktree with the vendor rules but a non-default permission mode is fatal, never a baseline (installed writer keeps a pre-existing mode)',async()=>{
  const f=await grantFixture(),cwd=worktreeOf(f,'FOC-2-bypass'),path=`${cwd}/.claude/settings.local.json`
  f.host.files[path]=JSON.stringify({permissions:{defaultMode:'bypassPermissions',allow:vendorBaseline(cwd)}});addDirs(f.host,`${cwd}/.claude`)
  const r=f.report();assert.equal(r.ok,false);assert(hasDiff(r,'permission-mode-unexpected'))
  assert(!r.lines.some(l=>l.includes('pre-launch baseline')&&l.includes(path)))
  f.host.files[path]=JSON.stringify({permissions:{allow:vendorBaseline(cwd)}})
  assert(hasDiff(f.report(),'permission-mode-unexpected'),'a missing mode is not default either')
})
for(const kind of ['delivery-command-missing','delivery-env-missing','declared-source-divergence'])test(`FB5 ${kind} is fatal`,async()=>{
  const f=await grantFixture(),adapter=f.live.agents.find(a=>a.adapterType==='claude_local').adapterConfig
  if(kind==='delivery-command-missing')adapter.agentCommand='node wrong.mjs'
  if(kind==='delivery-env-missing')delete adapter.env.CLAUDE_CONFIG_DIR
  if(kind==='declared-source-divergence'){
    const manifest=structuredClone(pilotManifest)
    manifest.agents.find(a=>a.roleKey===f.claude.roleKey).adapterLocal.permissionsAllow.push('Read')
    const r=grantReport(source.contract,f.live,f.homes,f.host,{pilotManifest:manifest})
    assert(hasDiff(r,kind));assert.equal(r.ok,false);return
  }
  const r=f.report();assert(hasDiff(r,kind));assert.equal(r.ok,false)
})
const f10Sentence="F10 resolved (rev 2.7): the launcher resolves QA through Paperclip by url-key and company; no ids in source."
test('F10 generated ids are clean; wrong or absent live QA role, adapter or company is fatal',async()=>{
  const f=await grantFixture(),r=f.report()
  assert.equal(r.ok,true);assert(r.agents.every(a=>!a.diffs.length));assertGrantReport(r)
  assert(r.lines.includes('declared: '+f10Sentence))
  assert.notEqual(f.live.company.id,pilotManifest.companyId)
  assert.notEqual(f.live.agents.find(a=>a.urlKey==='qa-engineer').id,pilotManifest.agents.find(a=>a.roleKey==='qa-engineer').id)
  for(const field of ['urlKey','adapterType','companyId'])for(const value of ['wrong',undefined]){
    const live=structuredClone(f.live);live.agents.find(a=>a.urlKey==='qa-engineer')[field]=value
    const report=grantReport(source.contract,live,f.homes,f.host,{pilotManifest})
    assert.equal(report.ok,false);assert(hasDiff(report,'delivery-identity-mismatch'));assert.throws(()=>assertGrantReport(report),/Claude/)
  }
  const manifest=structuredClone(pilotManifest);delete manifest.companyId;for(const a of manifest.agents)delete a.id
  assert.equal(grantReport(source.contract,f.live,f.homes,f.host,{pilotManifest:manifest}).ok,true)
})
test('FB5 Codex diffs are reported only, including wrong source identity and unknown enablement',async()=>{
  const f=await grantFixture(),key=f.homes.codex.plugins[0],config=`${f.homes.codex.home}/config.toml`
  f.host.files[config]=`[plugins."${key}"]\nenabled = false\n[plugins."extra@market"]\nenabled = true`
  const manifest=Object.keys(f.host.files).find(p=>p.startsWith(f.homes.codex.home+'/plugins/cache/')&&p.endsWith('/.codex-plugin/plugin.json'))
  f.host.files[manifest]=JSON.stringify({version:'wrong',sourceId:'wrong'})
  const r=f.report()
  for(const kind of ['granted-but-not-enabled','enabled-but-not-granted','enabled-but-not-installed','installed-at-wrong-pin'])assert(hasDiff(r,kind,'codex_local'))
  assert.equal(r.ok,true);assertGrantReport(r);assert(r.lines.some(l=>l.includes('enablement unknown')))
  delete f.host.files[config]
  const absent=f.report();assert.equal(absent.ok,true);assert(hasDiff(absent,'metadata-unavailable','codex_local'))
  assert(!hasDiff(absent,'granted-but-not-enabled','codex_local'))
})
test('FB5 no fabricated pin proof: missing content hash fails with an explicit unverified explanation',async()=>{
  const f=await grantFixture(),key='pr-review-toolkit@claude-plugins-official'
  delete f.plugins[key][0].contentHash;f.host.files[f.indexPath]=JSON.stringify({plugins:f.plugins})
  const r=f.report();assert(hasDiff(r,'installed-at-wrong-pin'));assert(r.lines.some(l=>l.includes('absent hash/source evidence is unverified')))
})
test('FB5 H7 detector flags the dead temp rule, not a matching temp path or unrelated live rule',()=>{
  assert.equal(deadTempRules(['Write(/tmp/**)','Read','Write(/private/var/folders/fake/T/**)'],'/private/var/folders/fake/T').length,1)
  assert.deepEqual(deadTempRules(['Write(/tmp/**)'],'/tmp/runtime'),[])
  assert.deepEqual(deadTempRules(['Write(/tmp/**)'],'/tmp'),[])
})
test('FB5 unattributed mtimes use only recorded matching-pin install time; retained directories do not grant installation',async()=>{
  const f=await grantFixture(),key=f.claude.grants.claudePlugins[0],p=f.plugins[key][0].installPath
  f.host.mtimes[p]='2026-09-05T00:00:01Z'
  const retained=p.replace(/\/[^/]+$/,'/old');f.host.dirs.add(retained);f.host.mtimes[retained]='2026-09-05T00:00:02Z'
  let r=f.report();assert.equal(r.ok,true)
  assert(r.lines.some(l=>l.includes('unattributed')&&l.includes(p)))
  assert(r.lines.some(l=>l.includes('unattributed')&&l.includes(retained)))
  assert(r.lines.some(l=>l.includes('mtime baseline unavailable')&&l.includes('codex-home')))
  f.host.mtimes[p]='2026-09-05T00:00:00Z';r=f.report();assert(!r.lines.some(l=>l.includes('unattributed')&&l.includes(`"path":"${p}"`)))
  delete f.plugins[key];f.host.files[f.indexPath]=JSON.stringify({plugins:f.plugins})
  assert(hasDiff(f.report(),'enabled-but-not-installed'))
})
test('FB5 malformed settings and missing delivery env cannot pass silently',async()=>{
  const f=await grantFixture();f.host.files[f.settingsPath]='not JSON'
  delete f.live.agents.find(a=>a.adapterType==='claude_local').adapterConfig.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  assert(hasDiff(f.report(),'metadata-unavailable'));assert(hasDiff(f.report(),'delivery-env-missing'));assert.equal(f.report().ok,false)
})
test('FB5 parser exposes only explicit booleans; unsupported TOML and duplicate keys are unknown',()=>{
  const path='/company/config.toml',host=memoryHost({[path]:`token = "DO_NOT_PRINT"\n[plugins."p@m"]\nenabled = true # explicit\n[plugins.'q@m']\nenabled=false\n[plugins]\n"x@m" = {enabled=true}`})
  const r=readCodexEnablement(host,'/company');assert.equal(r.complete,false);assert.equal(r.entries.length,2);assert(!JSON.stringify(r).includes('DO_NOT_PRINT'))
  host.files[path]='[plugins."p@m"]\nenabled=true\n[plugins."p@m"]\nenabled=false'
  assert.equal(readCodexEnablement(host,'/company').duplicate,true)
})
test('FB5 readers never open auth files, plugin payloads, marketplace snapshots or symlinked metadata',async()=>{
  const f=await grantFixture(),key=f.claude.grants.claudePlugins[0],pluginPath=f.plugins[key][0].installPath
  f.host.symlinks.add(`${pluginPath}/.claude-plugin/plugin.json`)
  f.plugins[key].push({installPath:'/outside/auth.json',version:'1'})
  f.host.files[f.indexPath]=JSON.stringify({plugins:f.plugins})
  f.report()
  assert(!f.host.reads.includes(`${pluginPath}/.claude-plugin/plugin.json`))
  assert(f.host.reads.every(p=>p===f.settingsPath||p===f.indexPath||p===`${f.homes.codex.home}/config.toml`||p.endsWith('/.claude-plugin/plugin.json')||p.endsWith('/.codex-plugin/plugin.json')))
  assert(f.host.reads.every(p=>!p.includes('/auth.json')&&!p.includes('/marketplaces/')&&!p.endsWith('SKILL.md')))
})
test('FB5 grants is idempotent and ignores apply: zero host/io writes and exclusively GET API calls',async()=>{
  const f=await grantFixture(),before=structuredClone(f.host.files)
  const first=await grants(f.api,source,{...f.options,apply:true,approvedDigest:'irrelevant'})
  const second=await grants(f.api,source,f.options)
  assert.deepEqual(first,second);assert.deepEqual(f.host.files,before)
  assert.equal(f.host.writes.length,0);assert.equal(f.io.writes.length,0);assert(f.api.state.calls.every(c=>c.method==='GET'))
})
test('FB5 verify includes the identical read-only grants report and cannot omit F1',async()=>{
  const f=await grantFixture(),r=await synchronize(f.api,source,f.options)
  assert.deepEqual(r.grants,f.report());assert(r.grants.lines.some(l=>l.includes(f1Sentence)))
  assert.equal(f.io.writes.length,0);assert.equal(f.host.writes.length,0);assert(f.api.state.calls.every(c=>c.method==='GET'))
})
test('FB5 CLI grants --apply and verify --verify-only --apply stay read-only and enforce the Claude exit gate',async()=>{
  const f=await grantFixture(),log=console.log,output=[];console.log=(...v)=>output.push(v.join(' '))
  try{
    for(const flags of [['grants','--apply'],['grants','--verify-only','--apply'],['verify','--verify-only','--apply']])await main([...flags,'--fake','--company-id',f.companyId],f)
    assert(output.join('\n').includes(f1Sentence))
    f.host.files[f.settingsPath]='{}'
    for(const verb of ['grants','verify'])await assert.rejects(main([verb,'--fake','--company-id',f.companyId],f),/Claude/)
  }finally{console.log=log}
  assert.equal(f.io.writes.length,0);assert.equal(f.host.writes.length,0);assert(f.api.state.calls.every(c=>c.method==='GET'))
})

const grantWitness=`const f=await fixture({instanceRoot:'/fake-instance'});const {memoryHost}=await import(${JSON.stringify(url('src/fake-api.mjs'))});const host=memoryHost();f.api.state.calls.length=0;f.io.writes.length=0;const options={companyId:f.companyId,instanceRoot:'/fake-instance',host,io:f.io,apply:true};const report=await subject.grants(f.api,source,options);`
knockout('FB5 Claude fatal gate','src/grants.mjs',s=>s.replace("const fatal=a.adapterType==='claude_local' && diffs.length>0",'const fatal=false'),grantWitness+`assert.equal(report.ok,false);assert.throws(()=>subject.assertGrantReport(report),/Claude/);`)
knockout('FB5 CLI exit assertion','src/grants.mjs',s=>s.replace("requireThat(report.ok,'Claude plugin grants or permission metadata mismatch')",'/* knocked out */'),grantWitness+`assert.throws(()=>subject.assertGrantReport(report),/Claude/);`)
knockout('FB5 F1 cannot be silenced','src/grants.mjs',s=>s.replace('`declared: ${F1}`','`declared: omitted`'),grantWitness+`assert(report.lines.some(l=>l.includes(${JSON.stringify(f1Sentence)})));`)
knockout('FB5 dead temp rule detector','src/grants.mjs',s=>s.replace("rule==='Write(/tmp/**)'",'false'),`assert.equal(subject.deadTempRules(['Write(/tmp/**)','Read','Write(/private/var/folders/fake/T/**)'],'/private/var/folders/fake/T').length,1);`)
knockout('FB5 granted-but-not-enabled detector','src/grants.mjs',s=>s.replace("diff(surface,'granted-but-not-enabled',key)",'void key'),grantWitness+`assert(report.agents.some(a=>a.adapter==='claude_local'&&a.diffs.some(d=>d.kind==='granted-but-not-enabled')));`)
knockout('FB5 zero host writes witness','src/grants.mjs',s=>s.replace('const inventory=readPluginInventory','host.writeText("/fake/write","mutation"); const inventory=readPluginInventory'),grantWitness+`assert.equal(host.writes.length,0);assert.equal(f.io.writes.length,0);`)
knockout('FB5 zero non-GET API calls witness','src/grants.mjs',s=>s.replace('const live=await readSnapshot(api,options.companyId)','const live=await readSnapshot(api,options.companyId); await api.request("PATCH","/api/agents/"+live.agents[0].id,{title:"mutation"})'),grantWitness+`assert(f.api.state.calls.every(c=>c.method==='GET'));`)

// Each mutation must defeat its named witness, even when unrelated diffs remain.
const grantDiffWitness=`const f=await fixture({instanceRoot:'/fake-instance'});const {memoryHost}=await import(${JSON.stringify(url('src/fake-api.mjs'))});const {renderSkillHomes}=await import(${JSON.stringify(url('src/skills.mjs'))});const {idMap}=await import(${JSON.stringify(url('src/api.mjs'))});const c=structuredClone(source.contract),qa=c.agents.find(a=>a.adapterType==='claude_local'),homes=renderSkillHomes(c,'/fake-instance',f.companyId,idMap(f.live)),settingsPath=Object.keys(homes.files)[0],key=qa.grants.claudePlugins[0],pinPath='/fake-user/.claude/plugins/cache/'+key.split('@').reverse().join('/')+'/wrong',files={...homes.files};const settings=JSON.parse(files[settingsPath]);settings.enabledPlugins['extra@market']=true;files[settingsPath]=JSON.stringify(settings);files[pinPath+'/.claude-plugin/plugin.json']=JSON.stringify({version:'wrong'});files['/fake-user/.claude/plugins/installed_plugins.json']=JSON.stringify({plugins:{[key]:[{installPath:pinPath,version:'wrong'}]}});const host=memoryHost(files),manifest={companyId:f.companyId,agents:c.agents.map(a=>({...a,id:f.live.agents.find(b=>b.urlKey===a.slug).id}))};const report=subject.grantReport(c,f.live,homes,host,{pilotManifest:manifest});`
for(const kind of ['enabled-but-not-granted','enabled-but-not-installed','installed-at-wrong-pin'])knockout(`FB5 ${kind} detector`,'src/grants.mjs',s=>s.replace(`diff(${kind==='enabled-but-not-granted'?'surface':"'installed plugins'"},'${kind}',key`, `diff(${kind==='enabled-but-not-granted'?'surface':"'installed plugins'"},'knocked-out',key`),grantDiffWitness+`assert(report.agents.some(a=>a.adapter==='claude_local'&&a.diffs.some(d=>d.kind===${JSON.stringify(kind)})));`)
knockout('FB5 Codex findings cannot become fatal','src/grants.mjs',s=>s.replace("const fatal=a.adapterType==='claude_local' && diffs.length>0",'const fatal=diffs.length>0'),grantDiffWitness+`const codex=report.agents.find(a=>a.adapter==='codex_local');assert(codex.diffs.length>0);assert.equal(codex.fatal,false);`)
for(const kind of ['delivery-command-missing','delivery-env-missing','declared-source-divergence','delivery-identity-mismatch','permission-mode-unexpected']){
  const setup=kind==='permission-mode-unexpected'?"const {dirname:dn}=await import('node:path');const wt='/fake-instance/projects/'+f.companyId+'/proj/focx/.paperclip/worktrees/QA';host.files[wt+'/.claude/settings.local.json']=JSON.stringify({permissions:{defaultMode:'bypassPermissions',allow:subject.vendorBaseline(wt)}});for(let d=wt+'/.claude';d!==dn(d);d=dn(d))host.dirs.add(d);":kind==='delivery-command-missing'?"delete f.live.agents.find(a=>a.adapterType==='claude_local').adapterConfig.agentCommand;":kind==='delivery-env-missing'?"delete f.live.agents.find(a=>a.adapterType==='claude_local').adapterConfig.env.CLAUDE_CONFIG_DIR;":kind==='declared-source-divergence'?"manifest.agents.find(a=>a.roleKey===qa.roleKey).adapterLocal={};":"f.live.agents.find(a=>a.urlKey==='qa-engineer').companyId='wrong';"
  const witness=grantDiffWitness.replace('const report=subject.grantReport',setup+'const report=subject.grantReport')
  knockout(`FB5 ${kind} detector`,'src/grants.mjs',s=>s.replace(`'${kind}'`,"'knocked-out'"),witness+`assert(report.agents.some(a=>a.diffs.some(d=>d.kind===${JSON.stringify(kind)})));`)
}
knockout('F10 resolution declaration cannot be silenced','src/grants.mjs',s=>s.replace('lines.push(`declared: ${F10}`)','/* knocked out */'),grantDiffWitness+`assert(report.lines.some(l=>l.includes(${JSON.stringify(f10Sentence)})));`)
knockout('FB5 zero io writes witness','src/grants.mjs',s=>s.replace('const live=await readSnapshot(api,options.companyId)','const live=await readSnapshot(api,options.companyId); await options.io.save({mutation:true})'),grantWitness+`assert.equal(f.io.writes.length,0);`)
test('FB5 worktree reader opens only settings metadata and skips symlinked trees',()=>{
  const root='/instance',path=root+'/projects/C/P/focx/.paperclip/worktrees/QA/.claude/settings.local.json',host=memoryHost({[path]:JSON.stringify({permissions:{allow:['Read'],deny:['Edit']}}),[root+'/projects/C/P/focx/.paperclip/worktrees/QA/.claude/auth.json']:'FORBIDDEN',[root+'/projects/C/P/focx/.paperclip/worktrees/QA/plugin/SKILL.md']:'FORBIDDEN',[root+'/projects/C/P/focx/.paperclip/worktrees/linked/.claude/settings.local.json']:'FORBIDDEN'})
  host.symlinks.add(root+'/projects/C/P/focx/.paperclip/worktrees/linked')
  assert.equal(readWorktreeSettings(host,root,'C').length,1);assert.deepEqual(host.reads,[path]);assert.equal(host.writes.length,0)
  host.symlinks.add(path);host.reads.length=0
  assert.equal(readWorktreeSettings(host,root,'C')[0].permissions,null);assert.deepEqual(host.reads,[])
  assert.equal(readWorktreeSettings(host,root,'OTHER').length,0,'other companies are out of scope')
})

test('F10 default source reader keeps permission declarations by roleKey; generated fake ids are clean',async()=>{
  const f=await grantFixture(),options={...f.options};delete options.pilotManifest
  const r=await grants(f.api,source,options)
  assert(r.agents.every(a=>!a.diffs.length));assert(!hasDiff(r,'declared-source-divergence'))
  assert.equal(r.ok,true);assert(r.lines.includes('declared: '+f10Sentence))
  assert.equal(f.host.writes.length,0);assert.equal(f.io.writes.length,0);assert(f.api.state.calls.every(c=>c.method==='GET'))
})
