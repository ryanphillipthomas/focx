import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { source,fixture,writes,corruptInvariant } from './test-support.mjs'
import { validateSchema,validateContract,loadSource,PACKAGE } from './src/contract.mjs'
import { approvalDigest,hash,sha256 } from './src/digest.mjs'
import { assess,assertInvariants,tighter,tighterDaily } from './src/invariants.mjs'
import { fresh,bindSecrets,preflightFresh,freshPlan,permissionsDone,secretLinkFindings,resolveEnv } from './src/fresh.mjs'
import { createFakeApi,memoryIO,memoryPluginInventory,memoryNativePlugins } from './src/fake-api.mjs'
import { Client,readSnapshot } from './src/api.mjs'
import { synchronize } from './src/index.mjs'
import { snapshot,restore,overlayRestore,prunedFalseKeys,renderHost } from './src/portability.mjs'
import { renderFreshBundle,bundleExtension,parseYaml,yaml,parseMarkdown } from './src/bundle.mjs'
import { catalogEntries,installPlan,installPinned,renderSkillHomes,verifySkills,validateGrants } from './src/skills.mjs'
import { modelEvidence } from './src/host.mjs'
import { nativePluginPlan,assertNativePin,installNativePlugins,NativePluginRuntime } from './src/native-plugins.mjs'
import { pluginReadbackMatches,executePluginOperations,contentHash } from './src/plugins.mjs'

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
test('fresh reports the same five digest operations in preview and return',async()=>{
  const api=createFakeApi(),io=memoryIO(),emitted=[],target={mode:'new_company',newCompanyName:'console-demo'}
  const result=await fresh(api,source,{io,target,instanceRoot:'/fake-instance',catalogCompanyId:'catalog-company',emit:e=>emitted.push(e)})
  const homes=renderSkillHomes(source.contract,'/fake-instance','<created-company-id>',Object.fromEntries(source.contract.agents.map(a=>[a.slug,`<id:${a.slug}>`])))
  const digestOperations=[...freshPlan(source,target).operations,...Object.entries(homes.files).map(([path,body])=>({method:'WRITE_FILE',path,body})),{method:'WRITE_STATE',path:io.statePath}]
  assert.deepEqual(emitted[0].changes,result.changes)
  assert.equal(result.changes.length,5)
  assert.deepEqual(result.changes,digestOperations)
  assert.equal(result.changes.length,digestOperations.length)
  assert.deepEqual(result.changes.at(-1),{method:'WRITE_STATE',path:io.statePath})
  assert.equal(result.digest,approvalDigest(digestOperations,{baseUrl:api.baseUrl,companyId:null},source.sha))
  assert.equal(emitted[0].digest,result.digest)
})
test('fresh console-demo digest is unchanged from before the reporting refactor',async()=>{
  const result=await fresh(createFakeApi(),source,{io:memoryIO(),instanceRoot:'/fake-instance',catalogCompanyId:'catalog-company',target:{mode:'new_company',newCompanyName:'console-demo'}})
  assert.equal(result.digest,'eafdfcf7d13b79031c15d6f535c164911dc967f231523e2cdb5e7d8ae95ff09c')
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
for(let n=1;n<=9;n++)test(`invariant ${n} rejects its independent adversarial state`,async()=>{
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
  const listSchema=JSON.parse(readFileSync(resolve(PACKAGE,'native-schema/ClientRequest.json'),'utf8')).definitions.PluginListParams
  for(const op of ops){assert(op.entry.pinned);assert(Object.keys(op.params).every(k=>k in (op.kind==='native-plugin-verify'?listSchema:schema).properties));if(op.entry.sourceId)assert.equal(op.params.pluginName,op.entry.sourceId)}
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
  const absolute=changed.replace(/from '(\.\.?\/[^']+)'/g,(_,p)=>`from '${pathToFileURL(resolve(path,'..',p)).href}'`).replace(/import\('(\.\.?\/[^']+)'\)/g,(_,p)=>`import('${pathToFileURL(resolve(path,'..',p)).href}')`)
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
    if(label.startsWith('F15 reserved strip'))assert.match(broken.stdout,/HTTP 422: unpinned_external_source/)
    if(label==='F19 optional manifest tolerance')assert.match(broken.stdout,/Plugin pin readback failed/);
    if(label==='F19 already-satisfied skip')assert.match(broken.stdout,/matching pin was reinstalled/);
    if(label==='F15 company de-duplication')assert.match(broken.stdout,/duplicate company skills imported/)
    if(label==='F21 findings completion check')assert.match(broken.stdout,/outstanding findings must prevent completion/)
    if(label==='F21 resolved findings cleared')assert.match(broken.stdout,/resolved findings must be removed from state/)
    if(label==='F21 CLI plain summary')assert.match(broken.stdout,/CLI must print the count and every missing pin as plain text/)
    if(label==='F15 post-import singleton assertion')assert.match(broken.stdout,/Missing expected rejection/)
    const restored=child(url(file),body);assert.equal(restored.status,0,restored.stdout+restored.stderr)
    console.log(`KNOCK-OUT ${label}: guard broken -> guard witness FAIL (1); restored -> PASS (1)`)
  })
}
for(let n=1;n<=9;n++)knockout(`invariant ${n}`,'src/invariants.mjs',s=>s.replace(`export function invariant${n}(contract, live) {`,`export function invariant${n}(contract, live) { return [];`),`const f=await fixture();corruptInvariant(${n},f.live);assert(subject.assess(source.contract,f.live).some(f=>f.invariant===${n}));`)
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
knockout('restore overlay (pruned export must fail invariants 7/8 when guard removed)','src/portability.mjs',s=>s.replace('const bundle=overlayRestore(source.contract,record.bundle)','const bundle=stripRestoreSkills(source.contract,record.bundle)'),`const f=await fixture();const bundle=await f.api.request('POST', '/api/companies/'+f.companyId+'/export',{include:{company:true,agents:true,projects:true,skills:true,issues:false}});const snapshotOptions={companyId:f.companyId,outputPath:'/fake/snapshot.json',io:f.io};const preview=await subject.snapshot(f.api,source,snapshotOptions);const record=await subject.snapshot(f.api,source,{...snapshotOptions,apply:true,approvedDigest:preview.digest}),io=memoryIO(),opts={io,catalogCompanyId:'catalog-company',target:{mode:'new_company',newCompanyName:'Restore witness'}};const p=await subject.restore(f.api,source,record,opts);await subject.restore(f.api,source,record,{...opts,apply:true,approvedDigest:p.digest});`)
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
import { loadRoleSource, buildRoleSource, ROLE_ROOT } from './src/roles.mjs'
const pilotManifest=loadRoleSource().manifest
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

