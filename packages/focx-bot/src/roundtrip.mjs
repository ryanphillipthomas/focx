import { isDeepStrictEqual as same } from 'node:util'
import { requireThat, slugOf, assertInvariants } from './invariants.mjs'
import { bundleExtension, parseMarkdown, composeEnv, RESERVED_SKILL_PREFIX } from './bundle.mjs'
import { renderSkillHomes } from './skills.mjs'

export const projectSummary = projects => projects.map(p=>({slug:slugOf(p),workspaces:(p.workspaces??[]).map(w=>({name:w.name,repoUrl:w.repoUrl,isPrimary:w.isPrimary===true})).sort((a,b)=>a.name.localeCompare(b.name))})).sort((a,b)=>a.slug.localeCompare(b.slug))
export function portableProjects(contract,bundle,sourceProjects) {
  const {extension}=bundleExtension(bundle)
  requireThat(Array.isArray(bundle.warnings) && bundle.warnings.every(w=>typeof w==='string'), 'Export warnings must be recorded verbatim')
  requireThat(!bundle.warnings.some(w=>/workspace.*omitted from export/i.test(w)), 'Export omitted a workspace; refuse snapshot/restore without fabricating it')
  const projects=Object.entries(bundle.files).filter(([p])=>/^projects\/[^/]+\/PROJECT.md$/.test(p)).map(([path,text])=>{
    const doc=parseMarkdown(text),slug=doc.meta.slug??slugOf(doc.meta),ext=extension.projects?.[slug],ws=ext?.workspaces
    requireThat(ws && typeof ws==='object' && !Array.isArray(ws) && Object.keys(ws).length>0, 'Export omitted a workspace or its keyed workspace object')
    return {id:path,companyId:'portable',name:doc.meta.name,urlKey:slug,workspaces:Object.entries(ws).map(([key,w])=>({ ...w,id:key }))}
  })
  assertInvariants(contract,{company:{id:'portable'},projects},[9])
  const summary=projectSummary(projects)
  if(sourceProjects) requireThat(same(summary,sourceProjects), 'Export omitted or changed a source project workspace; refuse snapshot/restore')
  if(bundle.manifest?.projects) requireThat(same(summary,projectSummary(bundle.manifest.projects.map(p=>({...p,urlKey:p.slug})))), 'Project manifest and files disagree on workspaces')
  return summary
}
// Compare configuration, excluding only generated identity/managed instruction
// locations and separately reported secret bindings/derived Claude directories.
// Keep false values: dropping them here would hide the P25 safety loss.
export const comparisonExclusions = ['generated ids','managed instruction locations','secret env bindings (expected unbound)','CLAUDE_CONFIG_DIR and CLAUDE_CODE_PLUGIN_CACHE_DIR (rendered separately)']
export function agentConfigs(contract,live) {
  return Object.fromEntries(live.agents.map(a=>{
    const config=structuredClone(a.adapterConfig??{}),definition=contract.agents.find(b=>b.slug===slugOf(a))
    for(const key of ['instructionsFilePath','instructionsRootPath','instructionsBundleMode','instructionsEntryFile'])delete config[key]
    const secrets=new Set(Object.entries(composeEnv(contract,definition)).filter(([,v])=>typeof v==='object').map(([k])=>k))
    config.env=Object.fromEntries(Object.entries(config.env??{}).filter(([key,v])=>!secrets.has(key) && v?.type!=='secret_ref' && !['CLAUDE_CONFIG_DIR','CLAUDE_CODE_PLUGIN_CACHE_DIR'].includes(key)).map(([key,v])=>[key,v?.type==='plain'?v.value:v]))
    return [slugOf(a),{adapterConfig:config,runtimeConfig:structuredClone(a.runtimeConfig??{})}]
  }))
}
export function configDiff(before,after,path='') {
  if(same(before,after))return []
  if(before && after && typeof before==='object' && typeof after==='object' && !Array.isArray(before) && !Array.isArray(after))return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().flatMap(k=>configDiff(before[k],after[k],path?path+'.'+k:k))
  return [{path,before:before??null,after:after??null}]
}
export function renderedClaude(contract,root,companyId,ids) {
  const homes=renderSkillHomes(contract,root,companyId,ids)
  return Object.fromEntries(contract.agents.filter(a=>a.adapterType==='claude_local').map(a=>{
    const directory=homes.agentEnv[a.slug].CLAUDE_CONFIG_DIR
    return [a.slug,{directory,files:Object.fromEntries(Object.entries(homes.files).filter(([p])=>p.startsWith(directory+'/')).map(([p,v])=>[p.slice(directory.length+1),v]))}]
  }))
}
export function compareRoundTrip(contract,record,live,root) {
  const actual=agentConfigs(contract,live),rendered=renderedClaude(contract,root,live.company.id,Object.fromEntries(live.agents.map(a=>[slugOf(a),a.id])))
  const agents=Object.fromEntries(contract.agents.map(a=>[a.slug,{
    adapterConfig:configDiff(record.source.agents[a.slug]?.adapterConfig,actual[a.slug]?.adapterConfig),
    runtimeConfig:configDiff(record.source.agents[a.slug]?.runtimeConfig,actual[a.slug]?.runtimeConfig),
  }]))
  const claudeConfigDirs=Object.fromEntries(Object.entries(rendered).map(([slug,r])=>[slug,{source:record.source.claudeConfigDirs[slug],restored:r,diff:configDiff(record.source.claudeConfigDirs[slug]?.files,r.files)}]))
  const projects=configDiff(record.projects,projectSummary(live.projects))
  const differences=[...projects.map(d=>({kind:'projects',...d})),...Object.entries(agents).flatMap(([slug,configs])=>Object.entries(configs).flatMap(([kind,rows])=>rows.map(d=>({slug,kind,...d})))),...Object.entries(claudeConfigDirs).flatMap(([slug,r])=>r.diff.map(d=>({slug,kind:'renderedClaudeConfig',...d})))]
  return {fidelity:record.fidelity,prunedFalseKeys:record.prunedFalseKeys,exportWarnings:record.exportWarnings,exclusions:comparisonExclusions,projects,agents,claudeConfigDirs,differences}
}

// Read back the registry selection after verification, independently of adapter
// config parity. Package provenance is evidenced by the exact submitted files.
export function assertRestoredSkills(contract,live,bundle) {
  assertInvariants(contract,live,[5])
  requireThat(!Object.keys(bundle.files).some(p=>p.startsWith('skills/'+RESERVED_SKILL_PREFIX)) && !(bundle.manifest?.skills??[]).some(s=>s.key?.startsWith(RESERVED_SKILL_PREFIX)), 'Reserved Paperclip skill files must not be imported from the package')
}
