import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,copyFileSync,cpSync,symlinkSync,existsSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {loadSource,ROOT} from './index.mjs'
import {validateContext,mergeSettings,prepare} from '../qa-claude-agent-acp/index.mjs'
const source=loadSource(),qa=source.manifest.agents.find(x=>x.roleKey==='qa-engineer')
const env={PAPERCLIP_AGENT_ID:qa.id,PAPERCLIP_COMPANY_ID:source.manifest.companyId,PAPERCLIP_TASK_ID:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',PAPERCLIP_RUN_ID:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}
const denyRules=qa.adapterLocal.permissionsDeny
const cwd='/project/.paperclip/worktrees/FOC-92-smoke'
const context={source,env,cwd,root:cwd,branch:'FOC-92-smoke',commonDir:'/project/.git'}
const local=(root=cwd)=>({permissions:{defaultMode:'default',allow:['Bash(curl:*)','Bash(env:*)','Bash(env)',`Bash(${root}/scripts/paperclip-issue-update.sh:*)`,`Bash(${root}/scripts/paperclip:*)`],deny:['Bash(rm:*)'],additionalDirectories:['/agent']}})
test('QA identity, bound task and isolated worktree are required',()=>{
 assert.deepEqual(validateContext(context),qa.adapterLocal.permissionsAllow)
 for(const edit of [{env:{}},{env:{...env,PAPERCLIP_AGENT_ID:'other'}},{env:{...env,PAPERCLIP_TASK_ID:''}},{cwd:'/project',root:'/project'},{branch:'develop'},{root:'/different'},{commonDir:cwd+'/.git'}])assert.throws(()=>validateContext({...context,...edit}))
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
test('launcher writes and reads back only the isolated worktree mirror, rejects symlinks and ordinary checkouts',()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'focx-launcher-')))
 try{
  const repo=join(dir,'repo');mkdirSync(repo)
  const git=(...args)=>execFileSync('git',args,{cwd:repo,stdio:'pipe'})
  git('init');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','fixture')
  const worktree=join(repo,'.paperclip/worktrees/FOC-92-smoke');git('worktree','add','-b','FOC-92-smoke',worktree)
  cpSync(join(ROOT,'.focx'),join(worktree,'.focx'),{recursive:true})
  mkdirSync(join(worktree,'.claude'));copyFileSync(join(ROOT,'.claude/settings.json'),join(worktree,'.claude/settings.json'))
  mkdirSync(join(worktree,'tools/qa-claude-agent-acp'),{recursive:true});copyFileSync(join(ROOT,'tools/qa-claude-agent-acp/index.mjs'),join(worktree,'tools/qa-claude-agent-acp/index.mjs'))
  const file=join(worktree,'.claude/settings.local.json');writeFileSync(file,JSON.stringify(local(worktree)))
  const result=prepare({cwd:worktree,root:worktree,env});assert.equal(result.rules,qa.adapterLocal.permissionsAllow.length)
  const after=readFileSync(file,'utf8');assert.deepEqual(JSON.parse(after).permissions.allow,mergeSettings(local(worktree),qa.adapterLocal.permissionsAllow,worktree,denyRules).permissions.allow)
  prepare({cwd:worktree,root:worktree,env});assert.equal(readFileSync(file,'utf8'),after)
  assert(!existsSync(join(repo,'.claude/settings.local.json')))
  assert.throws(()=>prepare({cwd:repo,root:worktree,env}))
  const target=join(dir,'external.json');writeFileSync(target,'{}');rmSync(file);symlinkSync(target,file)
  assert.throws(()=>prepare({cwd:worktree,root:worktree,env}),/regular file/);assert.equal(readFileSync(target,'utf8'),'{}')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