// FB9: native projects and configuration-only restore evidence.
async function snapshotFixture(f,extra={}) {
  const options={companyId:f.companyId,outputPath:'/fake/snapshot.json',io:f.io,instanceRoot:'/fake-instance',...extra}
  const preview=await snapshot(f.api,source,options)
  return snapshot(f.api,source,{...options,apply:true,approvedDigest:preview.digest})
}
async function roundTripFixture({bound=true}={}) {
  const f=await fixture({bound,instanceRoot:'/fake-instance'}),record=await snapshotFixture(f),io=memoryIO()
  const options={io,catalogCompanyId:'catalog-company',target:{mode:'new_company',newCompanyName:'FB9 restored'},instanceRoot:'/fake-instance'}
  const p=await restore(f.api,source,record,options)
  const result=await restore(f.api,source,record,{...options,apply:true,approvedDigest:p.digest})
  return {...f,record,restoreIO:io,result}
}
test('FB9 project contract rejects ids, invalid primary sets and credential-bearing/non-HTTPS URLs',()=>{
  for(const mutate of [c=>c.project.id='retained-id',c=>c.project.name='!!!',c=>c.project.workspaces=[],c=>c.project.workspaces.push({...c.project.workspaces[0]}),c=>c.project.workspaces[0].isPrimary=false,c=>c.project.workspaces[0].repoUrl='http://github.com/example/repo',c=>c.project.workspaces[0].repoUrl='https://user:password@example.com/repo',c=>c.project.workspaces[0].repoUrl='https://example.com/repo?token=example',c=>c.project.workspaces[0].repoRef='develop']){
    const c=structuredClone(source.contract);mutate(c);assert.throws(()=>validateContract(c,source.schema))
  }
})
test('FB9 project rendering is native keyed YAML with generated project/workspace IDs',async()=>{
  const b=renderFreshBundle(source.contract,source.files),ext=bundleExtension(b).extension
  assert.deepEqual(parseMarkdown(b.files['projects/connect/PROJECT.md']),{meta:{name:'Connect',description:null,owner:null},body:''})
  assert.deepEqual(ext.projects,{connect:{status:'backlog',workspaces:{focx:{...source.contract.project.workspaces[0],visibility:null}}}})
  const operation=freshPlan(source,{mode:'new_company'}).operations[0]
  assert.equal(operation.body.source.expectedFileCount,Object.keys(b.files).length)
  assert.equal(operation.body.include.projects,true)
  const f=await fixture();assertInvariants(source.contract,f.live,[9]);const p=f.live.projects[0]
  assert(p.id);assert(p.workspaces[0].id);assert.deepEqual((await f.io.readState()).projects[0].id,p.id)
})
for(const [label,mutate] of [
  ['missing project',l=>l.projects=[]],['extra project',l=>l.projects.push({...l.projects[0],id:'extra',urlKey:'extra'})],['wrong project key',l=>l.projects[0].urlKey='other'],['wrong company',l=>l.projects[0].companyId='other'],['missing primary workspace',l=>l.projects[0].workspaces=[]],['wrong repoUrl',l=>l.projects[0].workspaces[0].repoUrl='https://example.com/wrong'],['two primaries',l=>l.projects[0].workspaces.push({...l.projects[0].workspaces[0],id:'second'})],['missing workspace id',l=>delete l.projects[0].workspaces[0].id],['wrong sourceType',l=>l.projects[0].workspaces[0].sourceType='local_path'],
])test('FB9 invariant 9 rejects '+label,async()=>{const f=await fixture();mutate(f.live);assert(assess(source.contract,f.live).some(r=>r.invariant===9))})
test('FB9 missing PROJECT.md and array workspace extension both fail fresh post-import assertion',async()=>{
  for(const mutate of [b=>delete b.files['projects/connect/PROJECT.md'],b=>{const {extension}=bundleExtension(b);extension.projects.connect.workspaces=Object.values(extension.projects.connect.workspaces);b.files['.paperclip.yaml']=yaml(extension)}]){
    const b=renderFreshBundle(source.contract,source.files);mutate(b)
    const api=createFakeApi(),io=memoryIO(),options={io,bundle:b,catalogCompanyId:'catalog-company'},p=await fresh(api,source,options)
    await assert.rejects(fresh(api,source,{...options,apply:true,approvedDigest:p.digest}),/Invariant 9/)
    assert.equal(writes(api).filter(c=>c.method==='PATCH').length,0)
  }
})
test('FB9 snapshot records source projects and warnings verbatim and overlay preserves all project bytes',async()=>{
  const f=await fixture(),request=f.api.request.bind(f.api)
  f.api.request=async(method,path,body)=>{const r=await request(method,path,body);if(path.endsWith('/export'))r.warnings.push('Native warning retained verbatim.');return r}
  const r=await snapshotFixture(f),overlaid=overlayRestore(source.contract,r.bundle)
  assert.deepEqual(r.exportWarnings,['Native warning retained verbatim.'])
  assert.deepEqual(r.projects,[{slug:'connect',workspaces:[{name:'focx',repoUrl:source.contract.project.workspaces[0].repoUrl,isPrimary:true}]}])
  assert.equal(overlaid.files['projects/connect/PROJECT.md'],r.bundle.files['projects/connect/PROJECT.md'])
  assert.deepEqual(bundleExtension(overlaid).extension.projects,bundleExtension(r.bundle).extension.projects)
  assert.deepEqual(overlaid.manifest.projects,r.bundle.manifest.projects)
})
test('FB9 snapshot refuses a workspace omitted by native export and writes no sidecar',async()=>{
  const f=await fixture();f.api.state.projects[0].workspaces[0].repoUrl=null
  await assert.rejects(snapshotFixture(f),/omitted a workspace/);assert.equal(f.io.snapshots.size,0)
})
test('FB9 omission of an extra nonportable workspace also refuses; warnings cannot be silently discarded',async()=>{
  const f=await fixture();f.api.state.projects[0].workspaces.push({name:'local-only',repoUrl:null,isPrimary:false})
  await assert.rejects(snapshotFixture(f),/omitted a workspace/)
})
test('FB9 restore refuses missing workspace with and without warning before any write',async()=>{
  const f=await fixture(),record=await snapshotFixture(f)
  for(const warnings of [[],['Project connect workspace focx was omitted from export because it does not have a portable repoUrl.']]){
    const r=structuredClone(record),ext=bundleExtension(r.bundle).extension;delete ext.projects.connect.workspaces.focx;r.bundle.files['.paperclip.yaml']=yaml(ext);r.bundle.warnings=warnings;r.exportWarnings=warnings
    const before=writes(f.api).length
    await assert.rejects(restore(f.api,source,r,{io:memoryIO(),catalogCompanyId:'catalog-company',target:{mode:'new_company',newCompanyName:'Refused'}}),/omitted a workspace/)
    assert.equal(writes(f.api).length,before)
  }
})
for(const bound of [true,false])test('FB9 fresh → snapshot → restore → verify 1–9, empty compare; source secrets '+(bound?'bound':'unbound'),async()=>{
  const f=await roundTripFixture({bound}),r=f.result
  assert.deepEqual(r.compare.differences,[]);assert.equal(r.configurationParity,true)
  assert.deepEqual(r.verify.changes,[]);assert.deepEqual(r.verify.invariants,[])
  assert(r.expectedFindings.secretLinks.length);assert.equal(r.expectedFindings.plugins,'unprovisioned')
  assert.deepEqual(r.compare.fidelity,f.record.fidelity);assert.deepEqual(r.compare.prunedFalseKeys,f.record.prunedFalseKeys)
  for(const row of Object.values(r.compare.agents)){assert.deepEqual(row.adapterConfig,[]);assert.deepEqual(row.runtimeConfig,[])}
  const dirs=r.compare.claudeConfigDirs['qa-engineer'];assert.notEqual(dirs.source.directory,dirs.restored.directory);assert.deepEqual(dirs.source.files,dirs.restored.files)
  const live=await readSnapshot(f.api,r.state.companyId);assertInvariants(source.contract,live)
  assert.notEqual(live.projects[0].id,f.live.projects[0].id);assert.notEqual(live.projects[0].workspaces[0].id,f.live.projects[0].workspaces[0].id)
  assert.equal(live.secretCatalog.length,0);assert(live.agents.every(a=>!Object.values(a.adapterConfig.env).some(v=>v?.type==='secret_ref')))
  const report=await synchronize(f.api,source,{companyId:r.state.companyId,expectedName:r.state.expectedName,io:f.restoreIO})
  assert.equal(report.scope,'restored-configuration');assert.deepEqual(report.changes,[]);assert.deepEqual(report.invariants,[])
})
test('FB9 CLI verify succeeds for the restored company with expected secret/plugin findings; normal verify stays strict',async()=>{
  const f=await roundTripFixture(),{main}=await import('./src/index.mjs'),{memoryHost}=await import('./src/fake-api.mjs')
  const host=memoryHost(f.restoreIO.files),lines=[],log=console.log;console.log=v=>lines.push(v)
  try{
    const result=await main(['verify','--fake','--company-id',f.result.state.companyId],{api:f.api,io:f.restoreIO,host})
    assert.equal(result.scope,'restored-configuration');assert.deepEqual(result.changes,[])
    host.files[Object.keys(host.files)[0]]='{}'
    await assert.rejects(main(['verify','--fake','--company-id',f.result.state.companyId],{api:f.api,io:f.restoreIO,host}),/Claude settings/)
    const normal=await synchronize(f.api,source,{companyId:f.companyId,io:f.io});assert.equal(normal.scope,undefined)
  }finally{console.log=log}
})
test('FB9 source configuration diff is real: an export-lost noncontract false is reported and restore fails',async()=>{
  const f=await fixture();f.api.state.agents[0].adapterConfig.customFlag=false
  const record=await snapshotFixture(f),io=memoryIO(),events=[],options={io,instanceRoot:'/fake-instance',catalogCompanyId:'catalog-company',target:{mode:'new_company',newCompanyName:'Lost flag'},emit:e=>events.push(e)}
  const p=await restore(f.api,source,record,options)
  await assert.rejects(restore(f.api,source,record,{...options,apply:true,approvedDigest:p.digest}),/differs from source/)
  const compare=events.find(e=>e.compare)?.compare;assert(compare.differences.some(d=>d.path==='customFlag' && d.before===false))
  assert.equal((await io.readState()).phase,'failed')
})
knockout('FB9 project rendering','src/bundle.mjs',s=>s.replace('files[`projects/${slug}/PROJECT.md`]=markdown({name:project.name,description:null,owner:null})','/* project rendering knocked out */'),`const api=createFakeApi(),bundle=subject.renderFreshBundle(source.contract,source.files),op=subject.importOperation(bundle,{mode:'new_company'});const r=await api.request(op.method,op.path,op.body);const live=await readSnapshot(api,r.company.id);const {assertInvariants}=await import(${JSON.stringify(url('src/invariants.mjs'))});assertInvariants(source.contract,live,[9]);`)
knockout('FB9 missing-workspace snapshot refusal','src/portability.mjs',s=>s.replace('const projects=portableProjects(source.contract,bundle,projectSummary(live.projects))','const projects=projectSummary(live.projects)'),`const f=await fixture();f.api.state.projects[0].workspaces[0].repoUrl=null;const opts={companyId:f.companyId,io:f.io,outputPath:'/fake/snapshot.json'},p=await subject.snapshot(f.api,source,opts);await assert.rejects(subject.snapshot(f.api,source,{...opts,apply:true,approvedDigest:p.digest}),/omitted a workspace/);assert.equal(f.io.snapshots.size,0);`)
test('FB9 compare detects loss of a secondary workspace even when invariant 9 still passes',async()=>{
  const f=await fixture({instanceRoot:'/fake-instance'})
  f.api.state.projects[0].workspaces.push({id:'secondary',name:'secondary',repoUrl:'https://example.com/secondary',sourceType:'git_repo',isPrimary:false})
  const record=await snapshotFixture(f),live=await readSnapshot(f.api,f.companyId)
  live.projects[0].workspaces.pop();assertInvariants(source.contract,live,[9])
  const {compareRoundTrip}=await import('./src/roundtrip.mjs'),compare=compareRoundTrip(source.contract,record,live,'/fake-instance')
  assert(compare.projects.length);assert(compare.differences.some(d=>d.kind==='projects'))
})

