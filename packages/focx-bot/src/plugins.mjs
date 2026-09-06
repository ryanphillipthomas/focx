import { readFileSync, readdirSync, existsSync, lstatSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { requireThat } from './invariants.mjs'
import { catalogEntries } from './skills.mjs'

const json=p=>JSON.parse(readFileSync(p,'utf8'))
// FB3's recorded method: sorted shasum output (including ./ relative paths),
// then sha256 of that output, first 12 hex. No plugin code is executed.
export function contentHash(root) {
  const files=[]
  const walk=(path,relative='')=>{
    for(const name of readdirSync(path)){
      if(['.git','.orphaned_at','.in_use'].includes(name))continue
      const p=join(path,name),r=relative?`${relative}/${name}`:name,stat=lstatSync(p)
      if(stat.isSymbolicLink())continue
      if(stat.isDirectory())walk(p,r)
      else if(stat.isFile())files.push(r)
    }
  }
  walk(root)
  const text=files.sort().map(p=>`${createHash('sha256').update(readFileSync(join(root,p))).digest('hex')}  ./${p}\n`).join('')
  return createHash('sha256').update(text).digest('hex').slice(0,12)
}
export function pluginReadbackMatches(entry,row) {
  if(!row || row.key!==entry.key || row.adapter!==entry.adapter)return false
  if(entry.sourceId && row.sourceId!==entry.sourceId)return false
  if(entry.contentHash)return row.contentHash===entry.contentHash
  if(entry.pin==='manifestSha')return row.sourceSha===entry.source?.sha
  if(entry.gitCommitSha && row.gitCommitSha!==entry.gitCommitSha)return false
  return typeof entry.version==='string' && row.version===entry.version
}
export function pluginOperations(contract,rows,companyHome,{adapter}={}) {
  const operations=[]
  for(const entry of catalogEntries(contract.skills)) {
    if(!entry.pinned || (adapter && entry.adapter!==adapter))continue
    const installed=rows.find(r=>r.installed && pluginReadbackMatches(entry,r))
    if(installed)continue
    // A name alone cannot select webmcp's two different source identities.
    // Only a unique configured snapshot matching the full pin is acceptable.
    const candidates=rows.filter(r=>r.key===entry.key && r.adapter===entry.adapter && r.available && (!entry.sourceId || r.sourceId===entry.sourceId))
    requireThat(candidates.length===1 && pluginReadbackMatches(entry,candidates[0]), `Pin ${entry.key} has no unique matching configured runtime snapshot; refresh/select that snapshot by hand before provisioning`)
    requireThat(!entry.requiresOAuth || candidates[0].authenticated===true, `${entry.key}: Ryan must complete the declared OAuth prerequisite by hand; the provisioner never starts OAuth`)
    const [name,marketplace]=entry.key.split('@')
    requireThat(/^[a-zA-Z0-9._-]+$/.test(name) && /^[a-zA-Z0-9._-]+$/.test(marketplace),'Unsafe plugin command identity')
    requireThat(!entry.sourceId, `${entry.key}: remote source-id installation and OAuth separation must be established against the installed runtime before selecting an install command`)
    operations.push({kind:'install-pinned-plugin',entry,command:entry.adapter==='claude_local'?join(homedir(),'.local/bin/claude'):join(homedir(),'.local/bin/codex'),args:entry.adapter==='claude_local'?['plugin','install',entry.key,'--scope','user']:['plugin','add',entry.key,'--json'],env:entry.adapter==='codex_local'?{CODEX_HOME:companyHome}:{}})
  }
  return operations
}
// These readers inspect metadata only. No CLI is run during verify, no auth
// file is opened, and unavailable metadata is reported instead of guessed.
export function readPluginInventory(contract,companyHome,options={}) {
  if(options.metadataOnly)return readInstalledMetadata(companyHome,options.host,options.userHome??homedir())
  const rows=[],cache=new Map()
  const cached=p=>{if(!cache.has(p))cache.set(p,json(p));return cache.get(p)}
  for(const entry of catalogEntries(contract.skills).filter(e=>e.pinned)) {
    const [name,marketplace]=entry.key.split('@')
    if(entry.adapter==='claude_local') {
      const base=join(homedir(),'.claude/plugins'),manifestPath=join(base,'marketplaces',marketplace,'.claude-plugin/marketplace.json')
      try {
        const manifest=cached(manifestPath),matches=manifest.plugins.filter(p=>p.name===name)
        for(const p of matches){
          const local=typeof p.source==='string'?resolve(base,'marketplaces',marketplace,p.source):null
          const definition=local&&existsSync(join(local,'.claude-plugin/plugin.json'))?json(join(local,'.claude-plugin/plugin.json')):{}
          rows.push({key:entry.key,adapter:entry.adapter,available:true,version:p.version??definition.version,sourceSha:p.source?.sha,contentHash:entry.contentHash&&local?contentHash(local):undefined,gitCommitSha:entry.gitCommitSha?manifest.gitCommitSha:undefined})
        }
        const installed=cached(join(base,'installed_plugins.json')).plugins?.[entry.key]??[]
        for(const p of Array.isArray(installed)?installed:[installed])if(p.installPath){const definition=json(join(p.installPath,'.claude-plugin/plugin.json'));rows.push({key:entry.key,adapter:entry.adapter,installed:true,version:definition.version??p.version,gitCommitSha:p.gitCommitSha,sourceSha:p.gitCommitSha,contentHash:entry.contentHash?contentHash(p.installPath):undefined})}
      }catch{}
    } else {
      const root=join(companyHome,'plugins/cache',marketplace,name,entry.version??entry.catalogVersion??'')
      try {
        const manifest=json(join(root,'.codex-plugin/plugin.json'))
        rows.push({key:entry.key,adapter:entry.adapter,installed:true,version:manifest.version,sourceId:manifest.sourceId??manifest.source_id})
      }catch{}
      const catalog=contract.skills.codexPlugins.marketplaces[marketplace]
      const snapshotPath=(catalog?.manifest??catalog?.catalogCache)?.replace(/^~/,homedir())
      try {
        const snapshot=cached(snapshotPath)
        for(const p of snapshot.plugins??[])if(p.name===name){
          if(catalog.kind==='remote')rows.push({key:entry.key,adapter:entry.adapter,available:true,version:p.release?.version,sourceId:p.id,authenticated:false})
          else if(p.source?.source==='local'){
            const pluginRoot=resolve(dirname(snapshotPath),'../..',p.source.path),manifest=json(join(pluginRoot,'.codex-plugin/plugin.json'))
            rows.push({key:entry.key,adapter:entry.adapter,available:true,version:manifest.version})
          }
        }
      }catch{}
    }
  }
  return rows
}

// Grant reports never hash plugin payloads or consult marketplace/auth files.
// Refuse symlinked metadata (including parent directories), and keep only the
// metadata fields used by the report. The provisioning reader above is unchanged.
export function metadataReadable(host,path) {
  for(let p=resolve(path);;p=dirname(p)){
    if(host.isSymlink(p))return false
    if(dirname(p)===p)return true
  }
}
export function readClaudePluginRecords(host,userHome=homedir()) {
  const path=join(userHome,'.claude/plugins/installed_plugins.json')
  const data=metadataReadable(host,path)?host.readJson(path):null
  const records=[]
  for(const [key,value]of Object.entries(data?.plugins??{}))for(const p of Array.isArray(value)?value:[value]){
    if(!p || typeof p!=='object')continue
    records.push({key,adapter:'claude_local',installPath:p.installPath,version:p.version,contentHash:p.contentHash,gitCommitSha:p.gitCommitSha,sourceSha:p.gitCommitSha,installedAt:p.installedAt,scope:p.scope,projectPath:p.projectPath})
  }
  return {path,available:!!data?.plugins,records}
}
function readInstalledMetadata(companyHome,host,userHome) {
  requireThat(host,'Metadata inventory requires a read-only host')
  const rows=[],base=join(userHome,'.claude/plugins/cache')
  const dirs=p=>metadataReadable(host,p)?host.entries(p).filter(n=>n!=='.'&&n!=='..'&&!n.includes('/')&&host.isDirectory(join(p,n))&&metadataReadable(host,join(p,n))).sort():[]
  for(const row of readClaudePluginRecords(host,userHome).records){
    const path=typeof row.installPath==='string'?resolve(row.installPath):''
    const readable=path.startsWith(base+'/') && metadataReadable(host,path)
    const manifestPath=join(path,'.claude-plugin/plugin.json')
    const manifest=readable && metadataReadable(host,manifestPath)?host.readJson(manifestPath):null
    rows.push({...row,installed:!!(readable && host.isDirectory(path)),version:manifest?.version??row.version,contentHash:row.contentHash??manifest?.contentHash,mtime:readable?host.mtime(path):null})
  }
  // Retained cache directories are observable too, but do not substitute for
  // Claude's installed index when checking whether an enabled key is installed.
  for(const marketplace of dirs(base))for(const name of dirs(join(base,marketplace)))for(const version of dirs(join(base,marketplace,name))){
    const path=join(base,marketplace,name,version)
    if(!rows.some(r=>r.installPath===path))rows.push({key:`${name}@${marketplace}`,adapter:'claude_local',installed:false,retained:true,installPath:path,cacheVersion:version,mtime:host.mtime(path)})
  }
  const cache=join(companyHome,'plugins/cache')
  for(const marketplace of dirs(cache))for(const name of dirs(join(cache,marketplace)))for(const version of dirs(join(cache,marketplace,name))){
    const path=join(cache,marketplace,name,version),manifestPath=join(path,'.codex-plugin/plugin.json')
    const manifest=metadataReadable(host,manifestPath)?host.readJson(manifestPath):null
    rows.push({key:`${name}@${marketplace}`,adapter:'codex_local',installed:true,installPath:path,cacheVersion:version,version:manifest?.version,sourceId:manifest?.sourceId??manifest?.source_id,contentHash:manifest?.contentHash,installedAt:manifest?.installedAt,mtime:host.mtime(path)})
  }
  return rows
}
export async function executePluginOperations(operations,{readInventory,emit,run=execFileSync}={}) {
  for(const op of operations) {
    requireThat(op.kind==='install-pinned-plugin' && op.entry.pinned===true,'Unpinned entries are never installed')
    emit({write:op})
    // stdout/stderr are captured and withheld: runtime managers may print
    // authentication prompts. Never invoke an OAuth/login command or a model.
    try{run(op.command,op.args,{env:{PATH:process.env.PATH,HOME:homedir(),USER:process.env.USER,TMPDIR:process.env.TMPDIR,...op.env},stdio:['ignore','pipe','pipe'],timeout:120000})}
    catch{throw new Error(`Plugin install failed for ${op.entry.key}; stopped without retry; inspect the runtime manager by hand`)}
    requireThat(readInventory().some(row=>row.installed&&pluginReadbackMatches(op.entry,row)),`Plugin pin readback failed for ${op.entry.key}; stopped without retry`)
  }
}
