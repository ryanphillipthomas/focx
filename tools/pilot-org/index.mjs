#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const same = isDeepStrictEqual
const requireThat = (ok, message) => { if (!ok) throw new Error(message) }
const list = x => { const rows = Array.isArray(x) ? x : x?.agents ?? x?.routines ?? x?.data; requireThat(Array.isArray(rows), 'Incomplete API list response'); return rows }
const pilotKeys = ['qa-engineer', 'architecture-documentation-steward', 'implementation-engineer']

export function loadSource(root = ROOT) {
  const read = p => readFileSync(resolve(root, p), 'utf8')
  // JSON is a YAML 1.2 subset, keeping these control files dependency-free.
  const invariants = JSON.parse(read('.focx/invariants.yaml'))
  const baseline = JSON.parse(read('.focx/baseline.yaml'))
  const manifest = JSON.parse(read('.focx/agents.json'))
  requireThat(invariants.pilot?.activation === 'paused' && invariants.pilot?.automaticWork === false && invariants.pilot?.agentDeletionAllowed === false && invariants.pilot?.legacyApplyAllowed === false, 'Pilot controls must prohibit activation, deletion, automatic work and legacy apply')
  requireThat(invariants.company === 'Focx' && same(invariants.activeProducts, ['Connect']) && invariants.controlPlane === 'Paperclip', 'Locked Focx baseline changed')
  requireThat(manifest.version === '0.1.0' && manifest.activation === 'paused' && manifest.expectedAgentCount === 26 && manifest.agents.length === 26, 'All 26 retained identities are required')
  requireThat(new Set(manifest.agents.map(a => a.id)).size === 26, 'Duplicate agent identity')
  requireThat(same(manifest.agents.filter(a => a.disposition === 'pilot').map(a => a.roleKey).sort(), [...pilotKeys].sort()), 'Exactly the three pilot roles are required')
  const files = {}
  for (const a of manifest.agents) {
    requireThat(/^[0-9a-f-]{36}$/.test(a.id) && a.status === 'paused' && ['pilot','disabled-candidate'].includes(a.disposition), 'Invalid retained identity or disposition')
    if (a.disposition !== 'pilot') continue
    requireThat(a.reportsTo === null && same(a.permissions, {canCreateAgents:false,canCreateSkills:false,canAssignTasks:false}), 'Pilot must have human ownership and no delegation')
    requireThat(a.timeoutSec > 0 && a.timeoutSec <= 900 && a.maxDailyRuns > 0 && a.maxDailyRuns <= 3, 'Pilot limits cannot be relaxed')
    requireThat(['claude_local','codex_local'].includes(a.adapterType), 'Unknown adapter')
    requireThat(a.adapterType !== 'claude_local' || (a.maxTurnsPerRun > 0 && a.maxTurnsPerRun <= 20), 'Claude turn limit required')
    requireThat(a.instructions === `.focx/roles/${a.roleKey}.md`, 'Instructions must be isolated role source')
    files[a.id] = {'AGENTS.md':read(a.instructions)}
    for (const s of a.skills) {
      requireThat(/^focx-[a-z-]+$/.test(s), 'Only scoped focx-* skills allowed')
      const content = read(`.focx/skills/${s}/SKILL.md`)
      requireThat(content.includes('version: "0.1.0"'), 'Procedure must be versioned')
      files[a.id][`skills/${s}/SKILL.md`] = content
    }
    requireThat(files[a.id]['AGENTS.md'].trim(), 'Empty role instructions')
  }
  return {manifest,invariants,baseline,files}
}

