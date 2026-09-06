import { readFileSync, readdirSync, existsSync, lstatSync, statSync, readlinkSync, realpathSync, mkdirSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve, dirname, join, sep } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { requireThat } from './invariants.mjs'
import { ROOT } from './contract.mjs'

export const expand = p => p.replace(/^~(?=\/|$)/,homedir())
export const instanceRoot = contract => join(expand(contract.instance.home),'instances',contract.instance.id)
export const EXPECTED_ADAPTER_TYPES=['process','http','claude_local','codex_local','paperclip_runner','cursor_cloud','gemini_local','grok_local','hermes_gateway','hermes_local','kimi_local','opencode_local','pi_local','cursor','openclaw_gateway']
export async function checkInstalledAdapters(contract,root=join(expand(contract.instance.home),'cli/current/node_modules')) {
  const {AGENT_ADAPTER_TYPES}=await import(pathToFileURL(join(root,'@paperclipai/shared/dist/constants.js')))
  requireThat(JSON.stringify(AGENT_ADAPTER_TYPES)===JSON.stringify(EXPECTED_ADAPTER_TYPES), 'Installed adapter enum changed; review contract adapter data')
  requireThat(Object.keys(contract.adapters).every(k=>AGENT_ADAPTER_TYPES.includes(k)), 'Contract adapter unavailable in installed Paperclip')
  return {installedTypes:AGENT_ADAPTER_TYPES,matched:true}
}
export function modelEvidence(contract, companyId, catalog, host) {
  const root=instanceRoot(contract),path=`${root}/companies/${companyId}/codex-home/models_cache.json`
  const cached=host.readJson(path),mtime=host.mtime(path)
  const models=Array.isArray(cached?.models)?cached.models:[]
  const binary=join(expand(contract.instance.home),'cli/current/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex')
  return contract.agents.filter(a=>a.adapterType==='codex_local').flatMap(a=>[
    `Paperclip adapter catalog: ${a.model}: ${catalog.find(c=>c.slug===a.slug)?.present===true?'present':'absent or unavailable'} (catalog membership only)`,
    `ACP-lane cache: ${a.model}: ${cached===null?'unavailable':models.some(m=>m.slug===a.model||m.id===a.model)?'present':'absent'}; mtime=${mtime??'unavailable'}; path=${path}`,
    `Native bundled binary literal: ${a.model}: ${host.containsLiteral(binary,a.model)??'unavailable'}; path=${binary}; no execution`,
  ])
}
export function defaultHost(contract) {
  const root=instanceRoot(contract)
  const readText=p=>{try{return readFileSync(p,'utf8')}catch{return null}}
  const entries=p=>{try{return readdirSync(p)}catch{return []}}
  return {readText,entries,exists:existsSync,readJson:p=>{try{return JSON.parse(readText(p))}catch{return null}},mtime:p=>{try{return statSync(p).mtime.toISOString()}catch{return null}},isSymlink:p=>{try{return lstatSync(p).isSymbolicLink()}catch{return false}},containsLiteral:(p,s)=>{try{return readFileSync(p).includes(Buffer.from(s))}catch{return null}},runLogs:()=>{
    const out=[]
    const walk=p=>{for(const name of entries(p)){const file=join(p,name);const stat=lstatSync(file);if(stat.isSymbolicLink())continue;if(stat.isDirectory())walk(file);else if(/\.(jsonl|log|txt)$/.test(name))out.push({path:file,text:readText(file)??''})}}
    walk(join(root,'data/run-logs'));return out
  }}
}
export function checkHostPrerequisites(contract) {
  let claudeVersion=null,listener=false,listenerExecutable=null
  try {claudeVersion=readlinkSync(join(homedir(),'.local/bin/claude')).split('/').at(-1)}catch{}
  try {
    const text=execFileSync('/usr/sbin/lsof',['-nP',`-iTCP:${contract.database.port}`,'-sTCP:LISTEN','-Fpcn'],{encoding:'utf8',timeout:10000})
    const pid=text.match(/^p(\d+)$/m)?.[1]
    if(pid){const exe=execFileSync('/usr/sbin/lsof',['-a','-p',pid,'-d','txt','-Fn'],{encoding:'utf8',timeout:10000});listenerExecutable=exe.split('\n').find(s=>s.startsWith('n')&&s.includes('/postgresql@17/')&&s.endsWith('/postgres'))?.slice(1)??null;listener=!!listenerExecutable && text.includes(`:${contract.database.port}`)}
  } catch {}
  return {postgresql17:{host:contract.database.host,port:contract.database.port,listener,executable:listenerExecutable},claudeRuntime:{expected:contract.skills.claudeRuntime.version,observed:claudeVersion,matches:claudeVersion===contract.skills.claudeRuntime.version},servicesInstalled:false}
}
export function localIO(contract, statePath) {
  const root=instanceRoot(contract),path=resolve(expand(statePath??join(root,'focx-bot/state.json'))),lockPath=join(root,'focx-bot/writer.lock')
  requireThat(path.startsWith(root+sep) && !path.startsWith(ROOT+sep), 'Provisioning state must be instance-local and outside the repository')
  const safeParent=p=>{
    let parent=dirname(p);while(!existsSync(parent))parent=dirname(parent)
    requireThat(realpathSync(parent)===parent, 'Refusing a state/config parent containing symlinks')
  }
  return {statePath:path,lockPath,
    async acquire(){safeParent(lockPath);mkdirSync(dirname(lockPath),{recursive:true,mode:0o700});const fd=openSync(lockPath,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid}));return async()=>{closeSync(fd);unlinkSync(lockPath)}},
    async readState(){try{return JSON.parse(readFileSync(path,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}},
    async save(value){safeParent(path);mkdirSync(dirname(path),{recursive:true,mode:0o700});requireThat(!existsSync(path)||!lstatSync(path).isSymbolicLink(),'State cannot be a symlink');writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600})},
    async writeFiles(files,emit){for(const [p,text]of Object.entries(files)){requireThat(resolve(p).startsWith(root+sep),'Config write escapes the instance');safeParent(p);requireThat(!existsSync(p)||!lstatSync(p).isSymbolicLink(),'Config cannot be a symlink');emit({write:{method:'MKDIR',path:dirname(p)}});mkdirSync(dirname(p),{recursive:true,mode:0o700});emit({write:{method:'WRITE_FILE',path:p,body:text}});writeFileSync(p,text,{mode:0o600})}},
    async writeSnapshot(p,record){const out=resolve(expand(p));requireThat(out.startsWith(root+sep),'Snapshot must be instance-local');safeParent(out);mkdirSync(dirname(out),{recursive:true,mode:0o700});writeFileSync(out,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600})},
  }
}
