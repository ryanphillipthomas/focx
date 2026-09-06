import { loadSource } from './src/contract.mjs'
import { createFakeApi, memoryIO } from './src/fake-api.mjs'
import { fresh, bindSecrets } from './src/fresh.mjs'
import { readSnapshot } from './src/api.mjs'

export const source=loadSource()
export const writes=api=>api.state.calls.filter(c=>c.method!=='GET' && c.path!=='/api/companies/import/preview')
export async function fixture({bound=true,instanceRoot,api=createFakeApi()}={}) {
  const io=memoryIO(),options={io,catalogCompanyId:'catalog-company',instanceRoot}
  const p=await fresh(api,source,options)
  const result=await fresh(api,source,{...options,apply:true,approvedDigest:p.digest})
  if(bound){
    api.state.secrets=source.contract.secrets.map((s,i)=>({id:`secret-${i}`,name:s.name,companyId:result.state.companyId}))
    const p=await bindSecrets(api,source,{io})
    await bindSecrets(api,source,{io,apply:true,approvedDigest:p.digest})
  }
  return {api,io,companyId:result.state.companyId,live:await readSnapshot(api,result.state.companyId)}
}
export function corruptInvariant(n,live) {
  const b=live.agents[0]
  if(n===1)live.agents.push({...b,id:'extra-id',name:'Unexpected agent',urlKey:'unexpected-agent'})
  if(n===2)b.status='idle'
  if(n===3)b.adapterType='claude_local'
  if(n===4)b.files['unexpected.md']='not in source'
  if(n===5)b.desiredSkills=[]
  if(n===6)live.triggers.push({kind:'schedule',enabled:true})
  if(n===7)b.runtimeConfig.heartbeat.wakeOnDemand=true
  if(n===8)b.adapterConfig.dangerouslyBypassApprovalsAndSandbox=true
  if(n===9)live.projects[0].workspaces=[]
  return live
}
