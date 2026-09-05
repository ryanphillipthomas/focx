#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { homedir } from 'node:os'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const same = isDeepStrictEqual
const requireThat = (ok, message) => { if (!ok) throw new Error(message) }
const list = x => { const rows = Array.isArray(x) ? x : x?.agents ?? x?.routines ?? x?.data; requireThat(Array.isArray(rows), 'Incomplete API list response'); return rows }
const pilotKeys = ['qa-engineer', 'architecture-documentation-steward', 'implementation-engineer']
const ADAPTERS = ['claude_local', 'codex_local']
// Claude Code's own key shape for an installed plugin: <plugin>@<marketplace>.
const PLUGIN_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*@[a-z0-9]+(?:-[a-z0-9]+)*$/
// A Claude Code permission rule: `Tool` or `Tool(pattern)`.
const PERMISSION_RULE = /^[A-Z][A-Za-z]*(?:\(.+\))?$/
const PROCEDURE_VERSION = /^\s*version: "\d+\.\d+\.\d+"$/m

export function loadSource(root = ROOT) {
  const read = p => readFileSync(resolve(root, p), 'utf8')
  // JSON is a YAML 1.2 subset, keeping these control files dependency-free.
  const invariants = JSON.parse(read('.focx/invariants.yaml'))
  const baseline = JSON.parse(read('.focx/baseline.yaml'))
  const manifest = JSON.parse(read('.focx/agents.json'))
  return buildSource({manifest, invariants, baseline, read})
}

// An adapter change is a credential change: binding the Claude token to an
// agent that was Codex is new access, and access is granted by a human. The
// tool never performs the change. The record says a human did, and why the
// manifest flipped; preflight refuses while the live agent still runs `from`.
function validateMigration(a) {
  const m = a.adapterMigration
  if (m === undefined) return
  requireThat(ADAPTERS.includes(m.from) && ADAPTERS.includes(m.to) && m.from !== m.to, `${a.name}: adapterMigration must move between the two supported adapters`)
  requireThat(m.to === a.adapterType, `${a.name}: adapterMigration.to must equal adapterType`)
  requireThat(typeof m.approvedBy === 'string' && m.approvedBy.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(m.date), `${a.name}: adapterMigration needs approvedBy and an ISO date`)
}

// Adapter-local plugins are installed on this host by a human and enabled in
// the agent's own Claude config dir. The manifest records them so verify can
// see drift; the tool never writes them. The allow-list is the agent's scoped
// write workflow under approve-reads, and is bounded here so a source review
// cannot quietly widen it into approve-all by other means.
function validateAdapterLocal(a) {
  const l = a.adapterLocal
  if (l === undefined) return
  requireThat(a.adapterType === 'claude_local', `${a.name}: adapterLocal is only meaningful for claude_local`)
  const plugins = l.claudeCodePlugins ?? []
  requireThat(Array.isArray(plugins) && plugins.every(k => typeof k === 'string' && PLUGIN_KEY.test(k)) && new Set(plugins).size === plugins.length, `${a.name}: claudeCodePlugins must be unique '<plugin>@<marketplace>' keys`)
  const pluginNames = new Set(plugins.map(k => k.split('@')[0]))
  requireThat(l.permissionDelivery === 'qa-worktree-local' && a.roleKey === 'qa-engineer', 'QA permissions require the worktree-local launcher')
  const rules = l.permissionsAllow ?? []
  requireThat(Array.isArray(rules) && rules.every(r => typeof r === 'string' && PERMISSION_RULE.test(r)) && new Set(rules).size === rules.length, `${a.name}: permissionsAllow must be unique Claude Code permission rules`)
  requireThat(same(l.permissionsDeny, ['Edit','NotebookEdit','Skill']), `${a.name}: deny actual Edit, NotebookEdit and Skill tools while allowing scoped Write via the Edit path rule`)
  for (const r of rules) {
    const tool = r.split('(')[0]
    requireThat(tool !== 'Edit' || r === 'Edit(/pipeline/runs/**)', `${a.name}: file modifications must be anchored to pipeline/runs`)
    requireThat(tool !== 'Write', `${a.name}: Write(path) rules are ineffective; use the scoped Edit path rule`)
    requireThat(tool !== 'Skill', `${a.name}: skill invocation may pre-approve broad tools; read the methodology instead`)
    requireThat(r !== 'Bash', `${a.name}: bare Bash would allow any command; scope it`)
    if (tool === 'Task') {
      const name = r.slice(r.indexOf('(') + 1, -1)
      requireThat(pluginNames.has(name.split(':')[0]), `${a.name}: ${tool}(${name}) names tooling outside the declared plugins`)
    }
  }
}

