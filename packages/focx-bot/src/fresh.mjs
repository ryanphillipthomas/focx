import { isDeepStrictEqual as same } from 'node:util'
import { requireThat, assertInvariants, accessReport, slugOf, projectReport } from './invariants.mjs'
import { hash, approvalDigest } from './digest.mjs'
import { renderFreshBundle, importOperation, secretInputs, composeEnv } from './bundle.mjs'
import { list, models, readSnapshot, idMap } from './api.mjs'
import { renderSkillHomes } from './skills.mjs'

export const expectedSkillWarning = slug => `Agent ${slug} references skill paperclipai/paperclip/paperclip, but that skill is not present in the package.`
export function resolveEnv(env, catalog) {
  const result={}
  for (const [key,value] of Object.entries(env)) {
    if (value && typeof value==='object') {
      const matches=catalog.filter(s=>s.name===value.secret)
      requireThat(matches.length===1 && typeof matches[0].id==='string', `env ${key}: secret name ${value.secret} must resolve uniquely; no write`)
      result[key]={type:'secret_ref',secretId:matches[0].id}
    } else result[key]={type:'plain',value:String(value)}
  }
  return result
}
export function secretLinkFindings(contract, live) {
  return contract.agents.flatMap(a=>{
    const actual=live.agents.find(b=>slugOf(b)===a.slug)?.adapterConfig?.env??{}
    return Object.entries(composeEnv(contract,a)).filter(([,v])=>typeof v==='object').flatMap(([key,v])=>{
      const ref=actual[key],matches=live.secretCatalog.filter(s=>s.name===v.secret)
      return matches.length===1 && ref?.type==='secret_ref' && ref.secretId===matches[0].id ? [] : [`${a.slug}: unresolved env ${key} (${v.secret})`]
    }).concat(Object.entries(actual).filter(([,v])=>v?.type==='secret_ref' && !live.secretCatalog.some(s=>s.id===v.secretId)).map(([key])=>`${a.slug}: dangling env ref ${key}`))
  })
}
export const permissionsDone = live => live.agents.every(a=>a.permissions.canCreateAgents===false && a.permissions.canCreateSkills===false && a.access.taskAssignSource!=='explicit_grant' && !a.access.grants?.some(g=>g.permissionKey==='tasks:assign'))
export function freshPlan(source, target, bundle=renderFreshBundle(source.contract,source.files)) {
  const operations=[importOperation(bundle,target),...source.contract.agents.map(a=>({method:'PATCH',path:`/api/agents/<id:${a.slug}>/permissions`,body:a.permissions}))]
  return {operations,bundle,secretInputs:secretInputs(bundle),later:source.contract.agents.map(a=>({method:'PATCH',path:`/api/agents/<id:${a.slug}>`,body:{adapterConfig:{env:composeEnv(source.contract,a)}},resolution:'bind-secrets resolves names from secrets/catalog after hand entry; merge only'}))}
}
export async function preflightFresh(api, source, options, plan) {
  requireThat(options.target?.mode==='new_company' && !options.target.companyId, 'fresh/restore requires a new company target')
  requireThat(plan.operations[0].body.pauseAutomations===true, 'Import must create agents paused')
  requireThat(!Object.hasOwn(plan.operations[0].body,'secretValues'), 'Import may never supply secretValues')
  requireThat(plan.operations[0].body.source.expectedFileCount===Object.keys(plan.bundle.files).length, 'Inline source file count mismatch')
  const who=await api.request('GET','/api/cli-auth/me')
  requireThat(who?.isInstanceAdmin===true, 'new_company requires an instance-admin board token')
  const companies=list(await api.request('GET','/api/companies'),'companies')
  const name=options.target.newCompanyName??source.contract.company.name
  requireThat(typeof name==='string' && name.trim()===name && name.length>0 && !companies.some(c=>c.name.trim().toLowerCase()===name.toLowerCase()), 'Explicit target company name must be unique; no suffix/adoption')
  requireThat(typeof options.catalogCompanyId==='string' && options.catalogCompanyId.length>0, 'Read-only catalog company id is required before new-company creation')
  const catalog=await models(api,options.catalogCompanyId,source.contract)
  requireThat(catalog.every(m=>m.present), 'Contract model missing from Paperclip adapter catalog')
  return {who:{isInstanceAdmin:who.isInstanceAdmin},companies:companies.map(c=>({id:c.id,name:c.name})),catalog}
}
const announce = (emit,operation) => emit({write:operation})
function stateWriter(io,emit,state) {
  let failed=false
  return async()=>{
    if(failed)return
    announce(emit,{method:'WRITE_STATE',path:io.statePath,body:state})
    try{await io.save(state)}catch(error){failed=true;throw new Error(`Local state persistence failed; no retry: ${error.message}`)}
  }
}
const describeFailure = (step,error,state) => {
  const unmet=step===1?'import completeness, identity or imported configuration checks':step===2?'permissions revocation / invariant 8':step===3?'secret-link check / invariant 8':step==='restore-comparison'?'restore configuration parity / invariants 1–9':'preflight or host declaration checks'
  const failure=new Error(`STOP step ${step}; unmet: ${unmet}; job id: ${state.jobId??'none returned'}; company id: ${state.companyId??'unknown'}; created ids: ${JSON.stringify(state.ids??{})}; ${error.message}; never retry automatically`)
  failure.step=step;failure.state=structuredClone(state);failure.unmet=unmet
  return failure
}
export async function fresh(api, source, options={}) {
  const {apply=false,emit=()=>{},io}=options
  const target=options.target??{mode:'new_company'}
  const plan=freshPlan(source,target,options.bundle)
  const templateHomes=options.instanceRoot?renderSkillHomes(source.contract,options.instanceRoot,'<created-company-id>',Object.fromEntries(source.contract.agents.map(a=>[a.slug,`<id:${a.slug}>`]))):null
  const hostOperations=templateHomes?Object.entries(templateHomes.files).map(([path,body])=>({method:'WRITE_FILE',path,body})):[]
  const boundTarget={baseUrl:api.baseUrl,companyId:null}
  const digest=approvalDigest([...plan.operations,...hostOperations,{method:'WRITE_STATE',path:io?.statePath??'<instance-local-state>'}],boundTarget,source.sha)
  emit({digest,changes:[...plan.operations,...hostOperations],later:plan.later,secretInputs:plan.secretInputs,window:'Import grants tasks:assign until step 2; agents are born paused with all wake paths closed.'})
  const preflight=await preflightFresh(api,source,{...options,target},plan)
  if (!apply) return {digest,changes:plan.operations,secretInputs:plan.secretInputs,preflight}
  requireThat(options.approvedDigest===digest, 'Preview changed or not approved; obtain a fresh digest')
  requireThat(io, 'Instance-local state and single-writer lock are required')
  announce(emit,{method:'LOCK',path:io.lockPath})
  const release=await io.acquire()
  if (await io.readState()) { await release(); throw new Error('Prior state exists; partial imports must be reviewed, never retried or adopted') }
  const state={phase:'preflight',step:0,jobId:null,companyId:null,ids:{},digest,contractSha:source.sha,baseUrl:api.baseUrl,expectedName:target.newCompanyName??source.contract.company.name}
  const save=stateWriter(io,emit,state)
  let step=0
  try {
    const checked=await preflightFresh(api,source,{...options,target},plan)
    requireThat(hash(checked)===hash(preflight), 'Preflight state changed; no import made')
    const previewOp={method:'POST',path:'/api/companies/import/preview',body:{source:plan.operations[0].body.source,include:plan.operations[0].body.include,target}}
    emit({readOnlyPreview:previewOp})
    const preview=await api.request(previewOp.method,previewOp.path,previewOp.body)
    requireThat(Array.isArray(preview?.errors) && preview.errors.length===0, 'Native import preview errors')
    requireThat(Array.isArray(preview.warnings) && preview.warnings.every(w=>source.contract.agents.some(a=>w===expectedSkillWarning(a.slug))), 'Unexpected native import preview warning; review required')
    emit({expectedPreviewWarnings:preview.warnings})
    // Persist the intent before submitting: even a lost HTTP response must not
    // make the same state path available for a second import.
    step=1;state.step=1;state.phase='import-submitted'
    await save()
    const op=plan.operations[0];announce(emit,op)
    const result=await api.request(op.method,op.path,op.body)
    // Async results are deliberately left for read-only observation, never
    // resubmitted. The job id/status URL survive in the local failure record.
    state.jobId=result?.jobId??result?.job?.id??null
    state.statusUrl=result?.statusUrl??null
    state.companyId=result?.company?.id??null
    state.ids=Object.fromEntries((result?.agents??[]).filter(a=>a.id).map(a=>[a.slug,a.id]))
    await save()
    requireThat(state.companyId, 'Import has no completed company result; observe the job separately')
    let live=await readSnapshot(api,state.companyId)
    state.ids=idMap(live);state.company=live.company;state.projects=projectReport(live)
    options.validateImportedState?.(live)
    requireThat(live.company.name===state.expectedName, 'Imported company name mismatch')
    const effectiveContract={...source.contract,company:{name:state.expectedName}}
    assertInvariants(effectiveContract,live)
    requireThat(same(Object.keys(state.ids).sort(),source.contract.agents.map(a=>a.slug).sort()), 'Readback slug-to-id map mismatch')
    step=2;state.step=2;state.phase='permissions'
    for (const a of source.contract.agents) {
      assertInvariants(effectiveContract,await readSnapshot(api,state.companyId))
      const permissionOp={method:'PATCH',path:`/api/agents/${state.ids[a.slug]}/permissions`,body:a.permissions}
      announce(emit,permissionOp);await api.request(permissionOp.method,permissionOp.path,permissionOp.body)
    }
    live=await readSnapshot(api,state.companyId)
    assertInvariants(effectiveContract,live)
    requireThat(permissionsDone(live), 'Step 2 did not revoke the explicit tasks:assign grant')
    if(options.instanceRoot){
      step='host-declarations'
      const homes=renderSkillHomes(source.contract,options.instanceRoot,state.companyId,state.ids)
      requireThat(io.writeFiles,'Host config materialization is required')
      await io.writeFiles(homes.files,emit)
      state.agentEnv=homes.agentEnv
    }
    state.phase=plan.secretInputs.length?'awaiting-secret-entry':'configured';state.step=3
    state.secretInputs=plan.secretInputs
    if(options.finishState)step='restore-comparison'
    const completion=await options.finishState?.(live,state)
    await save()
    emit({access:accessReport(live),status:state.phase,secretInputs:plan.secretInputs,prerequisite:'Ryan enters secret values by hand, then uses bind-secrets. Ryan must run codex login before the first Codex run.'})
    return {digest,state,access:accessReport(live),complete:!plan.secretInputs.length,...completion}
  } catch (error) {
    // A failed import may have created rows before losing its HTTP response.
    // Read only: identify new rows by the unique requested name; never adopt,
    // alter or retry them. Preserve the original failure if observation fails.
    if(step===1 && !state.companyId)try{
      const before=new Set(preflight.companies.map(c=>c.id))
      const candidates=list(await api.request('GET','/api/companies'),'companies').filter(c=>!before.has(c.id)&&c.name===state.expectedName)
      if(candidates.length===1){state.companyId=candidates[0].id;const rows=list(await api.request('GET',`/api/companies/${state.companyId}/agents`),'agents');state.ids=Object.fromEntries(rows.map(a=>[slugOf(a),a.id]))}
    }catch{}
    state.phase='failed';state.failedStep=step
    try{await save()}catch(persistenceError){emit({statePersistenceError:persistenceError.message})}
    emit({failure:{step,jobId:state.jobId,companyId:state.companyId,createdIds:state.ids}})
    throw describeFailure(step,error,state)
  } finally { announce(emit,{method:'UNLOCK',path:io.lockPath});await release() }
}
export async function bindSecrets(api, source, options={}) {
  const {io,apply=false,emit=()=>{}}=options
  requireThat(io, 'bind-secrets requires the instance-local import state')
  const state=await io.readState()
  const save=stateWriter(io,emit,state)
  requireThat(['awaiting-secret-entry','awaiting-plugin-auth'].includes(state?.phase) && state.contractSha===source.sha && state.baseUrl===api.baseUrl, 'Secret binding requires matching awaiting-secret-entry or awaiting-plugin-auth state; failed jobs are not retried')
  const contract={...source.contract,company:{name:state.expectedName}}
  const live=await readSnapshot(api,state.companyId)
  assertInvariants(contract,live)
  requireThat(permissionsDone(live), 'Step 2 permissions revocation is incomplete')
  requireThat(same(idMap(live),state.ids), 'Persisted generated ids differ from readback')
  const operations=contract.agents.map(a=>({method:'PATCH',path:`/api/agents/${state.ids[a.slug]}`,body:{adapterConfig:{env:resolveEnv({...composeEnv(contract,a),...(state.agentEnv?.[a.slug]??{}),...(options.agentEnv?.[a.slug]??{})},live.secretCatalog)}}}))
  const allOperations=[...operations,...(options.pluginOperations??[])]
  const digest=approvalDigest(allOperations,{baseUrl:api.baseUrl,companyId:state.companyId},source.sha)
  emit({digest,changes:allOperations})
  if (!apply) return {digest,changes:allOperations}
  requireThat(options.approvedDigest===digest, 'Secret binding digest is missing or stale')
  announce(emit,{method:'LOCK',path:io.lockPath});const release=await io.acquire()
  let failedStep=3
  try {
    requireThat(same(await io.readState(),state), 'Import state changed before binding')
    requireThat(hash(await readSnapshot(api,state.companyId))===hash(live), 'Live state changed before binding')
    for (const op of operations) {
      assertInvariants(contract,await readSnapshot(api,state.companyId))
      requireThat(!('replaceAdapterConfig' in op.body), 'Secret env must merge into the adapter config')
      announce(emit,op);await api.request(op.method,op.path,op.body)
      assertInvariants(contract,await readSnapshot(api,state.companyId),[8])
    }
    const after=await readSnapshot(api,state.companyId)
    assertInvariants(contract,{...after,previous:live})
    requireThat(secretLinkFindings(contract,after).length===0, 'Post-binding secret-link check failed')
    let plugins={needsAuth:[]}
    if(options.provisionPlugins){
      try{plugins=await options.provisionPlugins()}
      catch{
        // Only this boundary follows a fully verified env stage. Never persist
        // exception text or runtime output: either can contain credentials.
        failedStep='host-plugins'
        state.pluginFailure={key:'host-plugins',message:'Host plugin provisioning failed; runtime output withheld; inspect the runtime manager by hand before resuming bind-secrets'}
        throw new Error(state.pluginFailure.message)
      }
      state.pluginAuth=plugins.needsAuth
    }
    const findings=plugins.findings??[]
    if(findings.length)state.pluginFindings=findings
    else delete state.pluginFindings
    delete state.pluginFailure;delete state.failedStep
    const complete=!plugins.needsAuth.length && !findings.length
    state.phase=complete?'configured':'awaiting-plugin-auth';state.step=3
    const missing=findings.filter(f=>f.status==='seeded-missing'),other=findings.filter(f=>f.status!=='seeded-missing')
    const pluginSummary=[]
    if(missing.length)pluginSummary.push(`${missing.length} pinned plugins are not seeded: ${missing.map(f=>f.key).join(', ')}`)
    if(other.length)pluginSummary.push(`${other.length} outstanding pinned plugin findings: ${other.map(f=>f.key).join(', ')}`)
    if(plugins.needsAuth.length)pluginSummary.push(`${plugins.needsAuth.length} apps require manual authentication: ${plugins.needsAuth.map(a=>`${a.name??a.appId} (${a.plugin}; ${a.appId})`).join(', ')}`)
    await save()
    const result={digest,complete,pluginSummary,plugins,access:accessReport(after)}
    emit(result)
    return result
  } catch(error) {
    state.phase=failedStep==='host-plugins'?'awaiting-plugin-auth':'failed';state.failedStep=failedStep
    try{await save()}catch(persistenceError){emit({statePersistenceError:persistenceError.message})}
    throw describeFailure(failedStep,error,state)
  } finally {announce(emit,{method:'UNLOCK',path:io.lockPath});await release()}
}