// F15: export/apply asymmetry, reserved provenance and company inventory.
import { importOperation, RESERVED_SKILL_PREFIX, markdown } from './src/bundle.mjs'
import { expectedSkillWarning } from './src/fresh.mjs'
import { assertRestoredSkills } from './src/roundtrip.mjs'
const reservedFiles=b=>Object.keys(b.files).filter(p=>p.startsWith('skills/'+RESERVED_SKILL_PREFIX))
test('F15 fake native export has five null-commit bundled skills and two company aliases; preview passes but raw apply returns 422 after company creation',async()=>{
  const f=await fixture(),r=await snapshotFixture(f),skills=r.bundle.manifest.skills
  assert.equal(reservedFiles(r.bundle).length,5)
  for(const path of reservedFiles(r.bundle)) {
    const doc=parseMarkdown(r.bundle.files[path]),entry=skills.find(s=>s.path===path)
    assert.equal(doc.meta.metadata.sources[0].commit,null)
    assert.equal(entry.sourceType,'github');assert.equal(entry.sourceRef,null);assert.equal(entry.metadata.sourceKind,'paperclip_bundled')
  }
  for(const name of ['focx-implement-task','focx-verify-change'])assert.deepEqual(skills.filter(s=>s.slug===name).map(s=>s.key),[name,'company/'+f.companyId+'/'+name])
  const op=importOperation(r.bundle,{mode:'new_company',newCompanyName:'Raw export rejected'})
  const preview=await f.api.request('POST','/api/companies/import/preview',op.body)
  assert.deepEqual(preview.errors,[]);assert.deepEqual(preview.warnings,[])
  await assert.rejects(f.api.request(op.method,op.path,op.body),e=>e.status===422 && /unpinned_external_source/.test(e.message))
  const created=f.api.state.companies.find(c=>c.name==='Raw export rejected');assert(created)
  assert.equal(f.api.state.agents.filter(a=>a.companyId===created.id).length,0)
})
test('F15 restore strips files and manifest keys immutably, preserves instruction bytes and recomputes import count',async()=>{
  const f=await fixture(),r=await snapshotFixture(f),original=structuredClone(r.bundle)
  r.bundle.files['skills/'+RESERVED_SKILL_PREFIX+'paperclip/references/extra.md']='reserved support file'
  r.bundle.manifest.skills.push({key:RESERVED_SKILL_PREFIX+'manifest-only',path:'absent/SKILL.md'})
  const before=structuredClone(r.bundle),b=overlayRestore(source.contract,r.bundle)
  assert.deepEqual(r.bundle,before);assert.deepEqual(reservedFiles(b),[])
  assert.equal(b.strippedReservedSkills.length,6);assert.equal(b.deduplicatedCompanySkills.length,2)
  assert(!b.manifest.skills.some(s=>s.key.startsWith(RESERVED_SKILL_PREFIX)||s.key.startsWith('company/')))
  for(const [path,text] of Object.entries(original.files).filter(([p])=>p.startsWith('agents/')))assert.equal(b.files[path],text)
  const op=importOperation(b,{mode:'new_company'})
  assert.equal(op.body.source.expectedFileCount,Object.keys(before.files).length-8)
  assert.equal(op.body.source.expectedFileCount,Object.keys(op.body.source.files).length)
})
test('F15 company copies with divergent bodies, metadata, extra files or absent agent copies fail before import',async()=>{
  const f=await fixture(),r=await snapshotFixture(f),path=Object.keys(r.bundle.files).find(p=>p.startsWith('skills/company/'))
  for(const mutate of [b=>b.files[path]+='\nDivergent content',b=>{const doc=parseMarkdown(b.files[path]);doc.meta.metadata.version='different';b.files[path]=markdown(doc.meta,doc.body)},b=>b.files[path.replace('SKILL.md','unknown.md')]='extra',b=>delete b.files['agents/implementation-engineer/skills/focx-implement-task/SKILL.md'],b=>b.manifest.skills.push({key:'company/old/unknown',path:'missing/SKILL.md'})]) {
    const b=structuredClone(r.bundle);mutate(b)
    assert.throws(()=>overlayRestore(source.contract,b),/Company skill copy differs|Unmatched company skill manifest/)
  }
})
test('F15 strips affected embedded assets in both indexes, preserves shared blobs and owners',async()=>{
  const f=await fixture(),r=await snapshotFixture(f),b=r.bundle,{extension}=bundleExtension(b),path=reservedFiles(b)[0]
  const ids=['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333']
  const hashes=['a'.repeat(64),'b'.repeat(64)]
  const assets=ids.map((assetId,i)=>({assetId,sha256:hashes[i===0?0:1],ownedBy:i===1?['projects','skills']:['skills']}))
  const blobs=hashes.map(sha256=>({sha256,byteSize:1,contentType:'application/octet-stream'}))
  b.files[path]+=ids.map(id=>'\n/api/assets/'+id+'/content').join('')
  b.files['projects/connect/PROJECT.md']+='\n/api/assets/'+ids[1]+'/content'
  for(const hash of hashes)b.files['blobs/'+hash]={encoding:'base64',data:'YQ=='}
  for(const index of [extension,b.manifest]){index.blobs=structuredClone(blobs);index.embeddedAssets=structuredClone(assets)}
  b.files['.paperclip.yaml']=yaml(extension)
  const stripped=overlayRestore(source.contract,b)
  for(const index of [stripped.manifest,bundleExtension(stripped).extension]) {
    assert.deepEqual(index.embeddedAssets,[{...assets[1],ownedBy:['projects']}])
    assert.deepEqual(index.blobs,[blobs[1]])
  }
  assert(!Object.hasOwn(stripped.files,'blobs/'+hashes[0]));assert(Object.hasOwn(stripped.files,'blobs/'+hashes[1]))
})
test('F15 restored preview expects only singleton warnings; other warnings still fail before import',async()=>{
  const f=await fixture(),record=await snapshotFixture(f),io=memoryIO(),events=[]
  const opts={io,catalogCompanyId:'catalog-company',target:{mode:'new_company',newCompanyName:'Warning refused'},emit:e=>events.push(e)}
  const p=await restore(f.api,source,record,opts)
  f.api.state.extraWarnings=['Unexpected skill warning']
  const before=f.api.state.calls.filter(c=>c.path==='/api/companies/import').length
  await assert.rejects(restore(f.api,source,record,{...opts,apply:true,approvedDigest:p.digest}),/Unexpected native import preview warning/)
  assert.equal(f.api.state.calls.filter(c=>c.path==='/api/companies/import').length,before)
  f.api.state.extraWarnings=[]
  const preview=await f.api.request('POST','/api/companies/import/preview',p.changes[0].body)
  assert.deepEqual(preview.warnings,source.contract.agents.map(a=>expectedSkillWarning(a.slug)))
})
test('F15 restored inventory has only two package company skills, seeded reserved skills, exact desiredSkills and reported stripping',async()=>{
  const f=await roundTripFixture(),r=f.result,live=await readSnapshot(f.api,r.state.companyId)
  const skills=f.api.state.skills.filter(s=>s.companyId===r.state.companyId),imported=skills.filter(s=>s.origin==='package')
  assert.equal(imported.length,2);assert.equal(new Set(imported.map(s=>s.slug)).size,2)
  assert(imported.every(s=>s.key==='company/'+r.state.companyId+'/'+s.slug && s.packagePath.startsWith('agents/')))
  assert.equal(skills.filter(s=>s.origin==='bundled').length,5)
  assertInvariants(source.contract,live,[4,5])
  assert.equal(r.strippedReservedSkills.length,5);assert.equal(r.deduplicatedCompanySkills.length,2)
  assert.deepEqual((await f.restoreIO.readState()).restoration.strippedReservedSkills,r.strippedReservedSkills)
  const submitted=f.api.state.calls.filter(c=>c.path==='/api/companies/import').at(-1).body.source
  assert(!Object.keys(submitted.files).some(p=>p.startsWith('skills/company/')||p.startsWith('skills/'+RESERVED_SKILL_PREFIX)))
  assert.equal(submitted.expectedFileCount,Object.keys(submitted.files).length)
})
test('F15 final skill assertion rejects empty, additional and duplicated selections and reserved package files',async()=>{
  const f=await fixture(),record=await snapshotFixture(f),bundle=overlayRestore(source.contract,record.bundle)
  for(const desiredSkills of [[],['paperclipai/paperclip/paperclip','extra'],['paperclipai/paperclip/paperclip','paperclipai/paperclip/paperclip']]) {
    const live=structuredClone(f.live);live.agents[0].desiredSkills=desiredSkills
    assert.throws(()=>assertRestoredSkills(source.contract,live,bundle),/Invariant 5/)
  }
  assert.throws(()=>assertRestoredSkills(source.contract,f.live,record.bundle),/must not be imported/)
})
const f15Setup=[
  'const f=await fixture(),snapshotOpts={companyId:f.companyId,outputPath:"/fake/snapshot.json",io:f.io};',
  'const sp=await subject.snapshot(f.api,source,snapshotOpts),record=await subject.snapshot(f.api,source,{...snapshotOpts,apply:true,approvedDigest:sp.digest});',
  'const io=memoryIO(),opts={io,catalogCompanyId:"catalog-company",target:{mode:"new_company",newCompanyName:"F15 witness"}};',
  'const p=await subject.restore(f.api,source,record,opts);',
].join('\n')
knockout('F15 reserved strip: raw apply must be rejected','src/portability.mjs',s=>s.replace('removeSkillFiles(result,reservedFiles,s=>s.key?.startsWith(RESERVED_SKILL_PREFIX) || reservedFiles.includes(s.path))','/* reserved strip knocked out */'),f15Setup+'await subject.restore(f.api,source,record,{...opts,apply:true,approvedDigest:p.digest});')
knockout('F15 company de-duplication','src/portability.mjs',s=>s.replace('  deduplicateCompanySkills(contract,result)','  /* company de-duplication knocked out */'),f15Setup+'const r=await subject.restore(f.api,source,record,{...opts,apply:true,approvedDigest:p.digest});assert.equal(f.api.state.skills.filter(s=>s.companyId===r.state.companyId && s.origin==="package").length,2,"duplicate company skills imported");')
knockout('F15 post-import singleton assertion','src/portability.mjs',s=>s.replace('    assertRestoredSkills(source.contract,live,bundle)','    /* final skill assertion knocked out */'),f15Setup+[
  'const request=f.api.request.bind(f.api);let injected=false;',
  'f.api.request=async(m,p,b)=>{const r=await request(m,p,b);if(p.includes("/adapters/claude_local/models") && !p.includes("/catalog-company/")){f.api.state.agents.find(a=>a.companyId!==f.companyId).desiredSkills=[];injected=true}return r};',
  'await assert.rejects(subject.restore(f.api,source,record,{...opts,apply:true,approvedDigest:p.digest}),/Invariant 5/);',
  'assert(injected);assert.equal((await io.readState()).failedStep,"restore-comparison");',
].join('\n'))

// F16: retained .focx loader coverage and source mutations.
const roleSource=loadRoleSource()
test('all retained identities and role procedures load offline',()=>{assert.equal(roleSource.manifest.agents.length,26);assert.equal(Object.keys(roleSource.files).length,roleSource.manifest.expectedPilotRoles.length)})
// Rebuild the source from the real files with one mutation applied, so every
// rejection below exercises the same validation the CLI runs.
const readRepo=p=>readFileSync(resolve(ROLE_ROOT,p),'utf8')
const rebuilt=(mutate,read=readRepo)=>{const manifest=structuredClone(roleSource.manifest),invariants=structuredClone(roleSource.invariants);mutate?.(manifest,invariants);return buildRoleSource({manifest,invariants,baseline:roleSource.baseline,read})}
const qaOf=m=>m.agents.find(a=>a.roleKey==='qa-engineer')
test('the committed QA entry records a reviewed Claude migration and its adapter-local tooling',()=>{const qa=qaOf(roleSource.manifest);assert.equal(qa.adapterType,'claude_local');assert.equal(qa.maxTurnsPerRun,20);assert.deepEqual(qa.adapterMigration,{from:'codex_local',to:'claude_local',approvedBy:'Ryan Thomas',date:'2026-09-04'});assert.deepEqual(qa.adapterLocal.claudeCodePlugins,['differential-review@trailofbits','pr-review-toolkit@claude-plugins-official','spec-to-code-compliance@trailofbits']);assert(qa.adapterLocal.permissionsAllow.includes('Task(pr-review-toolkit:silent-failure-hunter)'));assert(qa.adapterLocal.permissionsAllow.includes('Edit(/pipeline/runs/**)'));assert(!qa.adapterLocal.permissionsAllow.some(r=>r==='Edit'||r.startsWith('Write')||r==='Bash'||r.startsWith('Skill')));assert.deepEqual(qa.adapterLocal.permissionsDeny,['Edit','NotebookEdit','Skill']);assert.deepEqual(qa.executionPermissions,{permissionMode:'approve-reads',nonInteractivePermissions:'deny'})})
// A pilot that cannot write to its task reports nothing. The rule and the file
// it names have to travel together: Paperclip allow-lists this path in every
// worktree but ships no script, and a rule pointing at a missing file is the
// same silence as no rule at all.
test('QA can report through the committed script, and the script is really there',()=>{const qa=qaOf(roleSource.manifest)
  assert(qa.adapterLocal.permissionsAllow.includes('Bash(scripts/paperclip-issue-update.sh:*)'),'QA has no rule permitting the reporting script')
  const path=resolve(ROLE_ROOT,'scripts/paperclip-issue-update.sh')
  assert(existsSync(path),'the allow-listed reporting script is not committed')
  assert(statSync(path).mode & 0o111,'the reporting script is not executable')
  const body=readFileSync(path,'utf8')
  // Reading these from the environment is the whole point: a call site that
  // needs `$` matches no permission rule and is denied unattended.
  for(const key of ['PAPERCLIP_API_URL','PAPERCLIP_API_KEY','PAPERCLIP_TASK_ID']) assert(body.includes(key),`the script does not read ${key} from the environment`)})