export class Client {
  constructor(url, token) { this.url = url.replace(/\/$/, ''); this.token = token }
  async request(method, path, body) {
    const response = await fetch(this.url + path, {method, redirect:'error', headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(15000)})
    requireThat(response.ok, `Paperclip ${method} ${path} returned ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
}

export async function snapshot(api, source) {
  const company = source.manifest.companyId
  const agents = list(await api.request('GET', `/api/companies/${company}/agents`))
  const expected = source.manifest.agents.map(a => a.id).sort()
  requireThat(same(agents.map(a => a.id).sort(), expected), 'Live identities differ: no creation, omission, adoption or deletion is permitted')
  const configs = {}, bundles = {}
  for (const a of source.manifest.agents) {
    const live = await api.request('GET', `/api/agents/${a.id}/configuration`)
    requireThat(live.companyId === company && live.id === a.id && live.status === 'paused', `${a.name}: must be paused in the expected company before synchronization`)
    configs[a.id] = live
    if (a.disposition === 'pilot') {
      requireThat(live.adapterType === a.adapterType, `${a.name}: adapter migration requires separate review`)
      const b = await api.request('GET', `/api/agents/${a.id}/instructions-bundle`)
      requireThat(b && Array.isArray(b.files), `${a.name}: incomplete instruction bundle`)
      const files = {}
      for (const f of b.files) {
        requireThat(f.path in source.files[a.id] && !(f.path in files), `${a.name}: unexpected instruction files require explicit review; nothing will be deleted`)
        const detail = await api.request('GET', `/api/agents/${a.id}/instructions-bundle/file?path=${encodeURIComponent(f.path)}`)
        requireThat(detail.path === f.path && typeof detail.content === 'string', 'Incomplete instruction file response')
        files[f.path] = detail.content
      }
      const skills = await api.request('GET', `/api/agents/${a.id}/skills`)
      requireThat(Array.isArray(skills.desiredSkills) && skills.desiredSkills.every(k => k === 'paperclipai/paperclip/paperclip'), `${a.name}: inherited registry skills require separate review`)
      bundles[a.id] = {...b,files,registrySkills:skills.desiredSkills}
    }
  }
  const routines = list(await api.request('GET', `/api/companies/${company}/routines`))
  const triggers = []
  for (const r of routines) {
    const full = await api.request('GET', `/api/routines/${r.id}`)
    const rows = full.triggers ?? full.routine?.triggers
    requireThat(Array.isArray(rows), 'Incomplete schedule response')
    for (const t of rows.filter(t => t.kind === 'schedule')) {
      requireThat(t.enabled === false, 'Pause all schedule triggers before synchronization')
      triggers.push({routineId:r.id,id:t.id,enabled:t.enabled})
    }
  }
  return {configs,bundles,triggers}
}
const tighter = (live, target) => Number.isInteger(live) && live >= 0 ? Math.min(live,target) : target

export function plan(source, live) {
  const operations = []
  for (const a of source.manifest.agents) {
    const c = live.configs[a.id]
    const runtimeConfig = structuredClone(c.runtimeConfig ?? {})
    runtimeConfig.heartbeat = {...runtimeConfig.heartbeat, enabled:false, wakeOnDemand:false, maxTurnContinuation:{enabled:false}}
    const body = {name:a.name,title:a.title,runtimeConfig}
    if (a.disposition === 'pilot') {
      body.reportsTo = null
      body.runtimeConfig.heartbeat.maxConcurrentRuns = 1
      body.runtimeConfig.heartbeat.maxDailyRuns = tighter(c.runtimeConfig?.heartbeat?.maxDailyRuns,a.maxDailyRuns)
      body.adapterConfig = structuredClone(c.adapterConfig)
      body.adapterConfig.timeoutSec = tighter(c.adapterConfig.timeoutSec,a.timeoutSec)
      // Zero timeout can mean unlimited; never preserve it as a stricter timeout.
      if (body.adapterConfig.timeoutSec === 0) body.adapterConfig.timeoutSec = a.timeoutSec
      if (a.maxTurnsPerRun) body.adapterConfig.maxTurnsPerRun = tighter(c.adapterConfig.maxTurnsPerRun,a.maxTurnsPerRun) || a.maxTurnsPerRun
      delete body.adapterConfig.promptTemplate
      delete body.adapterConfig.bootstrapPromptTemplate
      body.replaceAdapterConfig = true
    }
    const changed = Object.keys(body).filter(k => k !== 'replaceAdapterConfig' && !same(body[k],c[k]))
    if (changed.length) operations.push({method:'PATCH',path:`/api/agents/${a.id}`,body,fields:changed})
    if (a.disposition !== 'pilot') continue
    const permissions = a.permissions
    if (Object.keys(permissions).some(k => c.permissions?.[k] !== false)) operations.push({method:'PATCH',path:`/api/agents/${a.id}/permissions`,body:permissions,fields:['permissions']})
    const bundle = live.bundles[a.id]
    if (bundle.entryFile !== 'AGENTS.md' || bundle.legacyPromptTemplateActive || bundle.legacyBootstrapPromptTemplateActive) operations.push({method:'PATCH',path:`/api/agents/${a.id}/instructions-bundle`,body:{entryFile:'AGENTS.md',clearLegacyPromptTemplate:true},fields:['entryFile','clearLegacyPromptTemplate']})
    for (const [path,content] of Object.entries(source.files[a.id])) if (bundle.files[path] !== content) operations.push({method:'PUT',path:`/api/agents/${a.id}/instructions-bundle/file`,body:{path,content,clearLegacyPromptTemplate:true},fields:[path]})
  }
  // The digest binds review to both source and live state, without printing secrets.
  return {digest:hash({source,live}),operations}
}
export const publicPlan = p => ({digest:p.digest,changes:p.operations.map(o => ({method:o.method,path:o.path,fields:o.fields})),deletions:0,activations:0})

export async function synchronize(api, source, {apply=false,approvedDigest} = {}) {
  const first = await snapshot(api,source)
  const proposed = plan(source,first)
  if (!apply) return publicPlan(proposed)
  requireThat(approvedDigest === proposed.digest, 'Preview changed or not approved; obtain a fresh plan digest')
  const checked = await snapshot(api,source)
  requireThat(plan(source,checked).digest === approvedDigest, 'Live state changed during preflight; no writes made')
  for (const op of proposed.operations) await api.request(op.method,op.path,op.body)
  const remaining = plan(source,await snapshot(api,source))
  requireThat(remaining.operations.length === 0, 'Partial apply: readback differs; keep agents paused and review a new plan')
  return {...publicPlan(proposed),verified:true}
}

export async function main(argv) {
  const allowed = argv.every(a => ['--check','--apply','--verify-only'].includes(a) || /^--plan-sha=[a-f0-9]{64}$/.test(a))
  requireThat(allowed && new Set(argv).size === argv.length, 'Usage: node tools/pilot-org/index.mjs [--check | --verify-only | --apply --plan-sha=<digest>]')
  requireThat(argv.filter(a => ['--check','--apply','--verify-only'].includes(a)).length <= 1 && (!argv.some(a=>a.startsWith('--plan-sha=')) || argv.includes('--apply')), 'Conflicting flags')
  const source = loadSource()
  if (argv.includes('--check')) { console.log('Pilot source valid: 26 retained identities; 3 paused roles; no activation or deletion path.'); return 0 }
  const token = process.env.PAPERCLIP_API_KEY
  requireThat(token, 'Set PAPERCLIP_API_KEY using existing authorized board access; the tool does not create credentials')
  requireThat(!process.env.PAPERCLIP_COMPANY_ID || process.env.PAPERCLIP_COMPANY_ID === source.manifest.companyId, 'Company mismatch')
  const result = await synchronize(new Client(process.env.PAPERCLIP_API_URL ?? 'http://127.0.0.1:3100',token),source,{apply:argv.includes('--apply'),approvedDigest:argv.find(a=>a.startsWith('--plan-sha='))?.split('=')[1]})
  console.log(JSON.stringify(result,null,2))
  return argv.includes('--verify-only') && result.changes.length ? 1 : 0
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(c=>{process.exitCode=c}).catch(e=>{console.error(`pilot-org: ${e.message}`);process.exitCode=2})
