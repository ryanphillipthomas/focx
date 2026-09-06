import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { requireThat } from './invariants.mjs'
import { catalogEntries } from './skills.mjs'

// Protocol shapes were generated from the installed 0.152.1 native binary
// (`codex app-server generate-json-schema`, FB4 build log); retained schemas
// are in native-schema/ (ClientRequest includes PluginListParams;
// v2 PluginRead/PluginInstall/AppsInstalled params and responses). No thread,
// turn, process, OAuth or model API is used. PluginListResponse was also
// checked read-only at c852f77:packages/focx-bot/native-schema/v2/PluginListResponse.json.
// Contract manifests inside either known Codex home are runtime-owned. The
// shared codex-runtimes cache is deliberately outside this boundary.
function reservedManifest(manifest,companyHome) {
  if(typeof manifest!=='string')return false
  const path=resolve(manifest.replace(/^~(?=\/|$)/,homedir()))
  return [join(homedir(),'.codex'),companyHome].filter(Boolean).some(home=>{
    const rel=relative(resolve(home),path)
    return rel==='' || (rel!=='..' && !rel.startsWith('../') && !isAbsolute(rel))
  })
}
export function nativePluginPlan(contract,companyHome) {
  return catalogEntries(contract.skills).filter(e=>e.adapter==='codex_local' && e.pinned).map(entry=>{
    const [name,marketplace]=entry.key.split('@'),market=contract.skills.codexPlugins.marketplaces[marketplace]
    if(reservedManifest(market.manifest,companyHome))return {kind:'native-plugin-verify',entry,home:companyHome,method:'plugin/list',params:{marketplaceKinds:['local'],forceRefetch:false}}
    const params=entry.sourceId?{remoteMarketplaceName:marketplace,pluginName:entry.sourceId}:{marketplacePath:market.manifest.replace(/^~/,homedir()),pluginName:name}
    return {kind:'native-plugin-install',entry,home:companyHome,method:'plugin/install',params}
  })
}
export function assertNativePin(entry,detail,{installed=false,readJson=p=>JSON.parse(readFileSync(p,'utf8'))}={}) {
  const s=detail?.plugin?.summary
  requireThat(s && (!entry.sourceId || s.remotePluginId===entry.sourceId), `${entry.key}: native readback has a different remote source identity`)
  requireThat(s.availability===undefined || s.availability==='AVAILABLE',`${entry.key}: unavailable in the runtime`)
  let version=installed?s.localVersion:s.version??s.localVersion
  if(!installed && !entry.sourceId && s.source?.type==='local')version=readJson(join(s.source.path,'.codex-plugin/plugin.json')).version
  requireThat(version===entry.version,`${entry.key}: native pin version mismatch`)
  if(installed)requireThat(s.installed===true && s.enabled===true,`${entry.key}: native installation is not active`)
  return s
}
export async function installNativePlugins(operations,runtime,emit) {
  const needsAuth=[],apps=new Map(),entries=[],findings=[]
  let seededList
  const report=()=>({entries,findings,needsAuth:[...new Map(needsAuth.map(a=>[a.appId,a])).values()],oauthPerformed:false})
  for(const [index,op] of operations.entries()) {
    let stage='plan'
    try {
      requireThat(['native-plugin-install','native-plugin-verify'].includes(op.kind) && op.entry.pinned===true,'Unpinned native plugins are never installed')
      if(op.kind==='native-plugin-verify') {
        // A rejected list is retained, not retried for each remaining seed.
        stage='seeded-read'
        seededList??=runtime.request('plugin/list',{marketplaceKinds:['local'],forceRefetch:false})
        const listed=await seededList
        requireThat(Array.isArray(listed?.marketplaces) && (!listed.marketplaceLoadErrors || (Array.isArray(listed.marketplaceLoadErrors) && !listed.marketplaceLoadErrors.length)),'Incomplete native seed inventory')
        const [name,marketplace]=op.entry.key.split('@'),markets=listed.marketplaces.filter(m=>m.name===marketplace)
        requireThat(markets.length<=1 && markets.every(m=>Array.isArray(m.plugins)),'Ambiguous native seed marketplace')
        const matches=markets.flatMap(m=>m.plugins).filter(s=>s.name===name)
        requireThat(matches.length<=1,'Ambiguous native seed identity')
        if(!matches.length || matches[0].installed===false) {
          const row={key:op.entry.key,status:'seeded-missing',reportingOnly:true,reason:'Runtime has not seeded this pinned plugin'}
          entries.push(row);findings.push(row)
          continue
        }
        stage='seeded-pin'
        assertNativePin(op.entry,{plugin:{summary:matches[0]}},{installed:true})
        entries.push({key:op.entry.key,status:'verified',reserved:true})
        continue
      }
      requireThat(op.method==='plugin/install' && !reservedManifest(op.params?.marketplacePath,op.home),'Reserved marketplaces must never be installed by path')
      stage='read'
      const before=await runtime.request('plugin/read',op.params)
      const summary=assertNativePin(op.entry,before)
      for(const a of before.plugin.apps??[])apps.set(a.id,{plugin:op.entry.key,appId:a.id,name:a.name,action:'Ryan checks sign-in and app access by hand'})
      if(summary.installed && summary.enabled && summary.localVersion===op.entry.version){entries.push({key:op.entry.key,status:'verified',reserved:false});continue}
      stage='install'
      emit({write:op})
      const result=await runtime.request(op.method,op.params)
      requireThat(Array.isArray(result?.appsNeedingAuth),`${op.entry.key}: incomplete native install response`)
      needsAuth.push(...result.appsNeedingAuth.map(a=>({plugin:op.entry.key,appId:a.id,name:a.name,action:'Ryan authenticates by hand'})))
      stage='readback'
      assertNativePin(op.entry,await runtime.request('plugin/read',op.params),{installed:true})
      entries.push({key:op.entry.key,status:'installed'})
    } catch {
      const reportingOnly=op.kind==='native-plugin-verify' && op.entry.pinned===true
      const row={key:op.entry.key,status:'failed',stage,reportingOnly,reason:'Native plugin verification or installation failed; runtime output withheld; no retry'}
      entries.push(row)
      if(reportingOnly){findings.push(row);continue}
      for(const pending of operations.slice(index+1))entries.push({key:pending.entry.key,status:'skipped',reason:'Stopped after an earlier native plugin failure'})
      const result=report()
      emit({nativePlugins:result})
      throw Object.assign(new Error(row.reason),{result})
    }
  }
  try {
    if(apps.size){const installed=await runtime.request('app/installed',{});requireThat(Array.isArray(installed?.apps),'Missing native app runtime state');for(const [id,entry]of apps)if(!installed.apps.some(a=>a.id===id&&a.enabled&&a.callable))needsAuth.push(entry)}
  } catch {
    const reason='Native app state check failed; runtime output withheld; no retry'
    findings.push({status:'failed',stage:'app-state',reportingOnly:false,reason})
    const result=report()
    emit({nativePlugins:result})
    throw Object.assign(new Error(reason),{result})
  }
  return report()
}
export class NativePluginRuntime {
  constructor(command,home,emit) {this.command=command;this.home=home;this.emit=emit;this.pending=new Map();this.next=0}
  async open() {
    this.emit({write:{method:'START_PLUGIN_MANAGER',command:this.command,args:['app-server'],home:this.home,note:'Management-only process; may update native plugin caches; no agent/model/OAuth request'}})
    this.child=spawn(this.command,['app-server'],{env:{PATH:process.env.PATH,HOME:homedir(),USER:process.env.USER,TMPDIR:process.env.TMPDIR,CODEX_HOME:this.home},stdio:['pipe','pipe','pipe']})
    this.child.stderr.resume()
    this.child.on('error',()=>this.fail('Native plugin manager failed to start'))
    this.child.on('exit',()=>this.fail('Native plugin manager exited'))
    this.lines=createInterface({input:this.child.stdout})
    this.lines.on('line',line=>{
      let message;try{message=JSON.parse(line)}catch{return this.fail('Invalid native JSON-RPC response')}
      if(message.method && message.id!==undefined){this.child.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'focx-bot never handles approval, execution or OAuth requests'}})+'\n');return}
      const pending=this.pending.get(message.id);if(!pending)return
      this.pending.delete(message.id);clearTimeout(pending.timer)
      if(message.error)pending.reject(new Error('Native plugin request failed; response withheld; no retry'))
      else pending.resolve(message.result)
    })
    await this.request('initialize',{clientInfo:{name:'focx-bot',version:'0.1.0'},capabilities:{experimentalApi:true}})
    this.child.stdin.write(JSON.stringify({method:'initialized'})+'\n')
    return this
  }
  fail(message){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(message))}this.pending.clear()}
  request(method,params) {
    requireThat(['initialize','plugin/list','plugin/read','plugin/install','app/installed'].includes(method),'Only native plugin management is allowed; never run agents or OAuth')
    return new Promise((resolve,reject)=>{
      const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Native plugin request timed out; no retry'));this.close()},120000)
      this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({method,id,params})+'\n')
    })
  }
  close(){this.fail('Native plugin manager closed');this.lines?.close();this.child?.stdin.end();this.child?.kill()}
}
