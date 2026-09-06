import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {syncBuiltinESMExports} from 'node:module'
import {pathToFileURL} from 'node:url'
import {join,resolve} from 'node:path'
import childProcess from 'node:child_process'
import {loadSource,ROOT} from './index.mjs'
import {validateContext,mergeSettings,prepare} from '../qa-claude-agent-acp/index.mjs'
const source=loadSource(),qa=source.manifest.agents.find(x=>x.roleKey==='qa-engineer')
const env={PAPERCLIP_API_URL:'http://paperclip.invalid',PAPERCLIP_API_KEY:'offline-fixture-key',PAPERCLIP_AGENT_ID:'cccccccc-cccc-cccc-cccc-cccccccccccc',PAPERCLIP_COMPANY_ID:'dddddddd-dddd-dddd-dddd-dddddddddddd',PAPERCLIP_TASK_ID:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',PAPERCLIP_RUN_ID:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}
const agent={id:env.PAPERCLIP_AGENT_ID,companyId:env.PAPERCLIP_COMPANY_ID,urlKey:'qa-engineer',adapterType:'claude_local',name:'QA Engineer'}
const matchingFetch=async()=>({status:200,json:async()=>({...agent})})
const denyRules=qa.adapterLocal.permissionsDeny
const cwd='/project/.paperclip/worktrees/FOC-92-smoke'
const context={source,env,cwd,root:cwd,branch:'FOC-92-smoke',commonDir:'/project/.git'}
const local=(root=cwd)=>({permissions:{defaultMode:'default',allow:['Bash(curl:*)','Bash(env:*)','Bash(env)',`Bash(${root}/scripts/paperclip-issue-update.sh:*)`,`Bash(${root}/scripts/paperclip:*)`],deny:['Bash(rm:*)'],additionalDirectories:['/agent']}})
test('QA identity, bound task and isolated worktree are required',()=>{
 assert.deepEqual(validateContext(agent,context),qa.adapterLocal.permissionsAllow)
 for(const edit of [{env:{}},{env:{...env,PAPERCLIP_AGENT_ID:'other'}},{env:{...env,PAPERCLIP_TASK_ID:''}},{cwd:'/project',root:'/project'},{branch:'develop'},{root:'/different'},{commonDir:cwd+'/.git'}])assert.throws(()=>validateContext(agent,{...context,...edit}))
})
test('permissions merge preserves vendor rules, denials and unrelated settings; repeated launches are stable',()=>{
 const input=local();input.enabledPlugins={example:true}
 const result=mergeSettings(input,qa.adapterLocal.permissionsAllow,cwd,denyRules)
 assert.deepEqual(result.permissions.deny,[...input.permissions.deny,...denyRules].sort())
 assert.deepEqual(result.permissions.additionalDirectories,input.permissions.additionalDirectories)
 assert.deepEqual(result.enabledPlugins,input.enabledPlugins)
 assert(result.permissions.allow.includes('Edit(/pipeline/runs/**)'))
 assert(!result.permissions.allow.some(x=>x.startsWith('Skill(')))
 assert(result.permissions.deny.includes('Skill'))
 assert(!result.permissions.allow.includes('Write(/tmp/**)'))
 assert(!result.permissions.allow.includes('Bash(mkdir:*)'))
 assert.deepEqual(mergeSettings(result,qa.adapterLocal.permissionsAllow,cwd,denyRules),result)
})
test('malformed, stale, broad or bypass settings fail closed',()=>{
 for(const edit of [x=>delete x.permissions,x=>x.permissions.defaultMode='bypassPermissions',x=>x.permissions.defaultMode='dontAsk',x=>x.permissions.allow.push('Bash'),x=>x.permissions.allow.push('Write(/tmp/**)'),x=>x.permissions.allow=[],x=>x.permissions.allow='Bash']){
  const input=local();edit(input);assert.throws(()=>mergeSettings(input,qa.adapterLocal.permissionsAllow,cwd,denyRules))
 }
})

// Virtual worktree: exercise prepare's complete read/write/readback path without
// disk writes, Git mutations, a CLI runtime or any network connection.
async function worktreeFixture(t, run) {
 const file=join(cwd,'.claude/settings.local.json'),files=new Map([[file,JSON.stringify(local())]])
 const symlinks=new Set(),nonFiles=new Set(),writes=[]
 const read=fs.readFileSync
 t.mock.method(fs,'realpathSync',p=>resolve(p))
 t.mock.method(fs,'lstatSync',p=>({isSymbolicLink:()=>symlinks.has(p),isFile:()=>!nonFiles.has(p)}))
 t.mock.method(fs,'readFileSync',(p,encoding)=>{
  if(files.has(p))return files.get(p)
  assert(p.startsWith(cwd+'/'),'unexpected source read')
  return read(join(ROOT,p.slice(cwd.length)),encoding)
 })
 t.mock.method(fs,'writeFileSync',(p,value,options)=>{assert.equal(options.flag,'wx');assert.equal(options.mode,0o600);assert(!files.has(p));writes.push(p);files.set(p,value)})
 t.mock.method(fs,'renameSync',(from,to)=>{assert(files.has(from));files.set(to,files.get(from));files.delete(from)})
 t.mock.method(fs,'unlinkSync',p=>{if(!files.delete(p))throw Object.assign(Error('absent'),{code:'ENOENT'})})
 t.mock.method(childProcess,'execFileSync',(command,args)=>{
  assert.equal(command,'git')
  if(JSON.stringify(args)===JSON.stringify(['branch','--show-current']))return 'FOC-92-smoke'
  assert.deepEqual(args,['rev-parse','--git-common-dir']);return '/project/.git'
 })
 syncBuiltinESMExports()
 try { await run({file,files,symlinks,nonFiles,writes,options:{cwd,root:cwd,env,fetch:matchingFetch}}) }
 finally { t.mock.restoreAll();syncBuiltinESMExports() }
}
test('launcher writes and reads back only the isolated worktree mirror, rejects symlinks and ordinary checkouts',async t=>{
 await worktreeFixture(t,async({file,files,symlinks,nonFiles,writes,options})=>{
  const result=await prepare(options);assert.equal(result.rules,qa.adapterLocal.permissionsAllow.length)
  const after=files.get(file);assert.deepEqual(JSON.parse(after).permissions.allow,mergeSettings(local(),qa.adapterLocal.permissionsAllow,cwd,denyRules).permissions.allow)
  await prepare(options);assert.equal(files.get(file),after)
  assert(writes.every(p=>p.startsWith(file+'.qa-')));assert.equal(files.size,1)
  await assert.rejects(prepare({...options,cwd:'/project'}),/worktree root/)
  symlinks.add(file);await assert.rejects(prepare(options),/regular file/);assert.equal(files.get(file),after)
  symlinks.clear();nonFiles.add(file);await assert.rejects(prepare(options),/regular file/)
  nonFiles.clear();symlinks.add(join(cwd,'.claude'));await assert.rejects(prepare(options),/symlinked/)
 })
})
test('prepare resolves generated QA identity with a run-bound GET and bounded AbortSignal, reading only five fields',async t=>{
 await worktreeFixture(t,async({options})=>{
  let calls=0
  const timeout=AbortSignal.timeout.bind(AbortSignal),timeouts=[]
  t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);return timeout(ms)})
  const fetch=async(url,request)=>{
   calls++;assert.equal(url,env.PAPERCLIP_API_URL+'/api/agents/'+agent.id)
   assert.equal(request.method,'GET');assert.equal(request.redirect,'error')
   assert.deepEqual(request.headers,{Authorization:'Bearer '+env.PAPERCLIP_API_KEY,'X-Paperclip-Run-Id':env.PAPERCLIP_RUN_ID})
   assert(request.signal instanceof AbortSignal);assert.equal(request.signal.aborted,false)
   return {status:200,json:async()=>new Proxy({...agent},{get(target,key){if(key==='then')return undefined;assert(['id','urlKey','companyId','adapterType','name'].includes(key));return target[key]}})}
  }
  const result=await prepare({...options,fetch});assert.equal(calls,1);assert.deepEqual(timeouts,[10000]);assert.equal(result.rules,qa.adapterLocal.permissionsAllow.length)
  assert.deepEqual(validateContext(agent,context),qa.adapterLocal.permissionsAllow)
  const manifest=structuredClone(source.manifest);delete manifest.companyId;for(const a of manifest.agents)delete a.id
  assert.deepEqual(validateContext(agent,{...context,source:{...source,manifest}}),qa.adapterLocal.permissionsAllow)
 })
})
test('identity mismatches, incomplete restricted views, HTTP errors and invalid JSON fail closed without output or writes',async t=>{
 await worktreeFixture(t,async({options,files,file,writes})=>{
  const before=files.get(file),output=[]
  t.mock.method(process.stdout,'write',chunk=>{output.push(String(chunk));return true})
  t.mock.method(process.stderr,'write',chunk=>{output.push(String(chunk));return true})
  const marker='UPSTREAM_PRIVATE_BODY\nSECOND_LINE'
  const attempts=[]
  for(const key of ['urlKey','companyId','adapterType','id'])attempts.push(async()=>({status:200,json:async()=>({...agent,[key]:marker})}))
  for(const key of ['id','urlKey','companyId','adapterType','name']){
   for(const value of [undefined,null,'',42])attempts.push(async()=>({status:200,json:async()=>({...agent,[key]:value})}))
  }
  for(const status of [201,302,401,403,404,500])attempts.push(async()=>({status,json:async()=>{assert.fail('non-200 body must never be read')}}))
  attempts.push(async()=>({status:200,json:async()=>{throw Error(marker)}}),async()=>{throw Error(marker)},async()=>({status:200,json:async()=>[agent]}),async()=>({status:200,json:async()=>null}))
  for(const fetch of attempts)await assert.rejects(prepare({...options,fetch}),error=>{
   assert.match(error.message,/Paperclip agent identity/);assert(!error.message.includes(marker));assert(!error.message.includes(env.PAPERCLIP_API_KEY));assert(!error.message.includes('\n'));return true
  })
  await prepare({...options,fetch:async()=>({status:200,json:async()=>({...agent,name:marker,privateBody:marker})})})
  assert.equal(output.length,0);assert.equal(writes.length,1)
  assert(!files.get(file).includes(marker));assert.notEqual(files.get(file),before)
 })
})
test('missing API URL/key or unbound run context fails before fetch',async()=>{
 for(const key of ['PAPERCLIP_API_URL','PAPERCLIP_API_KEY','PAPERCLIP_AGENT_ID','PAPERCLIP_COMPANY_ID','PAPERCLIP_RUN_ID','PAPERCLIP_TASK_ID']){
  let calls=0
  await assert.rejects(prepare({cwd,root:cwd,env:{...env,[key]:''},fetch:async()=>{calls++;throw Error('must not fetch')}}))
  assert.equal(calls,0)
 }
})

