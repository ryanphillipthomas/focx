import './runtime-permissions.test.mjs'
import './qa-launcher.test.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync,statSync} from 'node:fs'
import {resolve} from 'node:path'
import {loadSource,buildSource,snapshot,plan,synchronize,publicPlan,checkHost,ROOT} from './index.mjs'
const source=loadSource()
const clone=structuredClone
function fake({drift=false}={}) {
  const configs={}, files={}, permissions={canCreateAgents:false,canCreateSkills:false,canAssignTasks:false}
  for (const a of source.manifest.agents) {
    configs[a.id]={id:a.id,companyId:source.manifest.companyId,name:a.name,title:a.title,status:'paused',reportsTo:null,adapterType:a.adapterType??'codex_local',permissions:clone(permissions),runtimeConfig:{heartbeat:{enabled:false,wakeOnDemand:false,maxConcurrentRuns:1,maxDailyRuns:a.maxDailyRuns??null,maxTurnContinuation:{enabled:false}}},adapterConfig:{...(a.disposition==='pilot'?{...a.executionPermissions,...(a.adapterType==='claude_local'?{dangerouslySkipPermissions:false}:{dangerouslyBypassApprovalsAndSandbox:false})}:{}),...(a.adapterLocal?.permissionDelivery?{engine:'acp',agentCommand:'node tools/qa-claude-agent-acp/index.mjs'}:{}),model:'preserve-model',env:{SECRET:{type:'secret_ref',secretId:'preserve-reference'}},workspaceStrategy:{type:'git_worktree'},timeoutSec:900,...(a.maxTurnsPerRun?{maxTurnsPerRun:a.maxTurnsPerRun}:{})}}
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

// --- source validation, migration, adapter-local plugins, host checks -------
// Rebuild the source from the real files with one mutation applied, so every
// rejection below exercises the same validation the CLI runs.
const readRepo=p=>readFileSync(resolve(ROOT,p),'utf8')
const rebuilt=(mutate,read=readRepo)=>{const manifest=clone(source.manifest),invariants=clone(source.invariants);mutate?.(manifest,invariants);return buildSource({manifest,invariants,baseline:source.baseline,read})}
const qaOf=m=>m.agents.find(a=>a.roleKey==='qa-engineer')
test('the committed QA entry records a reviewed Claude migration and its adapter-local tooling',()=>{const qa=qaOf(source.manifest);assert.equal(qa.adapterType,'claude_local');assert.equal(qa.maxTurnsPerRun,20);assert.deepEqual(qa.adapterMigration,{from:'codex_local',to:'claude_local',approvedBy:'Ryan Thomas',date:'2026-09-04'});assert.deepEqual(qa.adapterLocal.claudeCodePlugins,['differential-review@trailofbits','pr-review-toolkit@claude-plugins-official','spec-to-code-compliance@trailofbits']);assert(qa.adapterLocal.permissionsAllow.includes('Task(pr-review-toolkit:silent-failure-hunter)'));assert(qa.adapterLocal.permissionsAllow.includes('Edit(/pipeline/runs/**)'));assert(!qa.adapterLocal.permissionsAllow.some(r=>r==='Edit'||r.startsWith('Write')||r==='Bash'||r.startsWith('Skill')));assert.deepEqual(qa.adapterLocal.permissionsDeny,['Edit','NotebookEdit','Skill']);assert.deepEqual(qa.executionPermissions,{permissionMode:'approve-reads',nonInteractivePermissions:'deny'})})
// A pilot that cannot write to its task reports nothing. The rule and the file
// it names have to travel together: Paperclip allow-lists this path in every
// worktree but ships no script, and a rule pointing at a missing file is the
// same silence as no rule at all.
test('QA can report through the committed script, and the script is really there',()=>{const qa=qaOf(source.manifest)
  assert(qa.adapterLocal.permissionsAllow.includes('Bash(scripts/paperclip-issue-update.sh:*)'),'QA has no rule permitting the reporting script')
  const path=resolve(ROOT,'scripts/paperclip-issue-update.sh')
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
test('a migration is accepted only once the live adapter already matches it',async()=>{const f=fake();assert.deepEqual((await synchronize(f,source)).changes,[]);const qa=qaOf(source.manifest);f.configs[qa.id].adapterType='codex_local';await assert.rejects(synchronize(f,source),/declared but not yet performed/);assert.deepEqual(writes(f),[])})
test('an adapter mismatch with no migration record is still refused',async()=>{const src=rebuilt(m=>{delete qaOf(m).adapterMigration});const f=fake();f.configs[qaOf(src.manifest).id].adapterType='codex_local';await assert.rejects(synchronize(f,src),/separate review/)})
function hostFor(qa,{missingPlugin,unknownMarket,disabled,driftAllow}={}){
  const cache='/host/plugins',cfg='/agent/.claude'
  const installed={};for(const k of qa.adapterLocal.claudeCodePlugins)if(k!==missingPlugin)installed[k]=[{installPath:`${cache}/cache/${k.split('@')[1]}/${k.split('@')[0]}/1.0.0`}]
  const markets={};for(const k of qa.adapterLocal.claudeCodePlugins){const m=k.split('@')[1];if(m!==unknownMarket)markets[m]={}}
  const enabled={};for(const k of qa.adapterLocal.claudeCodePlugins)enabled[k]=k!==disabled
  const files={[`${cache}/installed_plugins.json`]:{version:2,plugins:installed},[`${cache}/known_marketplaces.json`]:markets,[`${cfg}/settings.json`]:{enabledPlugins:enabled,permissions:{allow:driftAllow?['Read']:qa.adapterLocal.permissionsAllow}}}
  return {cache,cfg,host:{readJson:p=>files[p]??null,exists:p=>p.endsWith('/@agentclientprotocol/claude-agent-acp/dist/index.js')||/\/\.claude-plugin\/plugin\.json$/.test(p)&&Object.values(installed).some(r=>p.startsWith(r[0].installPath))}}
}
test('verify passes when the host carries exactly what the manifest declares, and writes nothing',async()=>{const f=fake();const qa=qaOf(source.manifest);const h=hostFor(qa);f.configs[qa.id].adapterConfig.env.CLAUDE_CODE_PLUGIN_CACHE_DIR={type:'plain',value:h.cache};f.configs[qa.id].adapterConfig.env.CLAUDE_CONFIG_DIR=h.cfg;const r=await synchronize(f,source,{host:h.host});assert.deepEqual(r.hostFindings,[]);assert.deepEqual(r.changes,[]);assert.deepEqual(writes(f),[])})
for(const [label,opts,pattern] of [
  ['a plugin missing from the host',{missingPlugin:'differential-review@trailofbits'},/not installed/],
  ['a marketplace Claude Code does not know',{unknownMarket:'trailofbits'},/unknown to this host/],
  ['a plugin not enabled in the agent settings',{disabled:'pr-review-toolkit@claude-plugins-official'},/not enabled/],
])test(`verify reports ${label}`,async()=>{const f=fake();const qa=qaOf(source.manifest);const h=hostFor(qa,opts);f.configs[qa.id].adapterConfig.env.CLAUDE_CODE_PLUGIN_CACHE_DIR=h.cache;f.configs[qa.id].adapterConfig.env.CLAUDE_CONFIG_DIR=h.cfg;const r=await synchronize(f,source,{host:h.host});assert(r.hostFindings.some(x=>pattern.test(x)),r.hostFindings.join('\n'))})
test('verify reports a live env that cannot find plugins at all',async()=>{const f=fake();const qa=qaOf(source.manifest);const r=await synchronize(f,source,{host:hostFor(qa).host});assert(r.hostFindings.some(x=>/CLAUDE_CODE_PLUGIN_CACHE_DIR is not set/.test(x)))})
test('host checks never enter the plan digest or the apply path',async()=>{const f=fake({drift:true});const qa=qaOf(source.manifest);const p1=await synchronize(f,source);const p2=await synchronize(f,source,{host:hostFor(qa).host});assert.equal(p1.digest,p2.digest);const applied=await synchronize(f,source,{apply:true,approvedDigest:p1.digest});assert(applied.verified);assert.equal(applied.hostFindings,undefined)})

test('verify rejects the old ignored-user-settings delivery even with a matching allow-list',async()=>{const f=fake();const qa=qaOf(source.manifest);delete f.configs[qa.id].adapterConfig.agentCommand;const h=hostFor(qa);const r=await synchronize(f,source,{host:h.host});assert(r.hostFindings.some(x=>/launcher is not selected/.test(x)));assert(r.changes.some(x=>x.fields.includes('adapterConfig')));assert.deepEqual(writes(f),[])})