test('a procedure may version past 0.1.0 but must stay semver',()=>{const path='.focx/skills/focx-verify-change/SKILL.md';assert(readRepo(path).includes('version: "0.1.4"'));rebuilt(null,p=>p===path?readRepo(p).replace('version: "0.1.4"','version: "0.2.0"'):readRepo(p));assert.throws(()=>rebuilt(null,p=>p===path?readRepo(p).replace('version: "0.1.4"','version: "0.1"'):readRepo(p)),/versioned/)})
for(const [label,mutate] of Object.entries({
  'a migration between the same adapter':m=>{qaOf(m).adapterMigration.to='codex_local';qaOf(m).adapterMigration.from='codex_local'},
  'a migration whose target differs from adapterType':m=>{qaOf(m).adapterMigration.to='codex_local'},
  'a migration with no approver':m=>{qaOf(m).adapterMigration.approvedBy=''},
  'a migration with a non-ISO date':m=>{qaOf(m).adapterMigration.date='Sept 4'},
  'adapterLocal on a Codex agent':m=>{const e=m.agents.find(a=>a.roleKey==='implementation-engineer');e.adapterLocal={claudeCodePlugins:[]}},
  'a bare plugin name':m=>{qaOf(m).adapterLocal.claudeCodePlugins=['pr-review-toolkit']},
  'a plugin:skill name':m=>{qaOf(m).adapterLocal.claudeCodePlugins=['design:critique']},
  'a Paperclip registry key':m=>{qaOf(m).adapterLocal.claudeCodePlugins=['paperclipai/paperclip/paperclip']},
  'a duplicate plugin':m=>{qaOf(m).adapterLocal.claudeCodePlugins.push('differential-review@trailofbits')},
  'a bare Bash rule':m=>{qaOf(m).adapterLocal.permissionsAllow.push('Bash')},
  'a bare Write rule':m=>{qaOf(m).adapterLocal.permissionsAllow.push('Write')},
  'an unanchored Edit path rule':m=>{qaOf(m).adapterLocal.permissionsAllow.push('Edit(pipeline/runs/**)')},
  'a Task for an undeclared plugin':m=>{qaOf(m).adapterLocal.permissionsAllow.push('Task(feature-dev:code-reviewer)')},
  'a file rule outside evidence':m=>{qaOf(m).adapterLocal.permissionsAllow.push('Edit(/src/**)')},
  'a missing Edit tool denial':m=>{qaOf(m).adapterLocal.permissionsDeny=['NotebookEdit','Skill']},
  'a skill invocation grant':m=>{qaOf(m).adapterLocal.permissionsAllow.push('Skill(differential-review:diff-review)')},
  'a malformed rule':m=>{qaOf(m).adapterLocal.permissionsAllow.push('bash(ls)')},
}))test(`source refuses ${label}`,()=>{assert.throws(()=>rebuilt(mutate))})

// Each witness removes one validation in memory, accepts its otherwise-valid
// counterexample, then confirms the real module still refuses it. This covers
// every guard exercised by the committed control files, including read guards.
const roleGuardCases=[
  ['adapterMigration must move',({qa})=>{qa.adapterMigration.from='claude_local'}],
  ['adapterMigration.to must equal',({qa})=>{qa.adapterMigration.from='claude_local';qa.adapterMigration.to='codex_local'}],
  ['adapterMigration needs approvedBy',({qa})=>{qa.adapterMigration.approvedBy=' '}],
  ['adapterLocal is only meaningful',({qa})=>{qa.adapterType='codex_local';delete qa.adapterMigration}],
  ['claudeCodePlugins must be unique',({qa})=>{qa.adapterLocal.claudeCodePlugins.push(qa.adapterLocal.claudeCodePlugins[0])}],
  ['permissionDelivery must be a',({qa})=>{qa.adapterLocal.permissionDelivery='user-settings'}],
  ['permissionsAllow must be unique',({qa})=>{qa.adapterLocal.permissionsAllow.push('Read')}],
  ['deny actual Edit',({qa})=>{qa.adapterLocal.permissionsDeny=['NotebookEdit','Skill']}],
  ['file modifications must be anchored',({qa})=>{qa.adapterLocal.permissionsAllow.push('Edit(/src/**)')}],
  ['Write(path) rules are ineffective',({qa})=>{qa.adapterLocal.permissionsAllow.push('Write(/pipeline/runs/**)')}],
  ['skill invocation may pre-approve',({qa})=>{qa.adapterLocal.permissionsAllow.push('Skill(differential-review:diff-review)')}],
  ['bare Bash would allow',({qa})=>{qa.adapterLocal.permissionsAllow.push('Bash')}],
  ['names tooling outside',({qa})=>{qa.adapterLocal.permissionsAllow.push('Task(undeclared:review)')}],
  ['Pilot controls must prohibit',({invariants})=>{invariants.pilot.automaticWork=true}],
  ['Locked Focx baseline changed',({invariants})=>{invariants.activeProducts.push('Unapproved')}],
  ['All 26 retained identities',({manifest})=>{manifest.expectedAgentCount=25}],
  ['Duplicate agent identity',({manifest})=>{const disabled=manifest.agents.filter(a=>a.disposition==='disabled-candidate');disabled[0].id=disabled[1].id}],
  ['Pilot roles must match the manifest declaration exactly',({manifest,overrides})=>{const a=manifest.agents.find(a=>a.roleKey==='implementation-engineer');const body=readRepo(a.instructions);a.roleKey='other-engineer';a.instructions='.focx/roles/other-engineer.md';overrides[a.instructions]=body}],
  ['Invalid retained identity or disposition',({manifest})=>{manifest.agents.find(a=>a.disposition==='disabled-candidate').status='active'}],
  ['Pilot must have human ownership',({qa})=>{qa.permissions.canAssignTasks=true}],
  ['Per-run timeout cannot be relaxed',({qa})=>{qa.timeoutSec=901}],
  ['Uncapped runs require explicit',({invariants})=>{invariants.pilot.environment='production'}],
  ['Unknown adapter',({manifest})=>{manifest.agents.find(a=>a.roleKey==='implementation-engineer').adapterType='unknown'}],
  ['Pilot ACP permissions must be explicit',({qa})=>{qa.executionPermissions.nonInteractivePermissions='allow'}],
  ['Claude turn limit required',({qa})=>{qa.maxTurnsPerRun=21}],
  ['Instructions must be isolated',({qa,overrides})=>{overrides['other-role.md']=readRepo(qa.instructions);qa.instructions='other-role.md'}],
  ['Only scoped focx-* skills',({qa,overrides})=>{qa.skills=['other'];overrides['.focx/skills/other/SKILL.md']='version: "0.1.0"'}],
  ['Procedure must be versioned',({qa,overrides})=>{overrides['.focx/skills/'+qa.skills[0]+'/SKILL.md']='version: "0.1"'}],
  ['Empty role instructions',({qa,overrides})=>{overrides[qa.instructions]=' \n'}],
  ['Project settings must mirror',({overrides})=>{overrides['.claude/settings.json']='{}'}],
  ['Missing the worktree-local permission launcher',({overrides})=>{overrides['tools/qa-claude-agent-acp/index.mjs']='\n'}],
]
const roleInput=mutate=>{
  const manifest=structuredClone(roleSource.manifest),invariants=structuredClone(roleSource.invariants),overrides={}
  mutate({manifest,invariants,qa:qaOf(manifest),overrides})
  return {manifest,invariants,baseline:roleSource.baseline,read:p=>Object.hasOwn(overrides,p)?overrides[p]:readRepo(p)}
}
for(const [message,mutate] of roleGuardCases)test('KNOCK-OUT role source: '+message,async()=>{
  const original=await import('./src/roles.mjs'),text=readFileSync(resolve(PACKAGE,'src/roles.mjs'),'utf8')
  const guards=text.split('\n').filter(line=>line.includes('requireThat(')&&line.includes(message))
  assert.equal(guards.length,1,'Each witness must identify exactly one guard')
  const witness=subject=>assert.throws(()=>subject.buildRoleSource(roleInput(mutate)),error=>error.message.includes(message))
  witness(original)
  const changed=text.replace(guards[0],'/* knocked out */').replaceAll('import.meta.url',JSON.stringify(url('src/roles.mjs')))
  const broken=await import('data:text/javascript;base64,'+Buffer.from(changed).toString('base64'))
  assert.doesNotThrow(()=>broken.buildRoleSource(roleInput(mutate)),'Only the removed guard should reject this counterexample')
  assert.throws(()=>witness(broken),assert.AssertionError)
  witness(original)
  console.log('KNOCK-OUT role source '+message+': guard broken -> witness FAIL; restored -> PASS')
})
test('role loader preserves all returned control, bundle and launcher content',()=>{
  assert.deepEqual(loadRoleSource(ROLE_ROOT),roleSource)
  assert.deepEqual(roleSource.baseline,JSON.parse(readRepo('.focx/baseline.yaml')))
  assert.deepEqual(roleSource.invariants,JSON.parse(readRepo('.focx/invariants.yaml')))
  for(const a of roleSource.manifest.agents.filter(a=>a.disposition==='pilot')){
    assert.equal(roleSource.files[a.id]['AGENTS.md'],readRepo(a.instructions))
    for(const skill of a.skills)assert.equal(roleSource.files[a.id]['skills/'+skill+'/SKILL.md'],readRepo('.focx/skills/'+skill+'/SKILL.md'))
  }
  assert.deepEqual(roleSource.runtimeFiles,{'tools/qa-claude-agent-acp/index.mjs':readRepo('tools/qa-claude-agent-acp/index.mjs')})
})
test('role source preserves malformed JSON and missing source file refusals',()=>{
  assert.throws(()=>rebuilt(null,p=>p==='.claude/settings.json'?'invalid JSON':readRepo(p)),SyntaxError)
  for(const path of [qaOf(roleSource.manifest).instructions,'.focx/skills/focx-verify-change/SKILL.md','tools/qa-claude-agent-acp/index.mjs']){
    assert.throws(()=>rebuilt(null,p=>{if(p===path)throw Error('missing source file');return readRepo(p)}),/missing source file/)
  }
})

