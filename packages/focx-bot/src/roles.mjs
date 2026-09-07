// Shared, offline .focx role source and validation for provisioner and launcher.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

export const ROLE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const same = isDeepStrictEqual
const requireThat = (ok, message) => { if (!ok) throw new Error(message) }
// Pilot roles are whatever the manifest declares. The count is asserted from the
// manifest's own `expectedPilotRoles`, so adding a role is a reviewed manifest
// change rather than an edit to this file — but it still cannot happen silently.
const ADAPTERS = ['claude_local', 'codex_local']
// Claude Code's own key shape for an installed plugin: <plugin>@<marketplace>.
const PLUGIN_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*@[a-z0-9]+(?:-[a-z0-9]+)*$/
// A Claude Code permission rule: `Tool` or `Tool(pattern)`.
const PERMISSION_RULE = /^[A-Z][A-Za-z]*(?:\(.+\))?$/
// An MCP tool rule names one exact tool on one exact server. A role may reach an
// external service only by listing every tool it needs by name: no wildcard, no
// server-wide grant, so the blast radius of an MCP grant is always readable in
// the manifest. `mcp__<server>__<tool>`.
const MCP_RULE = /^mcp__[a-z0-9]+(?:_[a-z0-9]+)*__[a-z0-9]+(?:_[a-z0-9]+)*$/
const PROCEDURE_VERSION = /^\s*version: "\d+\.\d+\.\d+"$/m

export function loadRoleSource(root = ROLE_ROOT) {
  const read = p => readFileSync(resolve(root, p), 'utf8')
  // JSON is a YAML 1.2 subset, keeping these control files dependency-free.
  const invariants = JSON.parse(read('.focx/invariants.yaml'))
  const baseline = JSON.parse(read('.focx/baseline.yaml'))
  const manifest = JSON.parse(read('.focx/agents.json'))
  return buildRoleSource({manifest, invariants, baseline, read})
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
  // Any role may declare worktree-local delivery. The check is on shape and, below,
  // on uniqueness -- not on one role's literal id. Hardcoding a single identity
  // here is what finding F23 cost us in the QA launcher. QA's own id predates this
  // rule and is pinned in the provisioning contract, so it is matched by shape.
  requireThat(typeof l.permissionDelivery === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*-worktree-local$/.test(l.permissionDelivery), `${a.name}: permissionDelivery must be a '<role>-worktree-local' id`)
  const rules = l.permissionsAllow ?? []
  requireThat(Array.isArray(rules) && rules.every(r => typeof r === 'string' && (PERMISSION_RULE.test(r) || MCP_RULE.test(r))) && new Set(rules).size === rules.length, `${a.name}: permissionsAllow must be unique Claude Code permission or exact MCP tool rules`)
  requireThat(same(l.permissionsDeny, ['Edit','NotebookEdit','Skill']), `${a.name}: deny actual Edit, NotebookEdit and Skill tools while allowing scoped Write via the Edit path rule`)
  for (const r of rules) {
    if (MCP_RULE.test(r)) {
      requireThat(!r.includes('*'), `${a.name}: ${r} must name one exact MCP tool`)
      // An MCP server reaches outside this machine. Only grant tools on a server
      // carried by a plugin this role has actually declared.
      const server = r.split('__')[1]
      requireThat([...pluginNames].some(n => server === n || server.startsWith(`plugin_${n}_`) || server.endsWith(`_${n}`)), `${a.name}: ${r} names an MCP server outside the declared plugins`)
      continue
    }
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

export function buildRoleSource({manifest, invariants, baseline, read}) {
  requireThat(invariants.pilot?.activation === 'paused' && invariants.pilot?.automaticWork === false && invariants.pilot?.agentDeletionAllowed === false && invariants.pilot?.legacyApplyAllowed === false, 'Pilot controls must prohibit activation, deletion, automatic work and legacy apply')
  requireThat(invariants.company === 'Focx' && same(invariants.activeProducts, ['Connect']) && invariants.controlPlane === 'Paperclip', 'Locked Focx baseline changed')
  requireThat(manifest.version === '0.1.0' && manifest.activation === 'paused' && manifest.expectedAgentCount === 26 && manifest.agents.length === 26, 'All 26 retained identities are required')
  requireThat(new Set(manifest.agents.map(a => a.id)).size === 26, 'Duplicate agent identity')
  const pilots = manifest.agents.filter(a => a.disposition === 'pilot').map(a => a.roleKey).sort()
  requireThat(Array.isArray(manifest.expectedPilotRoles) && same(pilots, [...manifest.expectedPilotRoles].sort()), 'Pilot roles must match the manifest declaration exactly')
  requireThat(new Set(pilots).size === pilots.length, 'Duplicate pilot roleKey')
  const deliveries = manifest.agents.map(a => a.adapterLocal?.permissionDelivery).filter(Boolean)
  requireThat(new Set(deliveries).size === deliveries.length, 'Two roles share a permissionDelivery id')
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
  // Every plugin any worktree-local role declares, and nothing else.
  const declared = manifest.agents.filter(a => a.disposition === 'pilot' && a.adapterLocal?.claudeCodePlugins)
    .flatMap(a => a.adapterLocal.claudeCodePlugins)
  const projectSettings = JSON.parse(read('.claude/settings.json'))
  requireThat(same(projectSettings, {enabledPlugins:Object.fromEntries([...new Set(declared)].sort().map(k=>[k,true]))}), 'Project settings must mirror exactly the declared plugins')
  const runtimeFiles = {'tools/qa-claude-agent-acp/index.mjs':read('tools/qa-claude-agent-acp/index.mjs')}
  requireThat(runtimeFiles['tools/qa-claude-agent-acp/index.mjs'].trim(), 'Missing the worktree-local permission launcher')
  return {manifest,invariants,baseline,files,runtimeFiles}
}