export function buildSource({manifest, invariants, baseline, read}) {
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
    const uncappedDevelopment = invariants.pilot.environment === 'development' && invariants.pilot.dailyRunCapPolicy === 'uncapped-during-development'
    requireThat(a.timeoutSec > 0 && a.timeoutSec <= 900, 'Per-run timeout cannot be relaxed')
    requireThat((Number.isInteger(a.maxDailyRuns) && a.maxDailyRuns > 0 && a.maxDailyRuns <= 3) || (a.maxDailyRuns === null && uncappedDevelopment), 'Uncapped runs require explicit development policy')
    requireThat(ADAPTERS.includes(a.adapterType), 'Unknown adapter')
    requireThat(same(a.executionPermissions, {permissionMode:'approve-reads',nonInteractivePermissions:'deny'}), 'Pilot ACP permissions must be explicit and deny unattended writes')
    requireThat(a.adapterType !== 'claude_local' || (a.maxTurnsPerRun > 0 && a.maxTurnsPerRun <= 20), 'Claude turn limit required')
    validateMigration(a)
    validateAdapterLocal(a)
    requireThat(a.instructions === `.focx/roles/${a.roleKey}.md`, 'Instructions must be isolated role source')
    files[a.id] = {'AGENTS.md':read(a.instructions)}
    for (const s of a.skills) {
      requireThat(/^focx-[a-z-]+$/.test(s), 'Only scoped focx-* skills allowed')
      const content = read(`.focx/skills/${s}/SKILL.md`)
      requireThat(PROCEDURE_VERSION.test(content), 'Procedure must be versioned')
      files[a.id][`skills/${s}/SKILL.md`] = content
    }
    requireThat(files[a.id]['AGENTS.md'].trim(), 'Empty role instructions')
  }
  const qa = manifest.agents.find(a => a.roleKey === 'qa-engineer')
  const projectSettings = JSON.parse(read('.claude/settings.json'))
  requireThat(same(projectSettings, {enabledPlugins:Object.fromEntries(qa.adapterLocal.claudeCodePlugins.map(k=>[k,true]))}), 'Project settings must mirror only the declared plugins')
  const runtimeFiles = {'tools/qa-claude-agent-acp/index.mjs':read('tools/qa-claude-agent-acp/index.mjs')}
  requireThat(runtimeFiles['tools/qa-claude-agent-acp/index.mjs'].trim(), 'Missing QA permission launcher')
  return {manifest,invariants,baseline,files,runtimeFiles}
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
      const m = a.adapterMigration
      requireThat(live.adapterType === a.adapterType, m && live.adapterType === m.from
        ? `${a.name}: reviewed adapter migration ${m.from} → ${m.to} is declared but not yet performed; complete the manual step before synchronizing`
        : `${a.name}: adapter migration requires separate review`)
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
      body.runtimeConfig.heartbeat.maxDailyRuns = a.maxDailyRuns === null ? null : tighter(c.runtimeConfig?.heartbeat?.maxDailyRuns,a.maxDailyRuns)
      body.adapterConfig = structuredClone(c.adapterConfig)
      // ACP uses its own policy; the CLI bypass switch does not control it.
      // Keep a stricter existing deny-all policy instead of loosening it.
      const effectiveMode = [c.adapterConfig.permissionMode, c.adapterConfig.acpPermissionMode].find(v => typeof v === 'string' && v.trim())?.trim()
      const effectiveNonInteractive = [c.adapterConfig.nonInteractivePermissions, c.adapterConfig.acpNonInteractivePermissions].find(v => typeof v === 'string' && v.trim())?.trim()
      body.adapterConfig.permissionMode = effectiveMode === 'deny-all' ? 'deny-all' : a.executionPermissions.permissionMode
      body.adapterConfig.nonInteractivePermissions = effectiveNonInteractive === 'fail' ? 'fail' : a.executionPermissions.nonInteractivePermissions
      if (a.adapterType === 'claude_local') body.adapterConfig.dangerouslySkipPermissions = false
      else body.adapterConfig.dangerouslyBypassApprovalsAndSandbox = false
      body.adapterConfig.timeoutSec = tighter(c.adapterConfig.timeoutSec,a.timeoutSec)
      // Zero timeout can mean unlimited; never preserve it as a stricter timeout.
      if (body.adapterConfig.timeoutSec === 0) body.adapterConfig.timeoutSec = a.timeoutSec
      if (a.maxTurnsPerRun) body.adapterConfig.maxTurnsPerRun = tighter(c.adapterConfig.maxTurnsPerRun,a.maxTurnsPerRun) || a.maxTurnsPerRun
      delete body.adapterConfig.promptTemplate
      delete body.adapterConfig.bootstrapPromptTemplate
      // Require ACP for every pilot: installed Paperclip 2026.831.1's
      // adapter-codex-local/dist/server/execute.js:364-365 rethrows ACP startup
      // failures when explicit, preventing fallback to CLI's different permissions.
      body.adapterConfig.engine = 'acp'
      if (a.adapterLocal?.permissionDelivery === 'qa-worktree-local') {
        body.adapterConfig.agentCommand = 'node tools/qa-claude-agent-acp/index.mjs'
      }
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