// F18 witnesses also run against source knock-outs below.
async function bindingFixture() {
  const f=await fixture({bound:false})
  f.api.state.secrets=source.contract.secrets.map((s,i)=>({id:`secret-${i}`,name:s.name,companyId:f.companyId}))
  f.api.state.calls.length=0;f.io.writes.length=0
  return f
}
async function resumeWitness(bind) {
  const f=await bindingFixture(),emitted=[],opts={io:f.io,emit:e=>emitted.push(e)}
  const p=await bind(f.api,source,opts)
  await assert.rejects(bind(f.api,source,{...opts,apply:true,approvedDigest:p.digest,provisionPlugins:async()=>{throw new Error('synthetic install failure')}}),e=>e.step==='host-plugins')
  const failed=await f.io.readState()
  assert.equal(failed.phase,'awaiting-plugin-auth')
  assert.deepEqual(failed.pluginFailure,{key:'host-plugins',message:'Host plugin provisioning failed; runtime output withheld; inspect the runtime manager by hand before resuming bind-secrets'})
  assert.equal(secretLinkFindings(source.contract,await readSnapshot(f.api,f.companyId)).length,0)
  const before=structuredClone(f.api.state.agents)
  f.api.state.calls.length=0;f.io.writes.length=0
  const next=await bind(f.api,source,opts)
  assert.equal(f.io.writes.length,0);assert.equal(writes(f.api).length,0)
  let pluginCalls=0
  const result=await bind(f.api,source,{...opts,apply:true,approvedDigest:next.digest,provisionPlugins:async()=>{
    pluginCalls++
    assert(f.io.locked)
    const calls=f.api.state.calls,patches=calls.filter(c=>c.method==='PATCH')
    assert.equal(patches.length,2)
    assert.deepEqual(patches,p.changes)
    // Snapshot reads occur between PATCHes and after the final PATCH.
    const positions=calls.flatMap((c,i)=>c.method==='PATCH'?[i]:[])
    for(const [i,start] of positions.entries())assert(calls.slice(start+1,positions[i+1]).some(c=>c.method==='GET'&&c.path.endsWith('/secrets/catalog')))
    assert.equal(secretLinkFindings(source.contract,await readSnapshot(f.api,f.companyId)).length,0)
    return {needsAuth:[]}
  }})
  assert.equal(result.complete,true);assert.equal(pluginCalls,1)
  assert.deepEqual(f.api.state.agents,before)
  const done=await f.io.readState();assert.equal(done.phase,'configured')
  assert(!Object.hasOwn(done,'pluginFailure'));assert(!Object.hasOwn(done,'failedStep'));assert.equal(f.io.locked,false)
}
async function envFailureWitness(bind) {
  const f=await bindingFixture(),opts={io:f.io},p=await bind(f.api,source,opts)
  f.api.state.fail=({method})=>method==='PATCH'
  let pluginCalls=0
  await assert.rejects(bind(f.api,source,{...opts,apply:true,approvedDigest:p.digest,provisionPlugins:async()=>{pluginCalls++;return {needsAuth:[]}}}),e=>e.step===3)
  const state=await f.io.readState();assert.equal(state.phase,'failed');assert.equal(state.failedStep,3)
  assert.equal(pluginCalls,0);assert(!state.pluginFailure)
  f.api.state.fail=null;f.api.state.calls.length=0;f.io.writes.length=0
  await assert.rejects(bind(f.api,source,opts),/failed jobs are not retried/)
  await assert.rejects(bind(f.api,source,{...opts,apply:true,approvedDigest:p.digest}),/failed jobs are not retried/)
  assert.equal(writes(f.api).length,0);assert.equal(f.io.writes.length,0)
}
async function credentialFailureWitness(bind) {
  // Deliberately synthetic token shapes; no credential is loaded or printed.
  for(const marker of ['sk-'+ 'x'.repeat(48),'ghp_'+ 'x'.repeat(36),'Bearer '+ 'x'.repeat(40),'eyJfake.eyJfake.signature','arbitrary private diagnostic']) {
    const f=await bindingFixture(),emitted=[],opts={io:f.io,emit:e=>emitted.push(e)},p=await bind(f.api,source,opts)
    const error=Object.assign(new Error(marker),{key:marker,stdout:marker,stderr:marker})
    let failure
    try{await bind(f.api,source,{...opts,apply:true,approvedDigest:p.digest,provisionPlugins:async()=>{throw error}})}catch(e){failure=e}
    assert(failure)
    const state=await f.io.readState();assert.equal(state.phase,'awaiting-plugin-auth')
    assert.deepEqual(Object.keys(state.pluginFailure).sort(),['key','message'])
    const evidence=JSON.stringify({state,writes:f.io.writes,emitted,error:failure.message,errorState:failure.state})
    assert.equal(evidence.includes(marker),false,'private diagnostic must be withheld')
    assert.doesNotMatch(JSON.stringify(state.pluginFailure),/sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|Bearer\s+\S+|eyJ[^ ]*\./)
  }
}
async function authWitness(run,{race=false}={}) {
  const f=await bindingFixture(),seen=[],emitted=[],original=console.log
  let present=race,pluginCalls=0
  const host={exists:path=>{seen.push(path);return present}}
  const pluginInventory=catalogEntries(source.contract.skills).filter(e=>e.pinned&&e.adapter==='claude_local').map(e=>({...e,sourceSha:e.source?.sha,installed:true}))
  const runtime={...f,host,pluginInventory,provisionPlugins:async()=>{pluginCalls++;return {needsAuth:[]}}}
  console.log=(...args)=>emitted.push(args)
  try{
    if(!race){
      for(const flags of [[],['--apply','--approved-digest','unused']]) {
        await assert.rejects(run(['bind-secrets','--fake',...flags],runtime),e=>e.message.includes(`CODEX_HOME=/fake-instance/companies/${f.companyId}/codex-home`))
        assert.equal(f.api.state.calls.filter(c=>c.method==='PATCH').length,0)
        assert.equal(writes(f.api).length,0);assert.equal(f.io.writes.length,0)
        assert(!emitted.some(args=>args.some(s=>typeof s==='string'&&s.includes('"LOCK"'))))
      }
    }else{
      await run(['bind-secrets','--fake'],runtime)
      const p=JSON.parse(emitted.at(-1)[0])
      const acquire=f.io.acquire;f.io.acquire=async()=>{const release=await acquire();present=false;return release}
      await assert.rejects(run(['bind-secrets','--fake','--apply','--approved-digest',p.digest],runtime),e=>e.step==='host-plugins')
      assert.equal(f.api.state.calls.filter(c=>c.method==='PATCH').length,2)
      assert.equal((await f.io.readState()).phase,'awaiting-plugin-auth')
    }
    assert.equal(pluginCalls,0);assert(seen.every(p=>p===`/fake-instance/companies/${f.companyId}/codex-home/auth.json`))
  }finally{console.log=original}
}
test('F18 host-plugin failure resumes, reissues and re-verifies env, then clears failure',()=>resumeWitness(bindSecrets))
test('F18 env failure remains terminal and the next binding is refused',()=>envFailureWitness(bindSecrets))
test('F18 pluginFailure and emitted errors withhold all private runtime diagnostics',()=>credentialFailureWitness(bindSecrets))
test('F18 CLI missing auth refuses plan and apply with zero PATCHes and zero state writes',()=>authWitness(main))
test('F18 CLI repeats auth gate after env to catch plan/apply races',()=>authWitness(main,{race:true}))

const bindingSetup=bindingFixture.toString()+';'
const resumeSetup=bindingSetup+resumeWitness.toString()+`;const {secretLinkFindings}=await import(${JSON.stringify(url('src/fresh.mjs'))});await resumeWitness(subject.bindSecrets);`
knockout('F18 resumable plugin failure phase','src/fresh.mjs',s=>s.replace("failedStep==='host-plugins'?'awaiting-plugin-auth':'failed'","'failed'"),resumeSetup)
knockout('F18 resume entry guard','src/fresh.mjs',s=>s.replace("['awaiting-secret-entry','awaiting-plugin-auth']","['awaiting-secret-entry']"),resumeSetup)
knockout('F18 env failure retry refusal','src/fresh.mjs',s=>s.replace("['awaiting-secret-entry','awaiting-plugin-auth']","['awaiting-secret-entry','awaiting-plugin-auth','failed']"),bindingSetup+envFailureWitness.toString()+';await envFailureWitness(subject.bindSecrets);')
knockout('F18 plugin diagnostic withholding','src/fresh.mjs',s=>s.replace('      catch{','      catch(error){').replace("message:'Host plugin provisioning failed; runtime output withheld; inspect the runtime manager by hand before resuming bind-secrets'","message:error.message"),bindingSetup+credentialFailureWitness.toString()+';await credentialFailureWitness(subject.bindSecrets);')
knockout('F18 failure cleared on success','src/fresh.mjs',s=>s.replace('delete state.pluginFailure;delete state.failedStep','/* knocked out */'),resumeSetup)
const authSetup=bindingSetup+authWitness.toString()+`;const {catalogEntries}=await import(${JSON.stringify(url('src/skills.mjs'))});`
knockout('F18 auth preflight before any write','src/index.mjs',s=>s.replace('    checkPluginAuth()','    /* knocked out */'),authSetup+'await authWitness(subject.main);')
knockout('F18 second auth gate','src/index.mjs',s=>s.replace('      checkPluginAuth()','      /* knocked out */'),authSetup+'await authWitness(subject.main,{race:true});')

