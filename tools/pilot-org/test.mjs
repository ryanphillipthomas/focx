import {test} from 'node:test'
import assert from 'node:assert/strict'
import {loadSource,snapshot,plan,synchronize,publicPlan} from './index.mjs'
const source=loadSource()
const clone=structuredClone
function fake({drift=false}={}) {
  const configs={}, files={}, permissions={canCreateAgents:false,canCreateSkills:false,canAssignTasks:false}
  for (const a of source.manifest.agents) {
    configs[a.id]={id:a.id,companyId:source.manifest.companyId,name:a.name,title:a.title,status:'paused',reportsTo:null,adapterType:a.adapterType??'codex_local',permissions:clone(permissions),runtimeConfig:{heartbeat:{enabled:false,wakeOnDemand:false,maxConcurrentRuns:1,maxDailyRuns:a.maxDailyRuns??null,maxTurnContinuation:{enabled:false}}},adapterConfig:{...(a.disposition==='pilot'?{...a.executionPermissions,...(a.adapterType==='claude_local'?{dangerouslySkipPermissions:false}:{dangerouslyBypassApprovalsAndSandbox:false})}:{}),model:'preserve-model',env:{SECRET:{type:'secret_ref',secretId:'preserve-reference'}},workspaceStrategy:{type:'git_worktree'},timeoutSec:900,...(a.maxTurnsPerRun?{maxTurnsPerRun:a.maxTurnsPerRun}:{})}}
    if(a.disposition==='pilot') files[a.id]=clone(source.files[a.id])
  }
  const qa=source.manifest.agents.find(a=>a.roleKey==='qa-engineer')
  if(drift){configs[qa.id].runtimeConfig.heartbeat.wakeOnDemand=true; files[qa.id]['AGENTS.md']='old role'}
  const f={configs,files,extra:[],scheduled:false,skills:[],calls:[],failWrite:false,ignoreWrites:false,reads:0,mutateOnSecondSnapshot:false,async request(method,path,body){
    this.calls.push({method,path,body:clone(body)})
    if(method!=='GET' && this.failWrite)throw Error('write failure')
    if(path===`/api/companies/${source.manifest.companyId}/agents`){this.reads++; if(this.mutateOnSecondSnapshot&&this.reads===2)this.configs[qa.id].updatedAt='changed';return [...Object.values(this.configs).map(c=>({id:c.id})),...this.extra]}
    if(path===`/api/companies/${source.manifest.companyId}/routines`)return [{id:'routine'}]
    if(path==='/api/routines/routine')return {triggers:[{id:'trigger',kind:'schedule',enabled:this.scheduled}]}
    const [,id,tail]=path.match(/^\/api\/agents\/([^/]+)(.*)$/)??[]
    if(method==='GET'){
      if(tail==='/configuration')return clone(this.configs[id])
      if(tail==='/instructions-bundle')return {entryFile:'AGENTS.md',files:Object.keys(this.files[id]).map(path=>({path})),legacyPromptTemplateActive:false,legacyBootstrapPromptTemplateActive:false}
      if(tail.startsWith('/instructions-bundle/file?')){const path=new URLSearchParams(tail.split('?')[1]).get('path');return {path,content:this.files[id][path]}}
      if(tail==='/skills')return {desiredSkills:this.skills}
    }
    if(method==='PATCH'&&tail===''){if(!this.ignoreWrites){const b=clone(body);delete b.replaceAdapterConfig;Object.assign(this.configs[id],b)}return {}}
    if(method==='PATCH'&&tail==='/permissions'){if(!this.ignoreWrites)Object.assign(this.configs[id].permissions,body);return {}}
    if(method==='PUT'&&tail==='/instructions-bundle/file'){if(!this.ignoreWrites)this.files[id][body.path]=body.content;return {}}
    throw Error(`Unexpected endpoint ${method} ${path}`)
  }}
  return f
}
const writes=f=>f.calls.filter(c=>c.method!=='GET')
test('all retained identities and role procedures load offline',()=>{assert.equal(source.manifest.agents.length,26);assert.equal(Object.keys(source.files).length,3)})
test('clean preview is read-only and has no changes',async()=>{const f=fake();const p=await synchronize(f,source);assert.deepEqual(p.changes,[]);assert.deepEqual(writes(f),[])})
test('drift preview names fields without exposing credentials or prompt bodies',async()=>{const f=fake({drift:true});const p=await synchronize(f,source);assert.equal(p.changes.length,2);assert(!JSON.stringify(p).includes('preserve-reference'));assert.deepEqual(writes(f),[])})
test('approved sync converges without deleting or enabling anything; second plan is empty',async()=>{const f=fake({drift:true});const before=clone(f.configs);const p=await synchronize(f,source);const result=await synchronize(f,source,{apply:true,approvedDigest:p.digest});assert(result.verified);for(const c of Object.values(f.configs)){assert.equal(c.status,'paused');assert.equal(c.runtimeConfig.heartbeat.wakeOnDemand,false);assert.deepEqual(c.adapterConfig.env,before[c.id].adapterConfig.env);assert.deepEqual(c.adapterConfig.workspaceStrategy,before[c.id].adapterConfig.workspaceStrategy);assert.equal(c.adapterConfig.model,before[c.id].adapterConfig.model)}assert(writes(f).every(c=>['PATCH','PUT'].includes(c.method)));assert.equal((await synchronize(f,source)).changes.length,0)})
for(const kind of ['missing','extra','terminated','active','company','schedule','unexpected-files','inherited-skills'])test(`${kind} state refuses before any write`,async()=>{const f=fake({drift:true});const id=source.manifest.agents.find(a=>a.disposition==='pilot').id;if(kind==='missing')delete f.configs[id];if(kind==='extra')f.extra.push({id:'unknown'});if(kind==='terminated')f.configs[id].status='terminated';if(kind==='active')f.configs[id].status='running';if(kind==='company')f.configs[id].companyId='other';if(kind==='schedule')f.scheduled=true;if(kind==='unexpected-files')f.files[id]['old-prompt.md']='legacy';if(kind==='inherited-skills')f.skills=['paperclipai/paperclip/para-memory-files'];await assert.rejects(synchronize(f,source,{apply:true,approvedDigest:'x'}));assert.deepEqual(writes(f),[])})
test('review digest is invalidated by source or live changes',async()=>{const f=fake({drift:true});const p=await synchronize(f,source);const changed=clone(source);changed.files[Object.keys(changed.files)[0]]['AGENTS.md']+='\nchanged';await assert.rejects(synchronize(f,changed,{apply:true,approvedDigest:p.digest}),/Preview changed/);assert.deepEqual(writes(f),[])})
test('concurrent change during preflight makes no writes',async()=>{const f=fake({drift:true});const digest=plan(source,await snapshot(f,source)).digest;f.reads=0;f.mutateOnSecondSnapshot=true;await assert.rejects(synchronize(f,source,{apply:true,approvedDigest:digest}),/changed during preflight/);assert.deepEqual(writes(f),[])})
test('stricter live run caps and timeouts are preserved in capped mode',async()=>{const capped=clone(source);for(const a of capped.manifest.agents)if(a.disposition==='pilot')a.maxDailyRuns=3;const f=fake({drift:true});for(const c of Object.values(f.configs)){c.runtimeConfig.heartbeat.maxDailyRuns=1;c.adapterConfig.timeoutSec=300;if(c.adapterType==='claude_local')c.adapterConfig.maxTurnsPerRun=10}const p=await synchronize(f,capped);await synchronize(f,capped,{apply:true,approvedDigest:p.digest});for(const c of Object.values(f.configs)){assert.equal(c.runtimeConfig.heartbeat.maxDailyRuns,1);assert.equal(c.adapterConfig.timeoutSec,300)}})
test('write failures and false-success responses never verify green',async()=>{for(const mode of ['failWrite','ignoreWrites']){const f=fake({drift:true});const p=await synchronize(f,source);f[mode]=true;await assert.rejects(synchronize(f,source,{apply:true,approvedDigest:p.digest}))}})
test('an unreviewed apply cannot mutate',async()=>{const f=fake({drift:true});await assert.rejects(synchronize(f,source,{apply:true}));assert.deepEqual(writes(f),[])})

