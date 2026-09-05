// Optional integration: exercise the installed Claude CLI, never a real model.
// FOCX_TEST_CLAUDE_SDK_ROOT=/path/to/@anthropic-ai/claude-agent-sdk node --test tools/pilot-org/runtime-permissions.test.mjs
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const sdkRoot=process.env.FOCX_TEST_CLAUDE_SDK_ROOT
const binary=sdkRoot&&join(dirname(resolve(sdkRoot)),`claude-agent-sdk-${process.platform}-${process.arch}`,process.platform==='win32'?'claude.exe':'claude')
const skip=!sdkRoot?'Set FOCX_TEST_CLAUDE_SDK_ROOT to run the optional native permission checks':!existsSync(binary)?'Installed platform-specific Claude executable is unavailable':false
const tool=(name,input)=>({name,input})
const reportBody='## QA evidence\n`pipeline/runs/runtime/evidence.json` verified.\nLiteral $PAPERCLIP_API_KEY and $(printf must-not-expand).\n'

function streamMessage(response,model,blocks,id){
 response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'})
 const event=(type,data)=>response.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`)
 event('message_start',{message:{id:`msg_${id}`,type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}})
 for(const [index,block] of blocks.entries()){
  event('content_block_start',{index,content_block:block.type==='tool_use'?{...block,input:{}}:{type:'text',text:''}})
  event('content_block_delta',{index,delta:block.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}})
  event('content_block_stop',{index})
 }
 event('message_delta',{delta:{stop_reason:blocks.some(b=>b.type==='tool_use')?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:1}})
 event('message_stop',{})
 response.end()
}

async function runCase(t,{allow,deny=[],calls,prepare=()=>{},verify}){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'focx-native-permissions-')))
 const cwd=join(dir,'workspace'),config=join(dir,'config')
 mkdirSync(join(cwd,'.claude'),{recursive:true});mkdirSync(config)
 mkdirSync(join(cwd,'pipeline/runs/runtime'),{recursive:true})
 writeFileSync(join(cwd,'.claude/settings.local.json'),JSON.stringify({permissions:{defaultMode:'default',allow,deny}}))
 prepare(cwd)
 const requested=calls(cwd),prompts=[],results=[],failures=[],versions=[]
 let requests=0,stderr=''
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1')
   // The native client probes the configured API origin before messages.
   if(req.method==='HEAD'&&url.pathname==='/api/hello'){res.writeHead(200).end();return}
   if(req.method!=='POST'||url.pathname!=='/v1/messages'){
    failures.push(`Unexpected fixture route: ${req.method} ${url.pathname}`)
    res.writeHead(404).end();return
   }
   assert.equal(req.headers['x-api-key'],'offline-fixture-key')
   assert.equal(req.headers.authorization,undefined)
   const chunks=[];for await(const chunk of req)chunks.push(chunk)
   const body=JSON.parse(Buffer.concat(chunks))
   requests++
   assert(requests<=2,'Unexpected extra model round trip')
   const blocks=requests===1?requested.map((call,i)=>({type:'tool_use',id:`tool_${i}`,name:call.name,input:call.input})):[{type:'text',text:'Offline fixture completed.'}]
   streamMessage(res,body.model,blocks,requests)
  }catch(error){failures.push(error.message);if(!res.headersSent)res.writeHead(500);res.end()}
 })
 let query
 const abortController=new AbortController()
 const abort=()=>abortController.abort()
 t.signal.addEventListener('abort',abort,{once:true})
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  const sdk=await import(pathToFileURL(join(resolve(sdkRoot),'sdk.mjs')).href)
  const env={
   PATH:`${dirname(process.execPath)}:/usr/bin:/bin`,
   CLAUDE_CONFIG_DIR:config,
   CLAUDE_CODE_TMPDIR:join(dir,'runtime-temp'),
   ANTHROPIC_API_KEY:'offline-fixture-key',
   ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,
   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1',
  }
  query=sdk.query({prompt:'Execute the deterministic fixture response.',options:{
   cwd,env,abortController,pathToClaudeCodeExecutable:binary,model:'claude-sonnet-4-5-20250929',
   permissionMode:'default',settingSources:['local'],settings:{disableAllHooks:true},
   tools:['Read','Write','Edit','NotebookEdit','Bash'],strictMcpConfig:true,mcpServers:{},
   thinking:{type:'disabled'},persistSession:false,maxTurns:2,
   canUseTool:async(name,input)=>{prompts.push({name,input});return{behavior:'deny',message:'Offline fixture denies every unmatched permission request.'}},
   stderr:data=>{stderr+=data},
  }})
  for await(const message of query){
   if(message.type==='system'&&message.subtype==='init')versions.push(message.claude_code_version)
   if(message.type==='user')for(const block of message.message.content)if(block.type==='tool_result')results.push(block)
   if(message.type==='result')assert.equal(message.is_error,false,JSON.stringify(message))
  }
  assert.deepEqual(failures,[])
  assert.equal(requests,2,'Fixture must observe tool result round trip')
  assert.equal(results.length,requested.length,'Every requested tool must produce an observed result')
  assert.equal(versions.length,1)
  t.diagnostic(`Installed Claude Code ${versions[0]}; ${results.length} real tool result(s), ${prompts.length} unmatched permission prompt(s)`)
  verify({cwd,prompts,results})
 }catch(error){
  error.message+=`\nCLI stderr: ${stderr.slice(-4000)}`
  throw error
 }finally{
  query?.close()
  t.signal.removeEventListener('abort',abort)
  server.closeAllConnections()
  await new Promise(resolve=>server.close(resolve))
  rmSync(dir,{recursive:true,force:true})
 }
}

const options={skip,timeout:60000}
test('native runtime: historical Write(path) rule does not authorize evidence creation',options,t=>runCase(t,{
 allow:['Write(pipeline/runs/**)'],calls:cwd=>[tool('Write',{file_path:join(cwd,'pipeline/runs/runtime/evidence.json'),content:'{}'})],
 verify:({cwd,prompts,results})=>{assert.equal(prompts[0]?.name,'Write');assert.equal(results[0].is_error,true);assert(!existsSync(join(cwd,'pipeline/runs/runtime/evidence.json')))},
}))
test('native runtime: anchored Edit(path) authorizes real Write inside evidence',options,t=>runCase(t,{
 allow:['Edit(/pipeline/runs/**)'],calls:cwd=>[tool('Write',{file_path:join(cwd,'pipeline/runs/runtime/evidence.json'),content:'{"verified":true}'})],
 verify:({cwd,prompts,results})=>{assert.deepEqual(prompts,[]);assert(!results[0].is_error);assert.equal(readFileSync(join(cwd,'pipeline/runs/runtime/evidence.json'),'utf8'),'{"verified":true}')},
}))
test('native runtime: anchored evidence grant denies a Write outside evidence',options,t=>runCase(t,{
 allow:['Edit(/pipeline/runs/**)'],calls:cwd=>[tool('Write',{file_path:join(cwd,'outside.json'),content:'{}'})],
 verify:({cwd,prompts,results})=>{assert.equal(prompts[0]?.name,'Write');assert.equal(results[0].is_error,true);assert(!existsSync(join(cwd,'outside.json')))},
}))
test('native runtime: bare Edit and NotebookEdit denials preserve scoped Write',options,t=>runCase(t,{
 allow:['Edit(/pipeline/runs/**)'],deny:['Edit','NotebookEdit','Skill'],
 prepare:cwd=>writeFileSync(join(cwd,'pipeline/runs/runtime/existing.txt'),'original'),
 calls:cwd=>[
  tool('Write',{file_path:join(cwd,'pipeline/runs/runtime/evidence.json'),content:'{}'}),
  tool('Edit',{file_path:join(cwd,'pipeline/runs/runtime/existing.txt'),old_string:'original',new_string:'changed'}),
  tool('NotebookEdit',{notebook_path:join(cwd,'pipeline/runs/runtime/book.ipynb'),new_source:'print(1)',cell_type:'code',edit_mode:'insert'}),
 ],
 verify:({cwd,prompts,results})=>{
  assert.deepEqual(prompts,[])
  assert(!results.find(r=>r.tool_use_id==='tool_0').is_error)
  assert.equal(readFileSync(join(cwd,'pipeline/runs/runtime/evidence.json'),'utf8'),'{}')
  for(const id of ['tool_1','tool_2']){
   const result=results.find(r=>r.tool_use_id===id)
   assert.equal(result.is_error,true)
   assert.match(JSON.stringify(result.content),/permission|denied|not allowed|disabled for this session/i,'Deny must come from permissions, not invalid tool input')
  }
  assert.equal(readFileSync(join(cwd,'pipeline/runs/runtime/existing.txt'),'utf8'),'original')
  assert(!existsSync(join(cwd,'pipeline/runs/runtime/book.ipynb')))
 },
}))
test('native runtime: exact evidence mkdir command is approved',options,t=>runCase(t,{
 allow:['Bash(mkdir -p pipeline/runs/*)'],calls:()=>[tool('Bash',{command:'mkdir -p pipeline/runs/runtime/new-directory',description:'Create the fixture evidence directory'})],
 verify:({cwd,prompts,results})=>{assert.deepEqual(prompts,[]);assert(!results[0].is_error);assert(existsSync(join(cwd,'pipeline/runs/runtime/new-directory')))},
}))
test('native runtime: direct reporting command with quoted heredoc matches the narrow rule',options,t=>runCase(t,{
 allow:['Bash(scripts/paperclip-issue-update.sh:*)'],
 prepare:cwd=>{mkdirSync(join(cwd,'scripts'));writeFileSync(join(cwd,'scripts/paperclip-issue-update.sh'),'#!/bin/bash\nset -eu\n[ "$1" = --status ]\n[ "$2" = blocked ]\ncat > pipeline/runs/runtime/report.txt\n',{mode:0o755})},
 calls:()=>[tool('Bash',{command:`scripts/paperclip-issue-update.sh --status blocked <<'QA_REPORT'\n${reportBody}QA_REPORT`,description:'Run the harmless local report fixture'})],
 verify:({cwd,prompts,results})=>{assert.deepEqual(prompts,[]);assert(!results[0].is_error);assert.equal(readFileSync(join(cwd,'pipeline/runs/runtime/report.txt'),'utf8'),reportBody)},
}))