async function resumeGuardWitness(bind,kind) {
  const f=await bindingFixture(),opts={io:f.io},p=await bind(f.api,source,opts)
  await assert.rejects(bind(f.api,source,{...opts,apply:true,approvedDigest:p.digest,provisionPlugins:async()=>{throw new Error('synthetic')}}))
  assert.equal((await f.io.readState()).phase,'awaiting-plugin-auth')
  const next=await bind(f.api,source,opts)
  let pluginCalls=0
  if(kind==='lock')f.io.locked=true
  if(kind==='state-race' || kind==='live-race'){
    const acquire=f.io.acquire
    f.io.acquire=async()=>{
      const release=await acquire()
      if(kind==='state-race'){const state=await f.io.readState();state.digest='concurrent';await f.io.save(state)}
      else f.api.state.agents[0].title='Concurrent edit'
      return release
    }
  }
  if(kind==='invariants')f.api.state.agents[0].status='idle'
  if(kind==='ids'){const state=await f.io.readState();state.ids['qa-engineer']='unexpected-id';await f.io.save(state)}
  if(kind==='contract'){const state=await f.io.readState();state.contractSha='changed';await f.io.save(state)}
  if(kind==='readback' || kind==='between-operations' || kind==='post-operation'){
    const request=f.api.request.bind(f.api);let patches=0
    f.api.request=async(m,p,b)=>{
      const result=await request(m,p,b)
      if(kind==='post-operation' && m==='GET' && p.endsWith('/configuration'))f.api.state.agents[0].adapterConfig.dangerouslyBypassApprovalsAndSandbox=false
      if(m==='PATCH'){
        patches++
        if(kind==='readback' && patches===2)f.api.state.agents[0].adapterConfig.env.GH_TOKEN={type:'secret_ref',secretId:'wrong'}
        if(kind==='between-operations' && patches===1)f.api.state.agents[0].status='idle'
        if(kind==='post-operation' && patches===1)f.api.state.agents[0].adapterConfig.dangerouslyBypassApprovalsAndSandbox=true
      }
      return result
    }
  }
  f.api.state.calls.length=0;f.io.writes.length=0
  await assert.rejects(bind(f.api,source,{...opts,apply:true,approvedDigest:kind==='digest'?'wrong':next.digest,provisionPlugins:async()=>{pluginCalls++;return {needsAuth:[]}}}),kind==='ids'?/Persisted generated ids differ/:undefined)
  assert.equal(pluginCalls,0)
  const patches=f.api.state.calls.filter(c=>c.method==='PATCH').length
  assert.equal(patches,kind==='readback'?2:['between-operations','post-operation'].includes(kind)?1:0)
  if(['state-race','live-race','readback','between-operations','post-operation'].includes(kind)){
    const failed=await f.io.readState();assert.equal(failed.phase,'failed');assert.equal(failed.failedStep,3)
    await assert.rejects(bind(f.api,source,opts),/failed jobs are not retried/)
  }else assert.equal(f.io.writes.length,0)
}
for(const kind of ['digest','lock','state-race','live-race','invariants','ids','contract','readback','between-operations','post-operation'])test(`F18 resumed binding retains ${kind} guard`,()=>resumeGuardWitness(bindSecrets,kind))
const resumeGuardSetup=bindingSetup+resumeGuardWitness.toString()+';'
for(const [kind,needle,replacement='/* knocked out */']of [
  ['digest',"requireThat(options.approvedDigest===digest, 'Secret binding digest is missing or stale')"],
  ['lock',"announce(emit,{method:'LOCK',path:io.lockPath});const release=await io.acquire()","announce(emit,{method:'LOCK',path:io.lockPath});const release=async()=>{}"],
  ['state-race',"requireThat(same(await io.readState(),state), 'Import state changed before binding')"],
  ['live-race',"requireThat(hash(await readSnapshot(api,state.companyId))===hash(live), 'Live state changed before binding')"],
  ['ids',"requireThat(same(idMap(live),state.ids), 'Persisted generated ids differ from readback')"],
  ['readback',"requireThat(secretLinkFindings(contract,after).length===0, 'Post-binding secret-link check failed')"],
  ['between-operations',"assertInvariants(contract,await readSnapshot(api,state.companyId))"],
  ['post-operation',"assertInvariants(contract,await readSnapshot(api,state.companyId),[8])","await readSnapshot(api,state.companyId)"],
])knockout(`F18 resumed ${kind} guard`,'src/fresh.mjs',s=>s.replace(needle,replacement),resumeGuardSetup+`await resumeGuardWitness(subject.bindSecrets,${JSON.stringify(kind)});`)
knockout('F18 resumed env PATCHes cannot be skipped','src/fresh.mjs',s=>s.replace('for (const op of operations)','for (const op of state.phase===\'awaiting-plugin-auth\'?[]:operations)'),resumeSetup)
test('F18 failed local persistence is attempted once and never reported as success',async()=>{
  for(const pluginFails of [false,true]){
    const f=await bindingFixture(),opts={io:f.io},p=await bindSecrets(f.api,source,opts);let saves=0
    f.io.save=async()=>{saves++;throw new Error('synthetic persistence failure')}
    await assert.rejects(bindSecrets(f.api,source,{...opts,apply:true,approvedDigest:p.digest,provisionPlugins:async()=>{if(pluginFails)throw new Error('synthetic plugin failure');return {needsAuth:[]}}}))
    assert.equal(saves,1);assert.equal(f.io.locked,false)
  }
})

test('F18 fake CLI completes after auth is present without starting a host manager',async()=>{
  const f=await bindingFixture(),emitted=[],original=console.log
  const runtime={...f,host:{exists:()=>true},pluginInventory:catalogEntries(source.contract.skills).filter(e=>e.pinned&&e.adapter==='claude_local').map(e=>({...e,sourceSha:e.source?.sha,installed:true})),provisionPlugins:async()=>({needsAuth:[]})}
  console.log=(...args)=>emitted.push(args)
  try{
    await main(['bind-secrets','--fake'],runtime)
    const p=JSON.parse(emitted.at(-1)[0])
    await main(['bind-secrets','--fake','--apply','--approved-digest',p.digest],runtime)
    assert.equal((await f.io.readState()).phase,'configured')
    assert.equal(f.api.state.calls.filter(c=>c.method==='PATCH').length,2)
  }finally{console.log=original}
})
test('F18 successful provisioning clears old failure while retaining manual app auth phase',async()=>{
  const f=await bindingFixture(),opts={io:f.io},p=await bindSecrets(f.api,source,opts)
  await assert.rejects(bindSecrets(f.api,source,{...opts,apply:true,approvedDigest:p.digest,provisionPlugins:async()=>{throw new Error('synthetic')}}))
  const next=await bindSecrets(f.api,source,opts),needsAuth=[{plugin:'fixture@market',appId:'fixture-app',action:'Ryan authenticates by hand'}]
  const result=await bindSecrets(f.api,source,{...opts,apply:true,approvedDigest:next.digest,provisionPlugins:async()=>({needsAuth})})
  const state=await f.io.readState()
  assert.equal(result.complete,false);assert.equal(state.phase,'awaiting-plugin-auth')
  assert.deepEqual(state.pluginAuth,needsAuth);assert(!state.pluginFailure);assert(!state.failedStep)
})

// F19: the real reader and executor run against in-memory metadata, never a CLI.
async function manifestlessWitness(reader,execute) {
  const f=memoryPluginInventory(),readInventory=()=>reader(f.contract,'/fake-company',f.options)
  let installed=false,calls=0
  await execute([f.operation],{readInventory:()=>installed?readInventory():[],emit:()=>{},run:()=>{installed=true;calls++}})
  assert.equal(calls,1)
  const row=readInventory().find(r=>r.installed)
  assert(row);assert.equal(row.gitCommitSha,f.entry.source.sha)
  assert.equal(row.version,f.record.version)
}
async function skipWitness(execute) {
  const f=memoryPluginInventory(),rows=[],events=[]
  let calls=0,reads=0
  await execute([f.operation,f.operation],{readInventory:()=>{reads++;return structuredClone(rows)},emit:e=>events.push(e),run:()=>{calls++;rows.push({...f.entry,installed:true,sourceSha:f.entry.source.sha})}})
  assert.equal(calls,1,'matching pin was reinstalled')
  assert.equal(reads,3,'inventory must refresh before each operation and after install')
  assert.deepEqual(events,[{write:f.operation},{skipped:f.operation,reason:'Installed plugin already matches the pin'}])
}
test('F19 manifest-less commit pin passes real inventory readback after install',()=>manifestlessWitness(readPluginInventory,executePluginOperations))
test('F19 missing or malformed manifest preserves records and a readable manifest refines version',()=>{
  for(const manifest of [undefined,'{broken','null',JSON.stringify({version:'1.2.3'})]){
    const f=memoryPluginInventory({manifest}),rows=readPluginInventory(f.contract,'/fake-company',f.options)
    const row=rows.find(r=>r.installed);assert(row);assert(pluginReadbackMatches(f.entry,row))
    assert.equal(row.version,manifest?.includes('1.2.3')?'1.2.3':f.record.version)
    assert(f.host.reads.every(p=>!p.endsWith('/auth.json')));assert.equal(f.host.writes.length,0)
  }
})
test('F19 manifest-less install ID fails a version pin and cannot be skipped',async()=>{
  const f=memoryPluginInventory({pin:'version',version:'1.2.3'}),events=[]
  const readInventory=()=>readPluginInventory(f.contract,'/fake-company',f.options)
  let calls=0
  assert(!pluginReadbackMatches(f.entry,readInventory().find(r=>r.installed)))
  await assert.rejects(executePluginOperations([f.operation],{readInventory,emit:e=>events.push(e),run:()=>{calls++}}),/Plugin pin readback failed/)
  assert.equal(calls,1);assert.equal(events.filter(e=>e.skipped).length,0)
  f.host.files[f.manifestPath]=JSON.stringify({version:'1.2.3'})
  assert(pluginReadbackMatches(f.entry,readInventory().find(r=>r.installed)))
  delete f.host.files[f.manifestPath]
  f.host.files[f.inventoryPath]=JSON.stringify({plugins:{[f.entry.key]:[{...f.record,version:'1.2.3'}]}})
  assert(pluginReadbackMatches(f.entry,readInventory().find(r=>r.installed)))
})
test('F19 mismatched commits fail readback without skipping; gitCommitSha retains version check',async()=>{
  for(const pin of ['manifestSha','gitCommitSha']){
    const f=memoryPluginInventory({pin,version:'1.2.3',manifest:JSON.stringify({version:'1.2.3'})}),events=[]
    if(pin==='gitCommitSha')f.entry.gitCommitSha=f.record.gitCommitSha
    f.host.files[f.inventoryPath]=JSON.stringify({plugins:{[f.entry.key]:[{...f.record,gitCommitSha:'wrong'}]}})
    const readInventory=()=>readPluginInventory(f.contract,'/fake-company',f.options)
    let calls=0
    await assert.rejects(executePluginOperations([f.operation],{readInventory,emit:e=>events.push(e),run:()=>{calls++}}),/Plugin pin readback failed/)
    assert.equal(calls,1);assert.equal(events.filter(e=>e.skipped).length,0)
    f.host.files[f.inventoryPath]=JSON.stringify({plugins:{[f.entry.key]:[{...f.record,version:'1.2.3'}]}})
    delete f.host.files[f.manifestPath]
    const row=readInventory().find(r=>r.installed);assert(pluginReadbackMatches(f.entry,row))
    if(pin==='gitCommitSha')assert(!pluginReadbackMatches(f.entry,{...row,version:'wrong'}))
  }
})
test('F19 content pin hashes payload; an unreadable record cannot hide the next good one',()=>{
  const f=memoryPluginInventory({pin:'contentHash'}),path=resolve(PACKAGE,'native-schema')
  f.entry.contentHash=contentHash(path)
  f.host.files[f.inventoryPath]=JSON.stringify({plugins:{[f.entry.key]:[null,{installPath:42},{...f.record,installPath:'/missing-f19-payload'},{...f.record,installPath:path}]}})
  const rows=readPluginInventory(f.contract,'/fake-company',f.options).filter(r=>r.installed)
  assert.equal(rows.length,1);assert(pluginReadbackMatches(f.entry,rows[0]))
  assert(!pluginReadbackMatches({...f.entry,contentHash:'wrong'},rows[0]))
})
test('F19 unreadable inventory is failure-tolerant and marketplace failure cannot hide installed records',()=>{
  const f=memoryPluginInventory()
  for(const marketplace of [undefined,'{broken']){
    if(marketplace)f.host.files['/fake-user/.claude/plugins/marketplaces/fixture/.claude-plugin/marketplace.json']=marketplace
    assert(readPluginInventory(f.contract,'/fake-company',f.options).some(r=>r.installed))
  }
  for(const inventory of [undefined,'{broken','null']){
    if(inventory===undefined)delete f.host.files[f.inventoryPath];else f.host.files[f.inventoryPath]=inventory
    assert.deepEqual(readPluginInventory(f.contract,'/fake-company',f.options),[])
  }
})
test('F19 execution refreshes inventory and reports already-satisfied skips',()=>skipWitness(executePluginOperations))
test('F19 available-only matching rows never skip installation',async()=>{
  const f=memoryPluginInventory();let calls=0
  await assert.rejects(executePluginOperations([f.operation],{readInventory:()=>[{...f.entry,available:true,sourceSha:f.entry.source.sha}],emit:()=>{},run:()=>{calls++}}),/Plugin pin readback failed/)
  assert.equal(calls,1)
})
const f19Setup=`const {memoryPluginInventory}=await import(${JSON.stringify(url('src/fake-api.mjs'))});`
knockout('F19 optional manifest tolerance','src/plugins.mjs',s=>s.replace("try{definition=readJson(join(p.installPath,'.claude-plugin/plugin.json'))}catch{}","definition=readJson(join(p.installPath,'.claude-plugin/plugin.json'))"),f19Setup+manifestlessWitness.toString()+';await manifestlessWitness(subject.readPluginInventory,subject.executePluginOperations);')
knockout('F19 already-satisfied skip','src/plugins.mjs',s=>s.replace("      continue\n    }\n    emit({write:op})","      /* skip knocked out */\n    }\n    emit({write:op})"),f19Setup+skipWitness.toString()+';await skipWitness(subject.executePluginOperations);')