test('explicit development policy removes only the daily cap',async()=>{const f=fake();for(const c of Object.values(f.configs))c.runtimeConfig.heartbeat.maxDailyRuns=3;const p=await synchronize(f,source);await synchronize(f,source,{apply:true,approvedDigest:p.digest});for(const a of source.manifest.agents){const c=f.configs[a.id];assert.equal(c.runtimeConfig.heartbeat.maxDailyRuns,a.disposition==='pilot'?null:3);assert.equal(c.status,'paused');assert.equal(c.runtimeConfig.heartbeat.wakeOnDemand,false);assert.equal(c.adapterConfig.timeoutSec,900)}})

test('missing or blanket ACP approval converges to explicit read-only approval',async()=>{const f=fake();for(const a of source.manifest.agents.filter(a=>a.disposition==='pilot')){delete f.configs[a.id].adapterConfig.permissionMode;f.configs[a.id].adapterConfig.acpPermissionMode='approve-all'}const p=await synchronize(f,source);await synchronize(f,source,{apply:true,approvedDigest:p.digest});for(const a of source.manifest.agents.filter(a=>a.disposition==='pilot')){assert.equal(f.configs[a.id].adapterConfig.permissionMode,'approve-reads');assert.equal(f.configs[a.id].adapterConfig.nonInteractivePermissions,'deny')}})
test('stricter deny-all and fail policies survive synchronization',async()=>{const f=fake({drift:true});for(const c of Object.values(f.configs)){c.adapterConfig.permissionMode='deny-all';c.adapterConfig.nonInteractivePermissions='fail'}const p=await synchronize(f,source);await synchronize(f,source,{apply:true,approvedDigest:p.digest});for(const c of Object.values(f.configs)){assert.equal(c.adapterConfig.permissionMode,'deny-all');assert.equal(c.adapterConfig.nonInteractivePermissions,'fail')}})

test('stricter ACP aliases are preserved when canonical fields are absent',async()=>{const f=fake();for(const a of source.manifest.agents.filter(a=>a.disposition==='pilot')){const c=f.configs[a.id].adapterConfig;delete c.permissionMode;delete c.nonInteractivePermissions;c.acpPermissionMode='deny-all';c.acpNonInteractivePermissions='fail'}const p=await synchronize(f,source);await synchronize(f,source,{apply:true,approvedDigest:p.digest});for(const a of source.manifest.agents.filter(a=>a.disposition==='pilot')){assert.equal(f.configs[a.id].adapterConfig.permissionMode,'deny-all');assert.equal(f.configs[a.id].adapterConfig.nonInteractivePermissions,'fail')}})
