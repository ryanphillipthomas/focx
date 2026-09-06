import { createServer } from 'node:http'
import { parseYaml, parseMarkdown, markdown, yaml } from './bundle.mjs'
import { expectedSkillWarning } from './fresh.mjs'
import { requireThat, slugOf } from './invariants.mjs'
import { dirname } from 'node:path'

export function memoryHost(files={}) {
  const dirs=new Set(),reads=[],writes=[],mtimes={},symlinks=new Set()
  const host={files,dirs,reads,writes,mtimes,symlinks,userHome:'/fake-user',tempDir:'/private/var/folders/fake/T',
    readText:p=>{reads.push(p);return files[p]??null},
    readJson:p=>{try{return JSON.parse(host.readText(p))}catch{return null}},
    entries:p=>[...new Set([...dirs,...Object.keys(files)].filter(f=>dirname(f)===p).map(f=>f.slice(p.length+1)))].sort(),
    exists:p=>dirs.has(p)||Object.hasOwn(files,p),isDirectory:p=>dirs.has(p),isSymlink:p=>symlinks.has(p),mtime:p=>mtimes[p]??null,
    containsLiteral:()=>false,runLogs:()=>[],writeText:(...args)=>writes.push(args),
  }
  for(const file of Object.keys(files))for(let p=dirname(file);p!==dirname(p);p=dirname(p))dirs.add(p)
  return host
}