// F20: reserved runtime seeds are verified, never path-installed.
function nativeFixture(plan=nativePluginPlan) {
  const marketplaces={reserved:{kind:'local',manifest:'~/.codex/.tmp/seed/.agents/plugins/marketplace.json'},shared:{kind:'local',manifest:'~/.cache/codex-runtimes/fixture/.agents/plugins/marketplace.json'}}
  const plugins=Object.fromEntries(['present@reserved','missing@reserved','wrong@reserved','first@shared','last@shared'].map(key=>[key,{version:'1',pinned:true}]))
  return plan({skills:{codexPlugins:{marketplaces,plugins}}},'/fake/company-home')
}
async function nativeSeedWitness(install=installNativePlugins,plan=nativePluginPlan) {
  const ops=nativeFixture(plan),runtime=memoryNativePlugins(ops,{seeded:[{key:'present@reserved',version:'1'},{key:'wrong@reserved',version:'2'}]}),emitted=[]
  assert(ops.slice(0,3).every(op=>op.kind==='native-plugin-verify' && op.method==='plugin/list' && !('marketplacePath' in op.params)))
  const result=await install(ops,runtime,e=>emitted.push(e))
  assert.deepEqual(result.entries.map(e=>[e.key,e.status]),[['present@reserved','verified'],['missing@reserved','seeded-missing'],['wrong@reserved','failed'],['first@shared','installed'],['last@shared','installed']])
  assert.equal(result.findings.length,2);assert(result.findings.every(f=>f.reportingOnly))
  assert.equal(result.entries[2].stage,'seeded-pin')
  assert.equal(runtime.calls.filter(c=>c.method==='plugin/list').length,1)
  assert.deepEqual(runtime.calls.find(c=>c.method==='plugin/list').params,{marketplaceKinds:['local'],forceRefetch:false})
  assert.deepEqual(runtime.calls.filter(c=>c.method==='plugin/install').map(c=>c.params.pluginName),['first','last'])
  assert.equal(result.oauthPerformed,false);assert.equal(result.needsAuth.length,0)
  assert.equal(emitted.filter(e=>e.write).length,2)
}
test('F20 reserved verified / seeded-missing / failed findings continue to installed entries',()=>nativeSeedWitness())
test('F20 classification follows normalized home containment, not a marketplace name',()=>{
  const ops=nativePluginPlan(source.contract,'/fake/company-home')
  assert.equal(ops.filter(o=>o.kind==='native-plugin-verify').length,11)
  assert.equal(ops.filter(o=>o.params.remoteMarketplaceName).length,57)
  for(const [manifest,reserved]of [['~/.codex/seed/marketplace.json',true],[resolve(process.env.HOME,'.codex/seed/marketplace.json'),true],['/fake/company-home/seed/marketplace.json',true],['~/.codex-other/marketplace.json',false],['~/.codex/../.cache/codex-runtimes/marketplace.json',false]]) {
    const contract={skills:{codexPlugins:{marketplaces:{renamed:{kind:'local',manifest}},plugins:{'seed@renamed':{version:'1',pinned:true}}}}}
    const [op]=nativePluginPlan(contract,'/fake/company-home');assert.equal(op.kind,reserved?'native-plugin-verify':'native-plugin-install')
    contract.skills.codexPlugins.plugins['seed@renamed'].sourceId='remote-id'
    if(reserved)assert.equal(nativePluginPlan(contract,'/fake/company-home')[0].kind,'native-plugin-verify')
  }
})
async function nativeFailureWitness(install=installNativePlugins) {
  const ops=nativeFixture(),runtime=memoryNativePlugins(ops,{failures:{'first@shared':'plugin/install'}}),emitted=[]
  await assert.rejects(install(ops,runtime,e=>emitted.push(e)),error=>{
    assert.deepEqual(error.result.entries.map(e=>e.status),['seeded-missing','seeded-missing','seeded-missing','failed','skipped'])
    assert.equal(error.result.entries[3].reportingOnly,false);assert.equal(error.result.entries[3].stage,'install')
    assert.deepEqual(emitted.at(-1),{nativePlugins:error.result})
    assert(!JSON.stringify(error.result).includes('Fake native diagnostic'));return true
  })
  assert.equal(runtime.calls.filter(c=>c.method==='plugin/install').length,1)
  assert(!runtime.calls.some(c=>c.params.pluginName==='last'))
}
test('F20 non-reserved local install failure still stops without retry and reports untouched entries',()=>nativeFailureWitness())
test('F20 one failed seed list reports every reserved entry without retry or aborting installs',async()=>{
  const ops=nativeFixture(),runtime=memoryNativePlugins(ops,{failures:{'plugin/list':true}})
  const result=await installNativePlugins(ops,runtime,()=>{})
  assert.deepEqual(result.entries.map(e=>e.status),['failed','failed','failed','installed','installed'])
  assert(result.findings.every(e=>e.stage==='seeded-read'&&e.reportingOnly))
  assert.equal(runtime.calls.filter(c=>c.method==='plugin/list').length,1)
})
test('F20 unavailable, disabled, duplicate or malformed seeds are findings, never verified',async()=>{
  const ops=nativeFixture().slice(0,1)
  for(const summary of [{enabled:false},{availability:'DISABLED_BY_ADMIN'},{localVersion:null},{installed:undefined}]) {
    const runtime=memoryNativePlugins(ops,{seeded:[{key:ops[0].entry.key,version:'1',summary}]}),r=await installNativePlugins(ops,runtime,()=>{})
    assert.equal(r.entries[0].status,'failed');assert.equal(runtime.calls.length,1)
  }
  for(const listed of [{},{marketplaces:[],marketplaceLoadErrors:[{message:'withheld'}]},{marketplaces:[{name:'reserved'}]},{marketplaces:[{name:'reserved',plugins:[{name:'present'},{name:'present'}]}]}]){
    const r=await installNativePlugins(ops,{request:async()=>listed},()=>{});assert.equal(r.entries[0].status,'failed')
  }
})
test('F20 satisfied non-reserved pins are recorded as verified without reinstall',async()=>{
  const ops=nativeFixture().slice(3),runtime=memoryNativePlugins(ops,{active:ops.map(o=>o.entry.key)})
  const r=await installNativePlugins(ops,runtime,()=>{})
  assert.deepEqual(r.entries.map(e=>e.status),['verified','verified']);assert(runtime.calls.every(c=>c.method==='plugin/read'))
})
async function nativePathWitness(install=installNativePlugins) {
  const op={...nativeFixture()[0],kind:'native-plugin-install',method:'plugin/install',params:{marketplacePath:resolve(process.env.HOME,'.codex/seed/marketplace.json'),pluginName:'present'}},runtime=memoryNativePlugins([op])
  await assert.rejects(install([op],runtime,()=>{}));assert.equal(runtime.calls.length,0)
}
test('F20 executor refuses a reserved path disguised as an install',()=>nativePathWitness())
test('F20 wrong installed readback and unpinned verification remain failures',async()=>{
  const ops=nativeFixture().slice(3),runtime=memoryNativePlugins(ops),request=runtime.request.bind(runtime)
  runtime.request=async(method,params)=>{const r=await request(method,params);if(method==='plugin/read'&&r.plugin.summary.installed)r.plugin.summary.localVersion='wrong';return r}
  await assert.rejects(installNativePlugins(ops,runtime,()=>{}),e=>e.result.entries[0].stage==='readback'&&e.result.entries[1].status==='skipped')
  const op={...nativeFixture()[0],entry:{...nativeFixture()[0].entry,pinned:false}},unused=memoryNativePlugins([op])
  await assert.rejects(installNativePlugins([op],unused,()=>{}));assert.equal(unused.calls.length,0)
})
const f20Setup='const {resolve}=await import("node:path");const {memoryNativePlugins}=await import('+JSON.stringify(url('src/fake-api.mjs'))+');const {nativePluginPlan}=await import('+JSON.stringify(url('src/native-plugins.mjs'))+');'+nativeFixture.toString()+';'
knockout('F20 reserved plan classification','src/native-plugins.mjs',s=>s.replace('if(reservedManifest(market.manifest,companyHome))','if(false)'),f20Setup+nativeSeedWitness.toString()+';await nativeSeedWitness(subject.installNativePlugins,subject.nativePluginPlan);')
knockout('F20 reserved verification cannot fall through to install','src/native-plugins.mjs',s=>s.replace("entries.push({key:op.entry.key,status:'verified',reserved:true})\n        continue","entries.push({key:op.entry.key,status:'verified',reserved:true})"),f20Setup+nativeSeedWitness.toString()+';await nativeSeedWitness(subject.installNativePlugins);')
knockout('F20 missing seed report','src/native-plugins.mjs',s=>s.replace("entries.push(row);findings.push(row)","/* missing seed report removed */"),f20Setup+nativeSeedWitness.toString()+';await nativeSeedWitness(subject.installNativePlugins);')
knockout('F20 seed pin strength','src/native-plugins.mjs',s=>s.replace('assertNativePin(op.entry,{plugin:{summary:matches[0]}},{installed:true})','/* seeded pin check removed */'),f20Setup+nativeSeedWitness.toString()+';await nativeSeedWitness(subject.installNativePlugins);')
knockout('F20 reporting failures continue','src/native-plugins.mjs',s=>s.replace('if(reportingOnly){findings.push(row);continue}','if(reportingOnly){findings.push(row);throw new Error("reporting abort")}'),f20Setup+nativeSeedWitness.toString()+';await nativeSeedWitness(subject.installNativePlugins);')
knockout('F20 genuine install failures stop','src/native-plugins.mjs',s=>s.replace('throw Object.assign(new Error(row.reason),{result})','continue'),f20Setup+nativeFailureWitness.toString()+';await nativeFailureWitness(subject.installNativePlugins);')
knockout('F20 reserved executor path guard','src/native-plugins.mjs',s=>s.replace(" && !reservedManifest(op.params?.marketplacePath,op.home)",''),f20Setup+nativePathWitness.toString()+';await nativePathWitness(subject.installNativePlugins);')

