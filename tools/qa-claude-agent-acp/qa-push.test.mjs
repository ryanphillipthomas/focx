import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname,delimiter} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

const root=fileURLToPath(new URL('../../',import.meta.url))
const script=join(root,'scripts/qa-push.sh')
const branch='FOC-92-qa-evidence'

function run(t,{workspaceBranch=branch,unset=false,head=branch,args=[],outside=false,headExit=0,pushExit=0}={}) {
 const dir=mkdtempSync(join(tmpdir(),'qa-push-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const bin=join(dir,'bin'),log=join(dir,'git.jsonl')
 const cwd=outside?join(dir,'outside'):join(dir,'.paperclip/worktrees/issue')
 mkdirSync(bin);mkdirSync(cwd,{recursive:true});writeFileSync(log,'')
 // All Git invocations stop here; this stub never invokes a real Git binary.
 writeFileSync(join(bin,'git'),`#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.QA_PUSH_LOG,JSON.stringify(args)+'\\n');
if(JSON.stringify(args)===JSON.stringify(['rev-parse','--abbrev-ref','HEAD'])) {
 if(Number(process.env.QA_HEAD_EXIT)) {process.stderr.write('credential-shaped fixture diagnostic');process.exit(Number(process.env.QA_HEAD_EXIT));}
 process.stdout.write(process.env.QA_HEAD+'\\n');
} else if(args[0]==='push') {
 process.stdout.write('credential-shaped fixture diagnostic');
 process.stderr.write('credential-shaped fixture diagnostic');
 process.exit(Number(process.env.QA_PUSH_EXIT));
} else process.exit(99);
`,{mode:0o755})
 // A minimal environment avoids inherited shell startup files and Git config.
 const env={PATH:[bin,dirname(process.execPath),'/usr/bin','/bin'].join(delimiter),
  QA_PUSH_LOG:log,QA_HEAD:head,QA_HEAD_EXIT:String(headExit),QA_PUSH_EXIT:String(pushExit)}
 if(!unset)env.PAPERCLIP_WORKSPACE_BRANCH=workspaceBranch
 const result=spawnSync(script,args,{cwd,env,encoding:'utf8',timeout:10000})
 assert.ifError(result.error)
 assert.equal(result.signal,null)
 const calls=readFileSync(log,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line))
 return {...result,calls}
}

test('happy path pushes exactly one branch with the complete expected argument vector',t=>{
 assert.equal(statSync(script).mode & 0o111,0o111)
 const result=run(t)
 assert.equal(result.status,0,result.stderr)
 assert.deepEqual(result.calls,[['rev-parse','--abbrev-ref','HEAD'],['push','origin','FOC-92-qa-evidence']])
 assert.equal(result.stdout,'');assert.equal(result.stderr,'')
})

const refusals=[
 ['any argument',{args:['develop:main']},/arguments are not allowed/,true],
 ['empty argument',{args:['']},/arguments are not allowed/,true],
 ['unset branch',{unset:true},/unset or empty/,true],
 ['empty branch',{workspaceBranch:''},/unset or empty/,true],
 ['lowercase prefix',{workspaceBranch:'foca-1-x'},/uppercase issue prefix/,true],
 ['missing issue number',{workspaceBranch:'RANDOM-branch'},/issue number/,true],
 ['main',{workspaceBranch:'main'},/issue number/,true],
 ['run branch',{workspaceBranch:'run/run-20260907-f24'},/issue number/,true],
 ['HEAD mismatch',{head:'FOC-93-other'},/does not match/,false],
 ['outside worktree',{outside:true},/inside \.paperclip\/worktrees\//,false],
 ['HEAD lookup failure',{headExit:1},/could not resolve the current branch/,false],
 ...['FOC-92-x y',"FOC-92-x'y",'FOC-92-x"y','FOC-92-x;y','FOC-92-$(id)',
  'FOC-92-x:main','FOC-92-x\ny'].map(workspaceBranch=>
  ['unsafe branch '+JSON.stringify(workspaceBranch),{workspaceBranch,head:workspaceBranch},/forbidden characters/,true]),
]
for(const [name,options,message,noGit] of refusals)test('refuses '+name+' without pushing',t=>{
 const result=run(t,options)
 assert.notEqual(result.status,0)
 assert.equal(result.stdout,'')
 assert.match(result.stderr,message)
 assert.match(result.stderr,/^qa-push: [^\n]+\n$/)
 assert(!result.stderr.includes('credential-shaped'))
 assert.deepEqual(result.calls,noGit?[]:[['rev-parse','--abbrev-ref','HEAD']])
})

test('push failure is nonzero and does not expose Git diagnostics',t=>{
 const result=run(t,{pushExit:1})
 assert.notEqual(result.status,0)
 assert.equal(result.stdout,'')
 assert.equal(result.stderr,'qa-push: git push failed\n')
 assert.deepEqual(result.calls,[['rev-parse','--abbrev-ref','HEAD'],['push','origin',branch]])
})

test('both declared QA grants are exact script commands with no direct git push grant',()=>{
 for(const file of ['.focx/agents.json','packages/focx-bot/contract.json']) {
  const raw=readFileSync(join(root,file),'utf8')
  const qa=JSON.parse(raw).agents.find(agent=>agent.roleKey==='qa-engineer')
  assert(qa,file)
  assert.deepEqual(qa.adapterLocal.permissionsAllow.filter(rule=>rule.includes('qa-push.sh')),['Bash(scripts/qa-push.sh)'],file)
  assert.equal(raw.split('Bash(scripts/qa-push.sh)').length-1,1,file)
  assert(!raw.includes('Bash(git push'),file)
 }
})