// In-memory module mutations; each witness must pass, fail, then pass again.
const launcherPath=join(ROOT,'tools/qa-claude-agent-acp/index.mjs')
const launcherURL=pathToFileURL(launcherPath).href
const launcherSource=fs.readFileSync(launcherPath,'utf8')
for(const [label,needle,witness] of [
 ['identity guard',"requireThat(resolvedAgent.urlKey === 'qa-engineer' && resolvedAgent.companyId === env.PAPERCLIP_COMPANY_ID && resolvedAgent.adapterType === 'claude_local' && resolvedAgent.id === env.PAPERCLIP_AGENT_ID, 'Paperclip agent identity does not match the assigned QA role, company and adapter')",subject=>assert.throws(()=>subject.validateContext({...agent,urlKey:'other'},context),/identity does not match/)],
 ['identity completeness',"requireThat(object(resolvedAgent) && ['id','urlKey','companyId','adapterType','name'].every(key => typeof resolvedAgent[key] === 'string' && resolvedAgent[key].trim()), 'Paperclip agent identity is incomplete')",subject=>assert.throws(()=>subject.validateContext({...agent,name:undefined},context),/identity is incomplete/)]
])test('KNOCK-OUT launcher '+label,async()=>{
 const original=await import(launcherURL);witness(original)
 const changed=launcherSource.replace(needle,'/* knocked out */');assert.notEqual(changed,launcherSource)
 const absolute=changed.replace(/from '(\.\.?\/[^']+)'/g,(_,p)=>'from '+JSON.stringify(pathToFileURL(resolve(launcherPath,'..',p)).href)).replaceAll('import.meta.url',JSON.stringify(launcherURL))
 const broken=await import('data:text/javascript;base64,'+Buffer.from(absolute).toString('base64'))
 assert.throws(()=>witness(broken),assert.AssertionError);witness(original)
 console.log('KNOCK-OUT launcher '+label+': guard broken -> witness FAIL; restored -> PASS')
})
