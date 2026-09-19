import { readFileSync, realpathSync } from 'node:fs'
import { resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual as same } from 'node:util'
import { requireThat, slugOf, instructionPaths } from './invariants.mjs'
import { sha256 } from './digest.mjs'
import { validateGrants } from './skills.mjs'
// One definition of the permission grammar, shared with the role validator.
// It lived in both files, and a fix applied to only one of them is how an MCP
// grant would pass role validation and then be rejected by the contract.
import { PERMISSION_RULE, MCP_RULE } from './roles.mjs'

export const PACKAGE=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export const ROOT=resolve(PACKAGE,'../..')
// A dependency-free evaluator for every keyword used by this package's draft-07
// schema. The workflow invokes this exact validation, not a parallel shape test.
export function validateSchema(value,schema,root=schema,path='$') {
  if (schema===true) return []
  if (schema===false) return [`${path}: forbidden`]
  if (schema.$ref) return validateSchema(value,schema.$ref.slice(2).split('/').reduce((s,k)=>s[k],root),root,path)
  if (schema.anyOf) return schema.anyOf.some(s=>!validateSchema(value,s,root,path).length)?[]:[`${path}: no anyOf variant matches`]
  const errors=[]
  const type=t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):t==='integer'?Number.isInteger(value):typeof value===t
  if (schema.type && !(Array.isArray(schema.type)?schema.type:[schema.type]).some(type)) return [`${path}: type mismatch`]
  if ('const' in schema && !same(value,schema.const)) errors.push(`${path}: const mismatch`)
  if (schema.enum && !schema.enum.some(v=>same(v,value))) errors.push(`${path}: enum mismatch`)
  if (typeof value==='number') {
    if (schema.minimum!==undefined && value<schema.minimum) errors.push(`${path}: below minimum`)
    if (schema.maximum!==undefined && value>schema.maximum) errors.push(`${path}: above maximum`)
  }
  if (typeof value==='string') {
    if (schema.minLength!==undefined && value.length<schema.minLength) errors.push(`${path}: too short`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern mismatch`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems!==undefined && value.length<schema.minItems || schema.maxItems!==undefined && value.length>schema.maxItems) errors.push(`${path}: array size mismatch`)
    if (schema.uniqueItems && value.some((v,i)=>value.slice(0,i).some(w=>same(v,w)))) errors.push(`${path}: duplicate array item`)
    value.forEach((v,i)=>errors.push(...validateSchema(v,schema.items??{},root,`${path}[${i}]`)))
  } else if (value && typeof value==='object') {
    for (const key of schema.required??[]) if (!Object.hasOwn(value,key)) errors.push(`${path}.${key}: required`)
    for (const [key,v] of Object.entries(value)) {
      const child=schema.properties?.[key]??schema.additionalProperties??{}
      errors.push(...validateSchema(v,child,root,`${path}.${key}`))
    }
  }
  return errors
}
export function validateContract(contract,schema) {
  const errors=validateSchema(contract,schema)
  requireThat(!errors.length,errors.join('\n'))
  requireThat(new Set(contract.agents.map(a=>a.slug)).size===contract.agents.length, 'Duplicate contract slug')
  requireThat(!('id' in contract.company) && contract.agents.every(a=>!('id' in a)), 'Company and agent ids are generated outputs')
  requireThat(!('id' in contract.project) && slugOf(contract.project), 'Project ids are generated outputs; name must have a url-key')
  requireThat(contract.project.workspaces.filter(w=>w.isPrimary===true).length===1, 'Project requires exactly one primary workspace')
  for (const w of contract.project.workspaces) {
    let url
    try { url=new URL(w.repoUrl) } catch { throw new Error('Project workspace requires an HTTPS repoUrl') }
    requireThat(url.protocol==='https:' && !url.username && !url.password && !url.search && !url.hash && w.repoUrl===url.href, 'Project repoUrl must be canonical HTTPS without credentials, query or fragment')
    requireThat(slugOf(w)===w.name && !['__proto__','constructor','prototype'].includes(w.name), 'Workspace name must be a safe url-key')
  }
  for (const a of contract.agents) {
    requireThat(slugOf(a)===a.slug, `${a.slug}: name must normalize to its slug`)
    requireThat(a.instructions===`.focx/roles/${a.roleKey}.md` && a.roleKey===a.slug, 'Isolated role source must match the slug')
    requireThat(a.skills.every(s=>/^focx-[a-z-]+$/.test(s)), 'Only scoped focx-* instruction procedures are allowed')
    requireThat(contract.adapters[a.adapterType]?.reasoningKey===(a.adapterType==='codex_local'?'modelReasoningEffort':'effort'), 'Wrong adapter reasoning key')
    if (a.adapterMigration) requireThat(a.adapterMigration.to===a.adapterType && a.adapterMigration.from!==a.adapterType, 'Migration evidence must describe the performed adapter change')
    if (a.adapterLocal) {
      requireThat(a.adapterType==='claude_local' && /^[a-z0-9]+(?:-[a-z0-9]+)*-worktree-local$/.test(a.adapterLocal.permissionDelivery ?? '') && same(a.adapterLocal.permissionsDeny,['Edit','NotebookEdit','Skill']), `${a.slug}: worktree launcher and deny triple must be preserved`)
      for (const rule of a.adapterLocal.permissionsAllow) {
        if (MCP_RULE.test(rule)) {
          // An MCP grant reaches off this machine. Exact tool only, and only on a
          // server carried by a plugin this agent is actually granted.
          requireThat(!rule.includes('*'), `${a.slug}: ${rule} must name one exact MCP tool`)
          const server=rule.split('__')[1]
          requireThat(a.grants.claudePlugins.some(k=>{const n=k.split('@')[0];return server===n||server.startsWith(`plugin_${n}_`)||server.endsWith(`_${n}`)}), `${a.slug}: ${rule} names an MCP server outside the canonical Claude grants`)
          continue
        }
        requireThat(PERMISSION_RULE.test(rule), 'Malformed Claude permission rule')
        requireThat(!['Bash','Write','Skill'].includes(rule.split('(')[0]) || rule.startsWith('Bash('), 'Blanket write/skill permissions are forbidden')
        requireThat(!rule.startsWith('Edit') || rule==='Edit(/pipeline/runs/**)', 'Edit permissions must remain scoped to evidence')
        if(rule.startsWith('Task('))requireThat(a.grants.claudePlugins.some(k=>k.split('@')[0]===rule.slice(5).split(':')[0]),'Task tooling must come from canonical Claude grants')
      }
    }
  }
  for (const group of Object.values(contract.env)) for (const [key,value] of Object.entries(group)) {
    if (value && typeof value==='object') requireThat(Object.keys(value).length===1 && typeof value.secret==='string' && contract.secrets.some(s=>s.name===value.secret), `env ${key}: only declared secret refs are accepted`)
    else requireThat(typeof value==='string' && (!/(TOKEN|PASSWORD|API_KEY|SECRET)/i.test(key)), `env ${key}: credential values are forbidden`)
  }
  requireThat(!/\b(?:ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9-]{20,})/.test(JSON.stringify(contract)), 'Credential-shaped literal in contract')
  validateGrants(contract)
  return contract
}
export function loadSource(path=resolve(PACKAGE,'contract.json'),root=ROOT) {
  const raw=readFileSync(path,'utf8'),contract=JSON.parse(raw)
  const schema=JSON.parse(readFileSync(resolve(dirname(path),'contract.schema.json'),'utf8'))
  validateContract(contract,schema)
  const files={}
  const read=p=>{
    const actual=realpathSync(resolve(root,p))
    requireThat(actual.startsWith(realpathSync(root)+sep), 'Instruction source escapes the repository')
    return readFileSync(actual,'utf8')
  }
  for (const a of contract.agents) {
    files[a.slug]={'AGENTS.md':read(a.instructions)}
    for (const s of a.skills) files[a.slug][`skills/${s}/SKILL.md`]=read(`.focx/skills/${s}/SKILL.md`)
    requireThat(Object.keys(files[a.slug]).every(p=>instructionPaths(a).includes(p)) && files[a.slug]['AGENTS.md'].trim(), 'Invalid instruction source set')
  }
  return {contract,schema,sha:sha256(raw),files}
}