// Verify live pilot lane/permission declarations and host state: the plugins a
// human installed on this machine and the agent's own Claude settings file.
// Read-only, and outside the plan digest on purpose: the digest binds what the
// tool writes; these are what the operator must already have done by hand.
const envValue = (env, key) => { const v = env?.[key]; return typeof v === 'string' ? v : (v && typeof v === 'object' && typeof v.value === 'string' ? v.value : undefined) }
export function checkHost(source, live, host = defaultHost()) {
  const findings = []
  for (const a of source.manifest.agents) {
    if (a.disposition !== 'pilot') continue
    const adapter = live.configs[a.id]?.adapterConfig
    if (adapter?.engine !== 'acp') findings.push(`${a.name}: live engine must be explicitly acp; CLI fallback does not enforce the declared ACP permissions`)
    if (adapter?.permissionMode !== a.executionPermissions.permissionMode) findings.push(`${a.name}: live permissionMode is missing or does not match declared executionPermissions.permissionMode (${a.executionPermissions.permissionMode})`)
    const l = a.adapterLocal
    if (!l) continue
    const env = live.configs[a.id]?.adapterConfig?.env ?? {}
    const cacheDir = envValue(env, 'CLAUDE_CODE_PLUGIN_CACHE_DIR')
    const configDir = envValue(env, 'CLAUDE_CONFIG_DIR')
    if (!cacheDir) findings.push(`${a.name}: CLAUDE_CODE_PLUGIN_CACHE_DIR is not set in the live env; a redirected config dir finds no plugins`)
    if (!configDir) findings.push(`${a.name}: CLAUDE_CONFIG_DIR is not set in the live env`)
    const installed = (cacheDir && host.readJson(`${cacheDir}/installed_plugins.json`)?.plugins) ?? {}
    const marketplaces = (cacheDir && host.readJson(`${cacheDir}/known_marketplaces.json`)) ?? {}
    const settings = (configDir && host.readJson(`${configDir}/settings.json`)) ?? {}
    for (const key of l.claudeCodePlugins ?? []) {
      const record = Array.isArray(installed[key]) ? installed[key][0] : installed[key]
      if (!record?.installPath || !host.exists(`${record.installPath}/.claude-plugin/plugin.json`)) findings.push(`${a.name}: plugin ${key} is not installed on this host`)
      const market = key.split('@')[1]
      if (!(market in marketplaces)) findings.push(`${a.name}: marketplace ${market} is unknown to this host; Claude Code would drop ${key}`)
      if (settings.enabledPlugins?.[key] !== true) findings.push(`${a.name}: ${key} is not enabled in ${configDir ?? '<CLAUDE_CONFIG_DIR>'}/settings.json`)
    }
    // User settings are ignored by ACP. Verify the selected delivery mechanism,
    // never claim that an unused file establishes effective permissions.
    if (!host.exists(resolve(homedir(), '.paperclip/cli/current/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js'))) findings.push(`${a.name}: managed Claude ACP entrypoint is missing; launcher will stop`)
    if (adapter?.engine !== 'acp' || adapter?.agentCommand !== 'node tools/qa-claude-agent-acp/index.mjs') findings.push(`${a.name}: QA worktree permission launcher is not selected; user settings permissions are ineffective`)
  }
  return findings
}
function defaultHost() {
  return {
    readJson: p => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } },
    exists: p => existsSync(p),
  }
}

export async function synchronize(api, source, {apply=false,approvedDigest,host} = {}) {
  const first = await snapshot(api,source)
  const proposed = plan(source,first)
  if (!apply) {
    const result = publicPlan(proposed)
    if (host) result.hostFindings = checkHost(source, first, host === true ? undefined : host)
    return result
  }
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
  const verifyOnly = argv.includes('--verify-only')
  const result = await synchronize(new Client(process.env.PAPERCLIP_API_URL ?? 'http://127.0.0.1:3100',token),source,{apply:argv.includes('--apply'),approvedDigest:argv.find(a=>a.startsWith('--plan-sha='))?.split('=')[1],host:verifyOnly})
  console.log(JSON.stringify(result,null,2))
  return verifyOnly && (result.changes.length || result.hostFindings?.length) ? 1 : 0
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(c=>{process.exitCode=c}).catch(e=>{console.error(`pilot-org: ${e.message}`);process.exitCode=2})