const clone=structuredClone
const prune=value=>{
  if(value===false)return undefined
  if(Array.isArray(value))return value.map(prune).filter(v=>v!==undefined)
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,prune(v)]).filter(([,v])=>v!==undefined))
  return value
}
export function memoryIO() {
  let state=null,locked=false
  return {statePath:'/fake-instance/focx-bot/state.json',lockPath:'/fake-instance/focx-bot/lock',writes:[],snapshots:new Map(),files:{},
    async acquire(){requireThat(!locked,'Single-writer lock held');locked=true;return async()=>{locked=false}},
    async readState(){return clone(state)},
    async save(value){state=clone(value);this.writes.push(clone(value))},
    async writeSnapshot(path,record){this.snapshots.set(path,clone(record))},
    async writeFiles(files,emit){for(const [path,body]of Object.entries(files)){emit({write:{method:'WRITE_FILE',path,body}});this.files[path]=body}},
    get locked(){return locked},set locked(v){locked=v},
  }
}
export function createFakeApi(options={}) {
  let next=0
  const state={companies:[{id:'catalog-company',name:'Retained company'}],agents:[],triggers:[],secrets:[],calls:[],isInstanceAdmin:true,models:{codex_local:[{id:'gpt-6-astra'},{id:'gpt-5.6-sol'}],claude_local:[{id:'claude-opus-5'}]},fail:null,ignoreWrites:false,previewErrors:[],extraWarnings:[],...clone(options.seed??{})}
  const api={baseUrl:'http://fake.invalid',state,async request(method,path,body){
    state.calls.push({method,path,body:clone(body)})
    if (state.fail?.({method,path,body,call:state.calls.length})) throw new Error('Injected API failure')
    if (options.onCall) await options.onCall({method,path,body,state})
    const companyPath=path.match(/^\/api\/companies\/([^/?]+)(.*)$/)
    const agentPath=path.match(/^\/api\/agents\/([^/?]+)(.*)$/)
    const send=x=>clone(x)
    if(method==='GET' && path==='/api/cli-auth/me')return {isInstanceAdmin:state.isInstanceAdmin,userId:'fake-board'}
    if(method==='GET' && path==='/api/companies')return send(state.companies)
    if(method==='POST' && ['/api/companies/import/preview','/api/companies/import'].includes(path)) {
      requireThat(body.source?.type==='inline' && body.source.expectedFileCount===Object.keys(body.source.files).length,'Incomplete inline import')
      requireThat(!Object.hasOwn(body,'secretValues'),'Fake rejects all secretValues requests')
      const files=body.source.files,extension=parseYaml(files['.paperclip.yaml']),companyDoc=parseMarkdown(files['COMPANY.md'])
      requireThat(extension.schemaVersion===7 && body.target.mode==='new_company','Invalid import format/target')
      const entries=Object.entries(files).filter(([p])=>/^agents\/[^/]+\/AGENTS.md$/.test(p)).map(([p,text])=>({path:p,...parseMarkdown(text)}))
      const warnings=entries.map(e=>expectedSkillWarning(e.meta.slug??e.path.split('/')[1])).concat(state.extraWarnings)
      if(path.endsWith('/preview'))return {errors:send(state.previewErrors),warnings}
      requireThat(state.isInstanceAdmin,'Instance admin required')
      requireThat(!state.previewErrors.length,'Import preview errors')
      const requested=body.target.newCompanyName??companyDoc.meta.name
      const name=body.target.newCompanyName??(state.companies.some(c=>c.name===requested)?`${requested} (2)`:requested)
      const company={id:options.companyId??`company-${++next}`,name,issuePrefix:`FB${next}`}
      state.companies.push(company)
      const result={company:{...company,action:'created'},agents:[],warnings,envInputs:[]}
      for(const entry of entries) {
        const slug=entry.meta.slug??entry.path.split('/')[1],ext=extension.agents[slug]
        const config=clone(ext.adapter.config)
        if(ext.adapter.type==='codex_local')config.extraArgs=[...new Set([...(config.extraArgs??[]),'--skip-git-repo-check'])]
        config.instructionsBundleMode='managed';config.instructionsRootPath=`/fake/managed/${next}`;config.instructionsEntryFile='AGENTS.md';config.paperclipSkillSync={desiredSkills:entry.meta.skills}
        const id=options.agentIds?.[slug]??`agent-${++next}`,prefix=`agents/${slug}/`
        const agent={id,companyId:company.id,name:entry.meta.name,urlKey:slugOf({name:entry.meta.name}),title:entry.meta.title,status:body.pauseAutomations?'paused':'idle',role:ext.role,icon:ext.icon,reportsTo:null,adapterType:ext.adapter.type,adapterConfig:config,runtimeConfig:{...ext.runtime,heartbeat:{...ext.runtime?.heartbeat,enabled:false}},permissions:{canCreateAgents:false,canCreateSkills:true,...ext.permissions},desiredSkills:entry.meta.skills,entryFile:'AGENTS.md',legacyPromptTemplateActive:false,legacyBootstrapPromptTemplateActive:false,files:Object.fromEntries(Object.entries(files).filter(([p])=>p.startsWith(prefix)).map(([p,text])=>[p.slice(prefix.length),p===entry.path?entry.body+'\n':text])),access:{canAssignTasks:true,taskAssignSource:'explicit_grant',grants:[{permissionKey:'tasks:assign'}]}}
        state.agents.push(agent);result.agents.push({id,slug,name:agent.name,action:'created'})
        if(options.partialImport && result.agents.length===1)throw new Error('Injected partial import failure')
      }
      return send(result)
    }
    if(companyPath && method==='GET'){
      const [,id,tail]=companyPath
      if(tail.startsWith('/adapters/'))return send(state.models[tail.split('/')[2]]??[])
      const company=state.companies.find(c=>c.id===id);requireThat(company,'Unknown fake company')
      if(tail==='')return send(company)
      if(tail==='/agents')return send(state.agents.filter(a=>a.companyId===id).map(({id,name,urlKey})=>({id,name,urlKey})))
      if(tail==='/routines')return state.triggers.filter(t=>t.companyId===id).map(t=>({id:t.routineId}))
      if(tail==='/secrets/catalog')return send(state.secrets.filter(s=>s.companyId===id).map(({id,name})=>({id,name,key:name,status:'active'})))
      if(tail==='/export/fidelity')return {companyId:id,residue:[],includedClassesZeroResidue:true}
    }
    if(companyPath && method==='POST' && companyPath[2]==='/export') {
      requireThat(body.include?.issues===false && ['company','agents','projects','skills'].every(k=>body.include[k]===true),'Wrong export include flags')
      const company=state.companies.find(c=>c.id===companyPath[1]);requireThat(company,'Unknown export company')
      const files={'COMPANY.md':markdown({name:company.name})},agents={},manifestAgents=[]
      for(const a of state.agents.filter(a=>a.companyId===company.id)) {
        const slug=slugOf(a),config=prune(a.adapterConfig),inputs={env:{}}
        for(const [key,v] of Object.entries(config.env??{})) if(v?.type==='secret_ref') {inputs.env[key]={kind:'secret',requirement:'optional',default:''};delete config.env[key]}
        for(const [path,text] of Object.entries(a.files))files[`agents/${slug}/${path}`]=path==='AGENTS.md'?markdown({name:a.name,title:a.title,skills:a.desiredSkills},text):text
        agents[slug]={role:a.role,icon:a.icon,adapter:{type:a.adapterType,config},runtime:prune(a.runtimeConfig),permissions:prune(a.permissions),inputs}
        manifestAgents.push({slug,adapterType:a.adapterType,adapterConfig:config,runtimeConfig:agents[slug].runtime,permissions:agents[slug].permissions})
      }
      files['.paperclip.yaml']=yaml({schemaVersion:7,agents})
      return {files,manifest:{agents:manifestAgents,company:{name:company.name}},paperclipExtensionPath:'.paperclip.yaml',warnings:[]}
    }
    if(method==='GET' && path.startsWith('/api/routines/'))return {triggers:send(state.triggers.filter(t=>t.routineId===path.split('/').at(-1)))}
    if(agentPath){
      const [,id,tail]=agentPath,a=state.agents.find(a=>a.id===id);requireThat(a,'Unknown fake agent')
      if(method==='GET') {
        if(tail==='' || tail==='/configuration')return send(a)
        if(tail==='/skills')return {desiredSkills:send(a.desiredSkills)}
        if(tail==='/instructions-bundle')return {files:Object.keys(a.files).map(path=>({path})),entryFile:a.entryFile,legacyPromptTemplateActive:a.legacyPromptTemplateActive,legacyBootstrapPromptTemplateActive:a.legacyBootstrapPromptTemplateActive}
        if(tail.startsWith('/instructions-bundle/file?')){const path=new URLSearchParams(tail.split('?')[1]).get('path');return {path,content:a.files[path]}}
      }
      if(method==='PATCH' && tail==='/permissions') {
        if(!state.ignoreWrites){a.permissions={...a.permissions,...body};a.access={canAssignTasks:true,taskAssignSource:body.canAssignTasks?'explicit_grant':'simple_default',grants:body.canAssignTasks?[{permissionKey:'tasks:assign'}]:[]}}
        return send(a)
      }
      if(method==='PATCH' && tail==='') {
        if(!state.ignoreWrites){const {adapterConfig,replaceAdapterConfig,...other}=clone(body);Object.assign(a,other);if(adapterConfig)a.adapterConfig=replaceAdapterConfig?adapterConfig:{...a.adapterConfig,...adapterConfig}}
        return send(a)
      }
      if(method==='PATCH' && tail==='/instructions-bundle') {if(!state.ignoreWrites){a.entryFile=body.entryFile;a.legacyPromptTemplateActive=false;a.legacyBootstrapPromptTemplateActive=false}return {}}
      if(method==='PUT' && tail==='/instructions-bundle/file') {if(!state.ignoreWrites)a.files[body.path]=body.content;return {path:body.path,content:body.content}}
    }
    throw new Error(`No fake route for ${method} ${path}`)
  }}
  const server=createServer(async(req,res)=>{
    try {const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;const result=await api.request(req.method,req.url,body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result))}
    catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({message:error.message}))}
  })
  return Object.assign(api,{listen:()=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{api.baseUrl=`http://127.0.0.1:${server.address().port}`;resolve(api.baseUrl)})),close:()=>new Promise(resolve=>server.close(resolve))})
}
