import { requireThat, slugOf } from './invariants.mjs'

export const list = (x,key) => {
  const rows=Array.isArray(x)?x:x?.[key]??x?.data
  requireThat(Array.isArray(rows) && !x?.nextCursor && !x?.hasMore, 'Incomplete API list response')
  return rows
}
export class Client {
  constructor(baseUrl, token, transport=fetch) {
    const url=new URL(baseUrl)
    requireThat(['http:','https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, 'Expected an HTTP base URL without credentials, query or fragment')
    this.baseUrl=baseUrl.replace(/\/$/,'');this.token=token;this.transport=transport
  }
  async request(method,path,body) {
    requireThat(path.startsWith('/api/') && !path.includes('://'), 'Invalid API path')
    requireThat(!/\/secrets(?:\/|$)/.test(path) || (method==='GET' && path.endsWith('/secrets/catalog')), 'Only the value-free secrets catalog may be read')
    requireThat(!JSON.stringify(body??{}).includes('"secretValues"'), 'secretValues is never supported')
    const response=await this.transport(this.baseUrl+path,{method,redirect:'error',headers:{'content-type':'application/json',...(this.token?{authorization:`Bearer ${this.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
    // Never echo an error response: upstream may include credentials in it.
    requireThat(response.ok, `Paperclip ${method} ${path} returned HTTP ${response.status}; no retry`)
    return response.status===204?null:response.json()
  }
}
export async function readSnapshot(api, companyId) {
  const company=await api.request('GET',`/api/companies/${companyId}`)
  requireThat(company?.id===companyId, 'Company readback mismatch')
  const agents=[]
  for (const row of list(await api.request('GET',`/api/companies/${companyId}/agents`),'agents')) {
    const config=await api.request('GET',`/api/agents/${row.id}/configuration`)
    for(const [key,value] of Object.entries(config?.adapterConfig?.env??{}))requireThat(!/(TOKEN|PASSWORD|API_KEY|SECRET)/i.test(key) || value?.type==='secret_ref', 'Credential env values must be secret refs; refusing to render a live plain value')
    const detail=await api.request('GET',`/api/agents/${row.id}`)
    requireThat(config?.id===row.id && config.companyId===companyId, 'Incomplete configuration response')
    const bundle=await api.request('GET',`/api/agents/${row.id}/instructions-bundle`)
    requireThat(Array.isArray(bundle?.files), 'Incomplete instruction-bundle response')
    const files={}
    for (const f of bundle.files) {
      requireThat(typeof f.path==='string' && !Object.hasOwn(files,f.path), 'Invalid or duplicate instruction file')
      const file=await api.request('GET',`/api/agents/${row.id}/instructions-bundle/file?path=${encodeURIComponent(f.path)}`)
      requireThat(file.path===f.path && typeof file.content==='string', 'Incomplete instruction file response')
      files[f.path]=file.content
    }
    const skills=await api.request('GET',`/api/agents/${row.id}/skills`)
    requireThat(Array.isArray(skills?.desiredSkills), 'Incomplete skills response')
    requireThat(typeof detail?.access?.canAssignTasks==='boolean' && typeof detail.access.taskAssignSource==='string', 'Effective access readback missing')
    agents.push({...config,urlKey:row.urlKey??detail.urlKey,files,entryFile:bundle.entryFile,legacyPromptTemplateActive:bundle.legacyPromptTemplateActive,legacyBootstrapPromptTemplateActive:bundle.legacyBootstrapPromptTemplateActive,desiredSkills:skills.desiredSkills,access:detail.access})
  }
  const triggers=[]
  for (const r of list(await api.request('GET',`/api/companies/${companyId}/routines`),'routines')) {
    const detail=await api.request('GET',`/api/routines/${r.id}`)
    const rows=detail.triggers??detail.routine?.triggers
    requireThat(Array.isArray(rows), 'Incomplete schedule response')
    triggers.push(...rows.map(t=>({...t,routineId:r.id})))
  }
  const secretCatalog=list(await api.request('GET',`/api/companies/${companyId}/secrets/catalog`),'secrets').map(({id,name})=>({id,name}))
  return {company,agents,triggers,secretCatalog}
}
export async function models(api, companyId, contract) {
  const reports=[]
  for (const [adapter,definition] of Object.entries(contract.adapters)) {
    const rows=list(await api.request('GET',`/api/companies/${companyId}/adapters/${adapter}/models`),'models')
    for (const a of contract.agents.filter(a=>a.adapterType===adapter)) reports.push({slug:a.slug,adapter,model:a.model,present:rows.some(m=>m.id===a.model),reasoningKey:definition.reasoningKey})
  }
  return reports
}
export const idMap = live => Object.fromEntries(live.agents.map(a=>[slugOf(a),a.id]))