test('F20 final app-state failure preserves every plugin outcome and still throws',async()=>{
  const ops=nativeFixture(),runtime=memoryNativePlugins(ops),request=runtime.request.bind(runtime),emitted=[]
  runtime.request=async(method,params)=>{if(method==='app/installed')throw new Error('Fake native diagnostic: withheld');const r=await request(method,params);if(method==='plugin/read')r.plugin.apps=[{id:'app',name:'Manual'}];return r}
  await assert.rejects(installNativePlugins(ops,runtime,e=>emitted.push(e)),error=>{
    assert.deepEqual(error.result.entries.map(e=>e.status),['seeded-missing','seeded-missing','seeded-missing','installed','installed'])
    assert.equal(error.result.findings.at(-1).stage,'app-state');assert.equal(error.result.findings.at(-1).reportingOnly,false)
    assert.deepEqual(emitted.at(-1),{nativePlugins:error.result});assert(!JSON.stringify(error.result).includes('Fake native diagnostic'));return true
  })
})
// F21: compose real native seed reporting with binding and the fake CLI.
function seedBindingPlugins({missing=0,auth=false,failed=false}={}) {
  const ops=nativePluginPlan(source.contract,'/fake/company-home'),reserved=ops.filter(o=>o.kind==='native-plugin-verify')
  assert.equal(reserved.length,11)
  const missingKeys=reserved.slice(0,missing).map(o=>o.entry.key)
  const seeded=reserved.slice(missing).map(o=>({key:o.entry.key,version:o.entry.version,summary:{remotePluginId:o.entry.sourceId}}))
  if(failed)seeded[0].version='wrong-version'
  const runtime=memoryNativePlugins(ops,{seeded}),request=runtime.request.bind(runtime)
  const appOp=ops.find(o=>o.kind==='native-plugin-install'),app={id:'fixture-app',name:'Fixture sign-in'}
  if(auth)runtime.request=async(method,params)=>{
    const result=await request(method,params)
    if(method==='plugin/install' && JSON.stringify(params)===JSON.stringify(appOp.params))result.appsNeedingAuth=[app]
    return result
  }
  return {ops,missingKeys,failedKey:failed?reserved[missing].entry.key:null,runtime,
    needsAuth:auth?[{plugin:appOp.entry.key,appId:app.id,name:app.name,action:'Ryan authenticates by hand'}]:[],
    provisionPlugins:()=>installNativePlugins(ops,runtime,()=>{})}
}
async function seedBindingWitness(bind,scenario={}) {
  const f=await bindingFixture(),native=seedBindingPlugins(scenario),emitted=[]
  const opts={io:f.io,pluginOperations:native.ops,provisionPlugins:native.provisionPlugins,emit:e=>emitted.push(e)}
  const preview=await bind(f.api,source,opts)
  assert.equal(native.runtime.calls.length,0);assert.equal(f.io.writes.length,0)
  const result=await bind(f.api,source,{...opts,apply:true,approvedDigest:preview.digest})
  const incomplete=!!(scenario.missing||scenario.auth||scenario.failed),state=await f.io.readState()
  assert.equal(result.complete,!incomplete,'outstanding findings must prevent completion')
  assert.equal(state.phase,incomplete?'awaiting-plugin-auth':'configured')
  assert.deepEqual(state.pluginAuth,native.needsAuth);assert.deepEqual(result.plugins.needsAuth,native.needsAuth)
  assert(!state.pluginFailure);assert(!state.failedStep);assert(!f.io.locked)
  assert(emitted.some(e=>e.complete===result.complete && e.pluginSummary===result.pluginSummary),'completion summary must be emitted')
  assert.equal(secretLinkFindings(source.contract,await readSnapshot(f.api,f.companyId)).length,0)
  if(scenario.missing||scenario.failed){
    assert.deepEqual(state.pluginFindings,result.plugins.findings)
    assert.deepEqual(state.pluginFindings.filter(r=>r.status==='seeded-missing'),native.missingKeys.map(key=>({key,status:'seeded-missing',reportingOnly:true,reason:'Runtime has not seeded this pinned plugin'})))
    assert(state.pluginFindings.every(r=>r.reportingOnly && Object.keys(r).every(k=>['key','status','stage','reportingOnly','reason'].includes(k))))
    if(scenario.missing)assert(result.pluginSummary.includes(`${scenario.missing} pinned plugins are not seeded: ${native.missingKeys.join(', ')}`))
    if(scenario.failed)assert(result.pluginSummary.includes(`1 outstanding pinned plugin findings: ${native.failedKey}`))
  }else assert(!Object.hasOwn(state,'pluginFindings'))
  if(scenario.auth)assert(result.pluginSummary.some(line=>line.includes('1 apps require manual authentication: Fixture sign-in') && line.includes(native.needsAuth[0].plugin) && line.includes('fixture-app')))
  if(!incomplete){assert.deepEqual(result.pluginSummary,[]);assert.deepEqual(result.plugins.findings,[]);return}
  const successful=seedBindingPlugins(),nextOpts={...opts,provisionPlugins:successful.provisionPlugins}
  const next=await bind(f.api,source,nextOpts)
  assert.deepEqual(await f.io.readState(),state,'a new plan must preserve outstanding findings')
  const done=await bind(f.api,source,{...nextOpts,apply:true,approvedDigest:next.digest}),saved=await f.io.readState()
  assert.equal(done.complete,true);assert.equal(saved.phase,'configured')
  assert(!Object.hasOwn(saved,'pluginFindings'),'resolved findings must be removed from state')
  assert.deepEqual(saved.pluginAuth,[]);assert.deepEqual(done.plugins.findings,[]);assert.deepEqual(done.pluginSummary,[])
}
for(const [label,scenario]of [
  ['all eleven reserved entries seeded completes without persisted findings',{}],
  ['some seeds missing remain incomplete and clear after a successful resume',{missing:2}],
  ['all eleven seeds missing cannot overclaim completion',{missing:11}],
  ['app auth and missing seeds are both reported and clear on resume',{missing:2,auth:true}],
  ['reserved verification failure also prevents completion',{failed:true}],
  ['manual app auth alone retains its meaning',{auth:true}],
])test('F21 '+label,()=>seedBindingWitness(bindSecrets,scenario))
async function seedCliWitness(run) {
  const f=await bindingFixture(),native=seedBindingPlugins({missing:11,auth:true}),lines=[],original=console.log,exitCode=process.exitCode
  const runtime={...f,host:{exists:()=>true},pluginInventory:catalogEntries(source.contract.skills).filter(e=>e.pinned&&e.adapter==='claude_local').map(e=>({...e,sourceSha:e.source?.sha,installed:true})),provisionPlugins:native.provisionPlugins}
  console.log=(...args)=>lines.push(...args)
  try{
    await run(['bind-secrets','--fake'],runtime)
    const preview=JSON.parse(lines.at(-1));lines.length=0
    await run(['bind-secrets','--fake','--apply','--approved-digest',preview.digest],runtime)
    const result=lines.filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)).findLast(r=>Object.hasOwn(r,'complete'))
    assert.equal(result.complete,false);assert.equal((await f.io.readState()).phase,'awaiting-plugin-auth')
    assert.equal(process.exitCode,exitCode,'incomplete binding must not change CLI exit behavior')
    assert.equal(result.plugins.findings.length,11);assert.deepEqual(result.plugins.needsAuth,native.needsAuth)
    assert(lines.includes(`11 pinned plugins are not seeded: ${native.missingKeys.join(', ')}`),'CLI must print the count and every missing pin as plain text')
    assert(result.pluginSummary.every(line=>lines.includes(line)),'CLI must print app auth alongside findings')
  }finally{console.log=original}
}
test('F21 CLI prints all missing pin names and manual app auth without changing exit behavior',()=>seedCliWitness(main))
const f21Setup=bindingSetup+`const {nativePluginPlan,installNativePlugins}=await import(${JSON.stringify(url('src/native-plugins.mjs'))});const {memoryNativePlugins}=await import(${JSON.stringify(url('src/fake-api.mjs'))});const {secretLinkFindings}=await import(${JSON.stringify(url('src/fresh.mjs'))});`+seedBindingPlugins.toString()+';'
knockout('F21 findings completion check','src/fresh.mjs',s=>s.replace(' && !findings.length',''),f21Setup+seedBindingWitness.toString()+';await seedBindingWitness(subject.bindSecrets,{missing:11});')
knockout('F21 resolved findings cleared','src/fresh.mjs',s=>s.replace('else delete state.pluginFindings','/* clear knocked out */'),f21Setup+seedBindingWitness.toString()+';await seedBindingWitness(subject.bindSecrets,{missing:2});')
knockout('F21 CLI plain summary','src/index.mjs',s=>s.replace("if(flags.verb==='bind-secrets')result.pluginSummary?.forEach(line=>console.log(line))",'/* summary knocked out */'),f21Setup+`const {catalogEntries}=await import(${JSON.stringify(url('src/skills.mjs'))});`+seedCliWitness.toString()+';await seedCliWitness(subject.main);')
