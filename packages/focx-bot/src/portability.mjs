import { requireThat, slugOf,assertInvariants } from './invariants.mjs'
import { approvalDigest } from './digest.mjs'
import { bundleExtension, yaml, overlayAgent, INCLUDE, secretInputs } from './bundle.mjs'
import { fresh } from './fresh.mjs'
import { readSnapshot } from './api.mjs'

export function overlayRestore(contract,bundle) {
  const result=structuredClone(bundle),{key,extension}=bundleExtension(result)
  requireThat(JSON.stringify(Object.keys(extension.agents??{}).sort())===JSON.stringify(contract.agents.map(a=>a.slug).sort()), 'Restore bundle must have the exact contract slug set')
  for (const a of contract.agents) {
    const entry=extension.agents[a.slug]
    requireThat(entry.adapter?.type===a.adapterType, `${a.slug}: restore cannot migrate adapters`)
    const safe=overlayAgent(a,{adapterConfig:entry.adapter.config,runtimeConfig:entry.runtime})
    entry.adapter.config=safe.adapterConfig
    entry.runtime=safe.runtimeConfig
    entry.permissions=safe.permissions
    // An export can also carry explicit grants. Paused import's creation grant
    // is still revoked by step 2, regardless of this bundle representation.
    entry.permissionGrants=(entry.permissionGrants??[]).filter(g=>g.permissionKey!=='tasks:assign')
    if (result.manifest?.agents) {
      const manifest=result.manifest.agents.find(b=>b.slug===a.slug)
      requireThat(manifest, 'Export manifest and files disagree on agent identity')
      Object.assign(manifest,safe,{permissionGrants:entry.permissionGrants})
    }
  }
  result.files[key]=yaml(extension)
  return result
}
export function prunedFalseKeys(live,bundle) {
  const {extension}=bundleExtension(bundle),pruned=[]
  const walk=(value,exported,path)=>{
    if (value===false && exported!==false) pruned.push(path)
    if (value && typeof value==='object') for(const [key,v] of Object.entries(value)) walk(v,exported?.[key],`${path}.${key}`)
  }
  for (const a of live.agents) {
    const slug=slugOf(a),entry=extension.agents?.[slug]??{}
    walk(a.adapterConfig,entry.adapter?.config,`agents.${slug}.adapter.config`)
    walk(a.runtimeConfig,entry.runtime,`agents.${slug}.runtime`)
    walk(a.permissions,entry.permissions,`agents.${slug}.permissions`)
  }
  return pruned.sort()
}
export async function snapshot(api,source,options={}) {
  const {companyId,apply=false,emit=()=>{},io,hostRecord={}}=options
  requireThat(companyId, 'snapshot requires the company id output by provisioning')
  const operation={method:'POST',path:`/api/companies/${companyId}/export`,body:{include:INCLUDE}}
  const operations=[operation,{method:'WRITE_SNAPSHOT',path:options.outputPath??'<required output path>'}]
  const digest=approvalDigest(operations,{baseUrl:api.baseUrl,companyId},source.sha)
  emit({digest,changes:operations})
  if(!apply) return {digest,changes:operations}
  requireThat(options.approvedDigest===digest && io && options.outputPath, 'snapshot needs approved digest and an explicit local output path')
  const live=await readSnapshot(api,companyId)
  emit({write:operation})
  const bundle=await api.request(operation.method,operation.path,operation.body)
  const fidelity=await api.request('GET',`/api/companies/${companyId}/export/fidelity`)
  const record={contractSha:source.sha,bundle,fidelity,prunedFalseKeys:prunedFalseKeys(live,bundle),host:hostRecord,secretInputs:secretInputs(bundle),prerequisite:'Ryan must enter secret values by hand and run codex login before an authorized Codex run; secrets are rebound using secrets/catalog only.'}
  emit({write:{method:'WRITE_SNAPSHOT',path:options.outputPath}})
  await io.writeSnapshot(options.outputPath,record)
  emit({fidelity,prunedFalseKeys:record.prunedFalseKeys,secretInputs:record.secretInputs})
  return record
}
export async function restore(api,source,record,options={}) {
  requireThat(typeof options.target?.newCompanyName==='string' && options.target.newCompanyName.trim().length>0, 'restore requires an explicit unique target.newCompanyName')
  requireThat(record?.bundle?.files && record.fidelity && Array.isArray(record.prunedFalseKeys), 'restore requires the native bundle with fidelity and pruned-key sidecars')
  const bundle=overlayRestore(source.contract,record.bundle)
  const original=bundleExtension(record.bundle).extension.agents
  return fresh(api,source,{...options,bundle,validateImportedState:live=>{
    const previous={agents:live.agents.map(a=>({id:a.id,adapterConfig:original[slugOf(a)]?.adapter?.config??{},runtimeConfig:original[slugOf(a)]?.runtime??{}}))}
    assertInvariants(source.contract,{...live,previous},[7,8])
  }})
}
const xml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const plistValue = v => {
  if (typeof v==='boolean') return v?'<true/>':'<false/>'
  if (typeof v==='number') return `<integer>${v}</integer>`
  if (typeof v==='string') return `<string>${xml(v)}</string>`
  if (Array.isArray(v)) return `<array>${v.map(plistValue).join('')}</array>`
  return `<dict>${Object.entries(v).map(([k,v])=>`<key>${xml(k)}</key>${plistValue(v)}`).join('')}</dict>`
}
export function renderHost(contract) {
  const plists={}
  for (const definition of [contract.service.paperclip.launchd,contract.network.daemon.launchd]) {
    const args=definition.programArguments.map(v=>typeof v==='object'?'[REDACTED SECRET PATH]':v)
    const value={Label:definition.label,ProgramArguments:args,EnvironmentVariables:definition.env,StandardOutPath:definition.logs.stdout,StandardErrorPath:definition.logs.stderr,RunAtLoad:definition.runAtLoad,KeepAlive:definition.keepAlive,ThrottleInterval:definition.throttleInterval,...(definition.exitTimeOut?{ExitTimeOut:definition.exitTimeOut}:{})}
    plists[`${definition.label}.plist`]=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${plistValue(value)}</plist>\n`
  }
  return {plists,database:contract.database,network:{provider:contract.network.provider,managed:contract.network.managed,hostname:contract.network.hostname},pins:contract.skills,installServices:false,credentialValues:false}
}
