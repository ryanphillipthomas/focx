#!/usr/bin/env node
// paperclip-org — reconcile the Paperclip company to pipeline/org/roster.json.
//
// The repo holds desired state; Paperclip holds live state. This tool makes the
// second match the first, and can prove it did. Drift between them becomes a
// failing check instead of a discovery months later — the same argument
// tools/pipeline-parity makes for the two-repo pipeline.
//
// Usage:
//   node tools/paperclip-org/index.mjs                     dry run (DEFAULT) — mutates nothing
//   node tools/paperclip-org/index.mjs --apply --confirm-terminate=N
//   node tools/paperclip-org/index.mjs --verify-only       read-only success-condition check
//   node tools/paperclip-org/index.mjs --render-only       render bundles offline, no credential
//
// Env: PAPERCLIP_API_URL (default http://127.0.0.1:3100), PAPERCLIP_API_KEY,
//      PAPERCLIP_COMPANY_ID (defaults to roster.company.id).
//
// Exit: 0 clean · 1 verification failed · 2 usage/roster error · 3 preflight failed
//       4 PARTIAL APPLY — mixed state; rerun is safe but must be deliberate.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(here, '../..')

// ---------------------------------------------------------------------------
// Frozen enums.
//
// Lifted from @paperclipai/shared/dist/constants.js on the machine that runs
// this tool. adapterConfig is a z.record of unknown server-side — a bad value is
// ACCEPTED at create time and only fails hours later at run time — so validating
// offline against these is the difference between a clear error and a mystery.
// Preflight re-checks models against the live catalog; these catch typos first.
// ---------------------------------------------------------------------------

export const AGENT_ROLES = Object.freeze([
  'ceo', 'cto', 'cmo', 'cfo', 'security', 'engineer',
  'designer', 'pm', 'qa', 'devops', 'researcher', 'general',
])

export const AGENT_ICON_NAMES = Object.freeze([
  'bot', 'cpu', 'brain', 'zap', 'rocket', 'code', 'terminal', 'shield', 'eye',
  'search', 'wrench', 'hammer', 'lightbulb', 'sparkles', 'star', 'heart',
  'flame', 'bug', 'cog', 'database', 'globe', 'lock', 'mail', 'message-square',
  'file-code', 'git-branch', 'package', 'puzzle', 'target', 'wand', 'atom',
  'circuit-board', 'radar', 'swords', 'telescope', 'microscope', 'crown',
  'gem', 'hexagon', 'pentagon', 'fingerprint',
])

// Reasoning vocabularies differ per adapter, and the roster carries ONE
// human-facing `reasoning` field. Rendering maps it to the adapter's own key.
export const REASONING = Object.freeze({
  claude_local: { key: 'effort', values: ['low', 'medium', 'high'] },
  codex_local: { key: 'modelReasoningEffort', values: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
})

// The adapterConfig keys each adapter actually documents. adapterConfig is a
// z.record of unknown server-side, so an unknown key is ACCEPTED at create time
// and simply ignored — or worse, a known-but-unsupported one fails at first run.
// Lifted from the adapters' own self-documentation.
export const ADAPTER_KEYS = Object.freeze({
  claude_local: Object.freeze(['engine', 'cwd', 'instructionsFilePath', 'model', 'effort', 'chrome',
    'promptTemplate', 'maxTurnsPerRun', 'dangerouslySkipPermissions', 'command', 'extraArgs', 'env',
    'workspaceStrategy', 'workspaceRuntime', 'filesystemScope', 'filesystemExtraPaths',
    'filesystemSandboxCommand', 'networkScope', 'networkAllowlist', 'agentCommand', 'mode', 'stateDir',
    'nonInteractivePermissions', 'warmHandleIdleMs', 'timeoutSec', 'graceSec']),
  codex_local: Object.freeze(['engine', 'cwd', 'instructionsFilePath', 'model', 'modelReasoningEffort',
    'promptTemplate', 'search', 'fastMode', 'dangerouslyBypassApprovalsAndSandbox', 'command', 'extraArgs',
    'env', 'workspaceStrategy', 'workspaceRuntime', 'filesystemScope', 'filesystemExtraPaths',
    'filesystemSandboxCommand', 'networkScope', 'networkAllowlist', 'timeoutSec', 'graceSec',
    'outputInactivityTimeoutMs', 'agentCommand', 'mode', 'nonInteractivePermissions', 'stateDir',
    'warmHandleIdleMs']),
})

// Spawn-level confinement. Both adapters document these as requiring Bubblewrap,
// and filesystemSandboxCommand as "Linux only". Setting any of them on a host
// without bwrap makes every run die with "bwrap was not found in PATH" — at
// first run, long after the config was accepted.
export const BUBBLEWRAP_KEYS = Object.freeze([
  'filesystemScope', 'networkScope', 'networkAllowlist', 'filesystemExtraPaths', 'filesystemSandboxCommand',
])

// Paperclip's ISSUE_PRIORITIES, which routines reuse. The API rejects anything
// else with a bare "400 Validation error" that names no field, so validating
// offline is the difference between a clear message and a guessing game.
export const ROUTINE_PRIORITIES = Object.freeze(['critical', 'high', 'medium', 'low'])

// Bare 'gpt-5.6' is silently aliased to gpt-5.6-sol, but OpenAI ships no model
// metadata for the bare slug, so the Codex CLI warns and falls back to generic
// context limits. Reject it by name rather than letting it degrade quietly.
export const REJECTED_MODELS = Object.freeze({
  'gpt-5.6': "use 'gpt-5.6-sol' — the bare slug makes the Codex CLI fall back to generic context limits",
})

// The roster is committed to git. A literal credential in it is a leak, so
// refuse to carry one even as far as the API.
const CREDENTIAL_PATTERNS = Object.freeze([
  /\bghp_[A-Za-z0-9]{16,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bgho_[A-Za-z0-9]{16,}/, /\bsk-ant-[A-Za-z0-9-]{20,}/,
  /\bsk-[A-Za-z0-9]{32,}/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
])

const SECRET_REF = /^\[secret:\s*([A-Za-z0-9._-]+)\s*\]$/

// ---------------------------------------------------------------------------
// Roster validation — fully offline, runs even under --render-only.
// A broken roster is caught before a credential ever exists.
// ---------------------------------------------------------------------------

export function validateRoster(roster, { instructionFiles = null } = {}) {
  const e = []
  const push = (m) => e.push(m)

  if (!roster || typeof roster !== 'object') return ['roster is not an object']
  const agents = Array.isArray(roster.agents) ? roster.agents : []
  const routines = Array.isArray(roster.routines) ? roster.routines : []

  if (agents.length !== roster.expectedAgentCount) {
    push(`expectedAgentCount is ${roster.expectedAgentCount} but the roster has ${agents.length} agents`)
  }

  // --- identity -----------------------------------------------------------
  const bySlug = new Map()
  const seenNames = new Map()
  for (const a of agents) {
    if (!a.slug) { push('an agent has no slug'); continue }
    if (bySlug.has(a.slug)) push(`duplicate slug: ${a.slug}`)
    bySlug.set(a.slug, a)
    if (a.name) {
      if (seenNames.has(a.name)) push(`duplicate name: ${a.name} (${seenNames.get(a.name)} and ${a.slug})`)
      seenNames.set(a.name, a.slug)
    }
  }

  // --- enums and per-agent shape -----------------------------------------
  for (const a of agents) {
    const at = `${a.slug}:`
    if (!AGENT_ROLES.includes(a.role)) push(`${at} role '${a.role}' is not a valid AGENT_ROLE`)
    if (!AGENT_ICON_NAMES.includes(a.icon)) push(`${at} icon '${a.icon}' is not a valid AGENT_ICON_NAME`)
    if (!['manager', 'ic'].includes(a.tier)) push(`${at} tier must be 'manager' or 'ic'`)
    if (!['write', 'read', 'none'].includes(a.git)) push(`${at} git must be write, read or none`)

    const spec = REASONING[a.adapter?.type]
    if (!spec) {
      push(`${at} adapter.type '${a.adapter?.type}' is not supported (claude_local or codex_local)`)
    } else if (!spec.values.includes(a.adapter.reasoning)) {
      push(`${at} reasoning '${a.adapter.reasoning}' is not valid for ${a.adapter.type} (${spec.values.join('|')})`)
    }
    if (REJECTED_MODELS[a.adapter?.model]) {
      push(`${at} model '${a.adapter.model}': ${REJECTED_MODELS[a.adapter.model]}`)
    }

    if (a.permissions?.canCreateAgents !== false) {
      push(`${at} canCreateAgents must be false — an agent that can hire breaks the count and budget invariants`)
    }
    if (a.permissions?.canAssignTasks !== (a.tier === 'manager')) {
      push(`${at} canAssignTasks must be true for managers and false for ICs`)
    }
    const expectedConcurrency = a.tier === 'manager' ? 2 : 1
    if (a.run?.maxConcurrentRuns !== expectedConcurrency) {
      push(`${at} maxConcurrentRuns must be ${expectedConcurrency} for tier '${a.tier}'`)
    }
    if (a.run?.heartbeat !== false) push(`${at} heartbeat must be false — agents wake from work and routines, not polling`)
    if (a.run?.wakeOnDemand !== true) push(`${at} wakeOnDemand must be true`)

    if (!roster.workspaces?.[a.workspace]) push(`${at} workspace '${a.workspace}' is not defined in roster.workspaces`)
    if (instructionFiles && !instructionFiles.has(a.instructions)) {
      push(`${at} instructions file '${a.instructions}' not found in pipeline/org/instructions/`)
    }
    // Two different skill systems, and confusing them fails at preflight for a
    // reason nobody will guess. Paperclip keys look like 'vendor/pack/skill';
    // Claude Code plugin skills look like 'plugin:skill' or a bare name.
    for (const s of a.desiredSkills ?? []) {
      if (!String(s).includes('/')) {
        push(`${at} desiredSkills '${s}' is not a Paperclip registry key (vendor/pack/skill). Claude Code plugin skills belong in claudeCodeSkills.`)
      }
    }
    for (const s of a.claudeCodeSkills ?? []) {
      if (String(s).includes('/')) {
        push(`${at} claudeCodeSkills '${s}' looks like a Paperclip registry key — those belong in desiredSkills.`)
      }
    }
  }

  // --- hierarchy: exactly one root, fully reachable, acyclic --------------
  const roots = agents.filter((a) => a.reportsTo == null)
  if (roots.length !== 1) {
    push(`expected exactly one root agent (reportsTo: null), found ${roots.length}${roots.length ? ': ' + roots.map((r) => r.slug).join(', ') : ''}`)
  }
  for (const a of agents) {
    if (a.reportsTo != null && !bySlug.has(a.reportsTo)) push(`${a.slug}: reportsTo '${a.reportsTo}' is not a known slug`)
    if (a.reportsTo === a.slug) push(`${a.slug}: reports to itself`)
  }
  // Grey/black DFS: detects a cycle even when it does not include a root.
  const GREY = 1, BLACK = 2
  const mark = new Map()
  for (const a of agents) {
    if (mark.get(a.slug)) continue
    const path = []
    let cur = a
    while (cur && mark.get(cur.slug) !== BLACK) {
      if (mark.get(cur.slug) === GREY) { push(`reporting cycle: ${[...path, cur.slug].join(' -> ')}`); break }
      mark.set(cur.slug, GREY)
      path.push(cur.slug)
      cur = cur.reportsTo != null ? bySlug.get(cur.reportsTo) : null
    }
    for (const s of path) mark.set(s, BLACK)
  }
  if (roots.length === 1) {
    const reachable = new Set()
    const stack = [roots[0].slug]
    while (stack.length) {
      const s = stack.pop()
      if (reachable.has(s)) continue
      reachable.add(s)
      for (const a of agents) if (a.reportsTo === s) stack.push(a.slug)
    }
    for (const a of agents) if (!reachable.has(a.slug)) push(`${a.slug} is not reachable from the root — orphaned subtree`)
  }

  // --- budget arithmetic --------------------------------------------------
  const total = agents.reduce((n, a) => n + (a.budgetMonthlyCents ?? 0), 0)
  const ceiling = roster.company?.budgetMonthlyCents ?? 0
  if (total > ceiling) push(`agent budgets total ${total} cents, over the company ceiling of ${ceiling} cents`)

  // --- secrets and env hygiene -------------------------------------------
  const declared = new Set((roster.secrets ?? []).map((s) => s.name))
  for (const [block, vars] of Object.entries(roster.env ?? {})) {
    for (const [k, v] of Object.entries(vars ?? {})) {
      const at = `env.${block}.${k}`
      if (v && typeof v === 'object') {
        if (typeof v.secret !== 'string') push(`${at} must be a string or { secret: "<name>" }`)
        else if (!declared.has(v.secret)) push(`${at} references undeclared secret '${v.secret}' — add it to roster.secrets`)
        continue
      }
      // The bare-string form is coerced to { type: "plain" } by Paperclip, so a
      // "[secret: name]" string silently becomes a literal value on every agent.
      // That happened; do not let it happen again.
      if (SECRET_REF.test(String(v))) {
        push(`${at} uses the "[secret: name]" string form, which Paperclip stores as a PLAIN value — use { "secret": "name" } instead`)
      }
      for (const pat of CREDENTIAL_PATTERNS) {
        if (pat.test(String(v))) {
          push(`${at} looks like a literal credential — secrets are referenced by name, never inlined; this file is committed to git`)
          break
        }
      }
    }
  }
  // Every agent's rendered adapterConfig, against the adapter's documented keys.
  for (const a of agents) {
    if (!a.adapter?.type || !REASONING[a.adapter.type]) continue
    try {
      for (const problem of checkAdapterConfig(a.adapter.type, composeAdapterConfig(roster, a))) push(`${a.slug}: ${problem}`)
    } catch (err) { push(`${a.slug}: could not compose adapterConfig — ${err.message}`) }
  }

  // --- workspaces ---------------------------------------------------------
  for (const [name, ws] of Object.entries(roster.workspaces ?? {})) {
    const strat = ws.workspaceStrategy
    if (!strat) continue
    if (strat.type === 'git_worktree') {
      const ref = String(strat.baseRef ?? '')
      // Paperclip only fetches when baseRef parses as <remote>/<branch>
      // (refreshRemoteTrackingBaseRef returns early otherwise). A bare
      // 'develop' therefore branches from whatever the local checkout happens
      // to be, silently, forever.
      if (!ref.includes('/')) {
        push(`workspaces.${name}: baseRef '${ref}' is not remote-tracking — Paperclip will not fetch before branching, so worktrees silently use a stale local ref. Use '<remote>/${ref || 'branch'}'.`)
      }
      if (strat.branchTemplate && !/\{\{.+\}\}/.test(strat.branchTemplate)) {
        push(`workspaces.${name}: branchTemplate '${strat.branchTemplate}' has no {{...}} placeholder — it renders literally, putting every agent and issue on one shared branch and worktree. Omit it to take the per-issue default.`)
      }
    }
    if (ws.cwdTemplate) push(`workspaces.${name}: cwdTemplate is no longer used — the claude ACP lane ignores cwd; use a git_worktree strategy`)
  }
  if (roster.agents?.some((a) => roster.workspaces?.[a.workspace]?.workspaceStrategy) && !roster.project?.id) {
    push('roster.project.id is required when any workspace uses git_worktree — worktrees are cut from the project checkout')
  }

  // --- design chain -------------------------------------------------------
  const dc = roster.designChain
  if (!dc) {
    push('roster.designChain is missing')
  } else {
    if (dc.proposer === dc.approver) push('designChain: proposer and approver must be different agents')
    for (const k of ['proposer', 'approver']) {
      if (!bySlug.has(dc[k])) push(`designChain.${k} '${dc[k]}' is not a known slug`)
    }
    const w = new Set(dc.figmaWrite ?? [])
    const r = new Set(dc.figmaRead ?? [])
    for (const s of w) if (r.has(s)) push(`designChain: '${s}' has both Figma write and read — the reviewer must not write what it approves`)
    for (const a of agents) {
      if (a.figmaAccess === 'write' && !w.has(a.slug)) push(`${a.slug}: figmaAccess 'write' but not listed in designChain.figmaWrite`)
      if (a.figmaAccess === 'read' && !r.has(a.slug)) push(`${a.slug}: figmaAccess 'read' but not listed in designChain.figmaRead`)
      if (!a.figmaAccess && (w.has(a.slug) || r.has(a.slug))) push(`${a.slug}: listed in the design chain but has no figmaAccess`)
    }
    // Three distinct agents touch a discovery candidate. Collapsing any two
    // loses an independent lens, so assert it structurally rather than in prose.
    if (dc.researcher) {
      const trio = [dc.proposer, dc.approver, dc.researcher]
      if (new Set(trio).size !== 3) push(`designChain: proposer, approver and researcher must be three different agents (got ${trio.join(', ')})`)
      if (!bySlug.has(dc.researcher)) push(`designChain.researcher '${dc.researcher}' is not a known slug`)
      const res = bySlug.get(dc.researcher)
      if (res && res.git === 'write') push(`designChain.researcher '${dc.researcher}' has git: write — a researcher that can implement is not independent of what it evaluates`)
      if (res && res.figmaAccess === 'write') push(`designChain.researcher '${dc.researcher}' has Figma write`)
      if (dc.researchPolicy && dc.researchPolicy.gatesApproval !== false) {
        push('designChain.researchPolicy.gatesApproval must be false — research informs, it does not decide')
      }
    }
    const modes = Object.entries(dc.modes ?? {})
    const defaults = modes.filter(([, m]) => m.default)
    if (defaults.length !== 1) push(`designChain: exactly one mode must be default, found ${defaults.length}`)
    else if (defaults[0][1].usesClaudeDesign) {
      push(`designChain: the default mode ('${defaults[0][0]}') must not use Claude Design — routine work cannot depend on the discovery tool`)
    }
    for (const [name, m] of modes) {
      if (m.mayAddComponents && !m.usesClaudeDesign && m.default) {
        push(`designChain: default mode '${name}' may add components — reuse must be the default`)
      }
    }
    const allCc = new Set(agents.flatMap((a) => a.claudeCodeSkills ?? []))
    for (const s of dc.discoveryOnlySkills ?? []) {
      if (!allCc.has(s)) push(`designChain.discoveryOnlySkills names '${s}', which no agent lists in claudeCodeSkills`)
    }
    const esc = dc.modeEscalation ?? {}
    if (esc.raisedBy === esc.decidedBy) push('designChain.modeEscalation: the escalator must not also be the decider')
  }

  // --- routines -----------------------------------------------------------
  const titles = new Set()
  const keys = new Set()
  for (const r of routines) {
    const at = `routine ${r.key ?? '(no key)'}:`
    if (!bySlug.has(r.owner)) push(`${at} owner '${r.owner}' is not a known slug`)
    if (titles.has(r.title)) push(`${at} duplicate title '${r.title}' — titles are the live match key and must be unique`)
    titles.add(r.title)
    if (keys.has(r.key)) push(`${at} duplicate key`)
    keys.add(r.key)
    if (!ROUTINE_PRIORITIES.includes(r.priority)) {
      push(`${at} priority '${r.priority}' is not valid (${ROUTINE_PRIORITIES.join('|')})`)
    }
    const fields = String(r.cron ?? '').trim().split(/\s+/)
    if (fields.length !== 5) push(`${at} cron '${r.cron}' has ${fields.length} fields, expected 5`)
    if (!r.timezone) push(`${at} timezone is required`)
    if (r.activityGatePolicy === 'require_external_activity' && !r.activityGateScope) {
      push(`${at} activityGateScope is required when the gate policy is require_external_activity`)
    }
  }

  return e
}

// ---------------------------------------------------------------------------
// Charter coupling.
//
// pipeline/prompts/paperclip-development-agent.md hands work off to an agent it
// names literally. Before this org existed it said `QA`; the roster says
// `QA Engineer`. The charter's own rule is to halt `blocked` rather than
// substitute, so a mismatch does not degrade — every build run stops.
//
// That is a prose coupling between two files, which is exactly the kind that
// rots silently. This turns it into a mechanical check.
// ---------------------------------------------------------------------------

export const COUPLED_CHARTERS = Object.freeze(['pipeline/prompts/paperclip-development-agent.md'])

export function checkCharterCoupling(roster, readFile) {
  const names = new Set(roster.agents.map((a) => a.name))
  const problems = []
  for (const rel of COUPLED_CHARTERS) {
    let text
    try { text = readFile(rel) } catch { problems.push(`${rel}: not readable`); continue }
    const referenced = new Set()
    for (const m of text.matchAll(/agent named `([^`]+)`/g)) referenced.add(m[1])
    for (const m of text.matchAll(/separate `([^`]+)` agent/g)) referenced.add(m[1])
    if (referenced.size === 0) problems.push(`${rel}: names no handoff agent — the coupling check has gone blind, verify the charter still hands off`)
    for (const n of referenced) {
      if (!names.has(n)) problems.push(`${rel}: hands off to an agent named '${n}', which is not in the roster — every build run would halt as blocked`)
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Topological order. reportsTo is a SLUG in the roster because the manager's
// UUID does not exist until the manager is created; creating by BFS depth is
// what guarantees the parent is always there to point at.
// ---------------------------------------------------------------------------

export function topoOrder(agents) {
  const out = []
  const placed = new Set()
  let frontier = agents.filter((a) => a.reportsTo == null).map((a) => a.slug).sort()
  while (frontier.length) {
    for (const s of frontier) { out.push(s); placed.add(s) }
    frontier = agents
      .filter((a) => a.reportsTo != null && !placed.has(a.slug) && placed.has(a.reportsTo))
      .map((a) => a.slug)
      .sort() // stable within a depth, so the plan is deterministic and diffable
  }
  return out
}

// ---------------------------------------------------------------------------
// Env composition. Deterministic, so the renderer derives it rather than each
// agent hand-listing it — and so a missing GH_TOKEN is a structural fact.
// ---------------------------------------------------------------------------

// Paperclip's env value union is { type: "plain", value } | { type: "secret_ref",
// secretId } | { type: "user_secret_ref", key } | a bare string. A bare string is
// COERCED to plain — which is how "[secret: name]" once became a literal 34-character
// token on every agent. The roster says { secret: "<name>" }; resolveEnv turns that
// into a real secret_ref, and refuses to emit anything it could not resolve.
export function composeEnv(roster, agent) {
  const env = { ...(roster.env?.common ?? {}) }
  if (agent.adapter?.type === 'claude_local') Object.assign(env, roster.env?.claudeAuth ?? {})
  // codex_local authenticates through the shared per-company codex-home/auth.json;
  // the adapter supplies CODEX_HOME itself. Do not invent a token here.
  if (agent.git === 'write') Object.assign(env, roster.env?.gitWrite ?? {})
  return env
}

export function resolveEnv(env, secretIds) {
  const out = {}
  for (const [k, v] of Object.entries(env)) {
    if (v && typeof v === 'object' && typeof v.secret === 'string') {
      const id = secretIds?.get(v.secret)
      if (!id) throw new Error(`env ${k}: secret '${v.secret}' did not resolve to an id — refusing to write a plain value in its place`)
      out[k] = { type: 'secret_ref', secretId: id }
    } else {
      out[k] = { type: 'plain', value: String(v) }
    }
  }
  return out
}

export function composeAdapterConfig(roster, agent, secretIds = null) {
  const ws = roster.workspaces?.[agent.workspace] ?? {}
  const spec = REASONING[agent.adapter.type]
  const env = composeEnv(roster, agent)
  const cfg = {
    model: agent.adapter.model,
    [spec.key]: agent.adapter.reasoning,
    env: secretIds ? resolveEnv(env, secretIds) : env,
    timeoutSec: 3600,
    graceSec: 60,
  }
  // The claude ACP lane ignores cwd entirely and runs in Paperclip's own
  // workspace dir, so cwd is not a workable way to place a repo agent. A
  // git_worktree gives both lanes a real checkout, per issue.
  if (ws.workspaceStrategy) cfg.workspaceStrategy = { ...ws.workspaceStrategy }
  if (ws.cwd) cfg.cwd = ws.cwd

  if (agent.adapter.type === 'claude_local') {
    // Defaults to TRUE server-side. Written explicitly so no agent silently
    // gets unrestricted local tool use.
    cfg.dangerouslySkipPermissions = false
    cfg.maxTurnsPerRun = 60
  } else {
    cfg.dangerouslyBypassApprovalsAndSandbox = false
    cfg.search = false
    cfg.fastMode = false
    cfg.outputInactivityTimeoutMs = 900000
  }
  return cfg
}

// P4, offline half. adapterConfig is unvalidated server-side, so this is the only
// place a bad key is caught before it becomes a runtime mystery.
export function checkAdapterConfig(type, cfg, { platform = process.platform } = {}) {
  const problems = []
  const known = ADAPTER_KEYS[type]
  if (!known) return [`unknown adapter type '${type}'`]
  for (const k of Object.keys(cfg)) {
    if (!known.includes(k)) problems.push(`${type}: '${k}' is not a documented adapterConfig key — it will be accepted and ignored`)
  }
  if (platform !== 'linux') {
    for (const k of Object.keys(cfg)) {
      if (BUBBLEWRAP_KEYS.includes(k)) {
        problems.push(`${type}: '${k}' requires Bubblewrap, which is Linux only — on ${platform} every run fails with "bwrap was not found in PATH"`)
      }
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Bundle rendering.
//
// A pure function of the repo, on purpose: verification byte-diffs the live
// bundle against a fresh local render, so a hand-edit in the Paperclip UI shows
// up as drift instead of quietly becoming the real org.
//
// The reporting line is GENERATED from reportsTo, never hand-written, so the
// prose tree cannot diverge from the actual tree.
// ---------------------------------------------------------------------------

// Everyone who plays a named part in the design chain gets the chain fragment.
// Derived rather than listed, so adding a role does not silently leave its agent
// without the protocol it is expected to follow.
export function designChainMembers(dc) {
  return new Set([dc?.proposer, dc?.approver, dc?.researcher].filter(Boolean))
}

export function renderBundle(roster, agent, fragments) {
  const bySlug = new Map(roster.agents.map((a) => [a.slug, a]))
  const manager = agent.reportsTo != null ? bySlug.get(agent.reportsTo) : null
  const reports = roster.agents
    .filter((a) => a.reportsTo === agent.slug)
    .map((a) => a.name)
    .sort()

  const managerLine = manager
    ? `You report to **${manager.name}**.`
    : 'You report to **Ryan**, Founder and Board. You are the top of the AI organization.'
  const reportsLine = reports.length
    ? `Your direct reports are ${reports.map((n) => `**${n}**`).join(', ')}.`
    : 'You have no direct reports.'

  const dollars = (cents) => `$${(cents / 100).toFixed(2)}`
  const preamble = fragments['_preamble.md']
    .replaceAll('{{GOAL}}', roster.goal)
    .replaceAll('{{BUDGET_CENTS}}', String(agent.budgetMonthlyCents))
    .replaceAll('{{BUDGET_DOLLARS}}', dollars(agent.budgetMonthlyCents))

  const parts = [
    `<!-- Generated by tools/paperclip-org from pipeline/org/instructions/${agent.instructions} —`,
    `     roster v${roster.version}, slug ${agent.slug}. Edit the source, not this file. -->`,
    '',
    `# ${agent.name} — ${agent.title}`,
    '',
    `${managerLine} ${reportsLine}`,
    '',
    fragments[agent.instructions].trim(),
    '',
    preamble.trim(),
  ]

  if (agent.workspace !== 'none') parts.push('', fragments['_repo-discipline.md'].trim())
  const dc = roster.designChain
  if (dc && designChainMembers(dc).has(agent.slug)) {
    parts.push('', fragments['_design-chain.md'].trim())
  } else if (agent.workspace === 'none') {
    parts.push('', [
      '## No code access',
      '',
      'You have no write access to application code, and the repository is not on your',
      'filesystem. If your work implies a code change, write a brief and hand it to your',
      'manager or to Head of Product. You never open a pull request.',
    ].join('\n'))
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

export function bundleSha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// Payload building
// ---------------------------------------------------------------------------

export function buildAgentPayload(roster, agent, bundleText, reportsToId, secretIds = null) {
  return {
    name: agent.name,
    role: agent.role,
    title: agent.title,
    icon: agent.icon,
    reportsTo: reportsToId ?? null,
    capabilities: agent.capabilities,
    desiredSkills: agent.desiredSkills ?? [],
    adapterType: agent.adapter.type,
    adapterConfig: composeAdapterConfig(roster, agent, secretIds),
    instructionsBundle: { entryFile: 'AGENTS.md', files: { 'AGENTS.md': bundleText } },
    runtimeConfig: {
      heartbeat: {
        enabled: false,
        wakeOnDemand: true,
        maxConcurrentRuns: agent.run.maxConcurrentRuns,
        cooldownSec: 300,
        intervalSec: 3600,
        skipTimerWhenNoActionableWork: true,
      },
    },
    budgetMonthlyCents: agent.budgetMonthlyCents,
    // canAssignTasks is NOT accepted at create time — applied in the permissions pass.
    permissions: {
      canCreateAgents: false,
      canCreateSkills: agent.permissions.canCreateSkills,
      trustPreset: agent.permissions.trustPreset,
    },
    metadata: {
      focx: {
        slug: agent.slug,
        rosterVersion: roster.version,
        tier: agent.tier,
        workspace: agent.workspace,
        git: agent.git,
        source: 'pipeline/org/roster.json',
        bundleSha256: bundleSha256(bundleText),
      },
    },
  }
}

export function buildRoutinePayload(roster, routine, assigneeAgentId) {
  return {
    title: routine.title,
    // Routines have no metadata field, so identity rides in the description.
    description: `focx-routine-key: ${routine.key}\n\n${routine.description}`,
    assigneeAgentId,
    priority: routine.priority,
    status: routine.status,
    concurrencyPolicy: routine.concurrencyPolicy,
    catchUpPolicy: routine.catchUpPolicy,
    activityGatePolicy: routine.activityGatePolicy,
    ...(routine.activityGateScope ? { activityGateScope: routine.activityGateScope } : {}),
  }
}

// ---------------------------------------------------------------------------
// Planning. Idempotency key is metadata.focx.slug, never name: names are
// editable in the Paperclip UI, and a name-keyed reconciler would create a
// duplicate the first time someone renames an agent.
// ---------------------------------------------------------------------------

export function liveSlug(liveAgent) {
  return liveAgent?.metadata?.focx?.slug ?? null
}

export function planActions(roster, live) {
  const liveAgents = (live.agents ?? []).filter((a) => a.status !== 'terminated')
  const liveRoutines = live.routines ?? []

  const bySlugLive = new Map()
  const unkeyed = []
  for (const a of liveAgents) {
    const s = liveSlug(a)
    if (s) bySlugLive.set(s, a)
    else unkeyed.push(a)
  }

  const create = []
  const update = []
  const adopt = []
  for (const slug of topoOrder(roster.agents)) {
    const want = roster.agents.find((a) => a.slug === slug)
    const have = bySlugLive.get(slug)
    if (have) { update.push({ slug, id: have.id }); continue }
    // One-time adoption: an exact NAME match with no focx metadata. Warns, then
    // writes the slug so the next run is slug-keyed. Never fuzzy.
    const byName = unkeyed.find((a) => a.name === want.name)
    if (byName) { adopt.push({ slug, id: byName.id, name: byName.name }); continue }
    create.push({ slug })
  }

  const keep = new Set(roster.agents.map((a) => a.slug))
  const adoptedIds = new Set(adopt.map((a) => a.id))
  const terminate = liveAgents
    .filter((a) => !adoptedIds.has(a.id))
    .filter((a) => { const s = liveSlug(a); return !s || !keep.has(s) })
    .map((a) => ({ id: a.id, name: a.name, status: a.status }))

  const routineCreate = []
  const routineUpdate = []
  for (const r of roster.routines) {
    const have = liveRoutines.find((x) => x.title === r.title)
    if (have) routineUpdate.push({ key: r.key, id: have.id })
    else routineCreate.push({ key: r.key })
  }

  return { create, update, adopt, terminate, routineCreate, routineUpdate }
}

// ---------------------------------------------------------------------------
// API client. Never logs the key or request headers.
// ---------------------------------------------------------------------------

export class PaperclipClient {
  constructor({ baseUrl, apiKey, timeoutMs = 20000 }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '')
    this.apiKey = apiKey
    this.timeoutMs = timeoutMs
  }

  async request(method, path, body) {
    const headers = { accept: 'application/json' }
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    let res
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      const why = err.name === 'TimeoutError' ? `timed out after ${this.timeoutMs}ms` : err.message
      throw new ApiError(`${method} ${path} — ${why}`, 0)
    }
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { /* non-JSON body */ }
    if (!res.ok) {
      const detail = json?.message ?? json?.error ?? (text ? text.slice(0, 300) : res.statusText)
      throw new ApiError(`${method} ${path} — ${res.status} ${detail}`, res.status)
    }
    return json
  }

  get(p) { return this.request('GET', p) }
  post(p, b) { return this.request('POST', p, b) }
  patch(p, b) { return this.request('PATCH', p, b) }
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status }
}

const listOf = (r) => (Array.isArray(r) ? r : (r?.data ?? r?.items ?? r?.agents ?? r?.routines ?? []))

// ---------------------------------------------------------------------------
// Verification — Ryan's twelve success conditions, mechanically.
// ---------------------------------------------------------------------------

export function verify(roster, live, renderedBySlug) {
  const rows = []
  const check = (n, condition, pass, detail = '') => rows.push({ n, condition, pass, detail })

  const all = live.agents ?? []
  const active = all.filter((a) => a.status !== 'terminated')
  const bySlug = new Map(active.map((a) => [liveSlug(a), a]).filter(([s]) => s))
  const want = new Map(roster.agents.map((a) => [a.slug, a]))
  const cfg = live.configurations ?? new Map()

  const rootWanted = roster.agents.find((a) => a.reportsTo == null)
  const liveRoots = active.filter((a) => !a.reportsTo)
  check(1, 'Ryan sits above the org as Board',
    liveRoots.length === 1 && liveSlug(liveRoots[0]) === rootWanted.slug,
    liveRoots.length === 1 ? `root is ${liveRoots[0].name}` : `${liveRoots.length} roots`)

  const rootReports = active.filter((a) => a.reportsTo === liveRoots[0]?.id)
  check(2, 'CEO is the top AI executive with 6 direct reports',
    liveRoots.length === 1 && rootReports.length === 6, `${rootReports.length} direct reports`)

  const orphans = active.filter((a) => a.reportsTo && !active.some((x) => x.id === a.reportsTo))
  check(3, 'Every agent has exactly one manager',
    orphans.length === 0 && active.every((a) => a.reportsTo || a.id === liveRoots[0]?.id),
    orphans.length ? `orphans: ${orphans.map((o) => o.name).join(', ')}` : '')

  const treeBad = []
  for (const [slug, a] of bySlug) {
    const w = want.get(slug)
    if (!w) { treeBad.push(`${slug} not in roster`); continue }
    const wantMgr = w.reportsTo ? bySlug.get(w.reportsTo)?.id ?? null : null
    if ((a.reportsTo ?? null) !== wantMgr) treeBad.push(`${slug} reports to the wrong agent`)
  }
  // Derived from the roster, never hardcoded: adding an agent must not require
  // editing the check that is supposed to notice agents being added.
  const managers = [...new Set(roster.agents.map((a) => a.reportsTo).filter(Boolean))]
  const teamSize = (m) => roster.agents.filter((a) => a.reportsTo === m).length
  const teams = managers.map((m) => `${m}:${teamSize(m)}`).sort().join(' ')
  check(4, `Reporting lines match the roster (${teams})`,
    treeBad.length === 0 && active.length === roster.expectedAgentCount,
    treeBad.slice(0, 3).join('; '))

  const modelBad = []
  for (const [slug, a] of bySlug) {
    const w = want.get(slug); if (!w) continue
    const c = cfg.get(a.id)?.adapterConfig ?? {}
    const spec = REASONING[w.adapter.type]
    if ((cfg.get(a.id)?.adapterType ?? a.adapterType) !== w.adapter.type) modelBad.push(`${slug} adapter`)
    else if (c.model !== w.adapter.model) modelBad.push(`${slug} model=${c.model}`)
    else if (c[spec.key] !== w.adapter.reasoning) modelBad.push(`${slug} ${spec.key}=${c[spec.key]}`)
  }
  const designModels = ['product-designer', 'design-steward']
    .every((s) => (cfg.get(bySlug.get(s)?.id)?.adapterConfig ?? {}).model === 'claude-opus-5')
  check(5, 'Models and reasoning assigned per role; both design agents on Opus 5',
    modelBad.length === 0 && designModels, modelBad.slice(0, 3).join('; '))

  const budgetBad = active.filter((a) => a.budgetMonthlyCents !== 200).map((a) => a.name)
  check(6, 'Every agent has a $2.00/month ceiling', budgetBad.length === 0, budgetBad.slice(0, 3).join(', '))

  const totalWant = roster.agents.length * 200
  check(7, 'Company ceiling is $60.00 and agent budgets fit inside it',
    (live.company?.budgetMonthlyCents ?? 0) === roster.company.budgetMonthlyCents && totalWant <= roster.company.budgetMonthlyCents,
    `${totalWant} of ${roster.company.budgetMonthlyCents} cents`)

  const routineBad = []
  for (const r of roster.routines) {
    const lr = (live.routines ?? []).find((x) => x.title === r.title)
    if (!lr) { routineBad.push(`${r.key} missing`); continue }
    if (lr.assigneeAgentId !== bySlug.get(r.owner)?.id) routineBad.push(`${r.key} wrong assignee`)
    const trig = (live.triggers?.get(lr.id) ?? []).filter((t) => t.kind === 'schedule' && t.enabled)
    if (trig.length !== 1) routineBad.push(`${r.key} has ${trig.length} enabled schedule triggers`)
    else if (trig[0].cronExpression !== r.cron || trig[0].timezone !== r.timezone) routineBad.push(`${r.key} cron/timezone mismatch`)
  }
  check(8, `${roster.routines.length} routines active, one enabled schedule trigger each`,
    routineBad.length === 0, routineBad.slice(0, 3).join('; '))

  const wakeBad = []
  for (const [slug, a] of bySlug) {
    const w = want.get(slug); if (!w) continue
    const hb = (cfg.get(a.id)?.runtimeConfig ?? {}).heartbeat ?? {}
    if (hb.enabled !== false) wakeBad.push(`${slug} heartbeat on`)
    if (hb.wakeOnDemand !== true) wakeBad.push(`${slug} wakeOnDemand off`)
    if (hb.maxConcurrentRuns !== w.run.maxConcurrentRuns) wakeBad.push(`${slug} concurrency ${hb.maxConcurrentRuns}`)
  }
  check(9, 'Agents wake from work and routines, not polling', wakeBad.length === 0, wakeBad.slice(0, 3).join('; '))

  const bundleBad = []
  for (const [slug, a] of bySlug) {
    const wantText = renderedBySlug?.get(slug)
    const liveText = live.bundles?.get(a.id)
    if (wantText && liveText !== undefined && liveText !== wantText) bundleBad.push(slug)
  }
  // Every non-root agent sits under exactly one department head, and every
  // department head is itself a direct report of the root.
  const rootSlug = roster.agents.find((a) => a.reportsTo == null)?.slug
  const deptHeads = roster.agents.filter((a) => a.reportsTo === rootSlug).map((a) => a.slug)
  const deptOk = roster.agents.every((a) =>
    a.slug === rootSlug || a.reportsTo === rootSlug || deptHeads.includes(a.reportsTo))
  check(10, 'Departments separated; live bundles match a fresh local render',
    bundleBad.length === 0 && deptOk, bundleBad.length ? `drifted: ${bundleBad.slice(0, 3).join(', ')}` : '')

  const dc = roster.designChain
  // Independence moved from "QA has a unique cwd" to git enforcing it: QA works
  // its own child issue, so the default {{issue.identifier}}-{{slug}} template
  // gives it a different branch and directory from the build it verifies.
  const verifier = roster.independence?.verifier ?? 'qa-engineer'
  const qaStrategy = (cfg.get(bySlug.get(verifier)?.id)?.adapterConfig ?? {}).workspaceStrategy
  const qaUnique = qaStrategy?.type === 'git_worktree'
    && String(qaStrategy.baseRef ?? '').includes('/')
    && !qaStrategy.branchTemplate
  const stewardEnv = (cfg.get(bySlug.get(dc.approver)?.id)?.adapterConfig ?? {}).env ?? {}
  const stewardNoToken = !('GH_TOKEN' in stewardEnv)
  const hireBad = active.filter((a) => (cfg.get(a.id)?.permissions ?? {}).canCreateAgents === true)
  const assignBad = []
  for (const [slug, a] of bySlug) {
    const w = want.get(slug); if (!w) continue
    if (((cfg.get(a.id)?.permissions ?? {}).canAssignTasks ?? false) !== (w.tier === 'manager')) assignBad.push(slug)
  }
  check(11, 'Implementation and verification independent, in both chains',
    qaUnique && stewardNoToken && hireBad.length === 0 && assignBad.length === 0 && dc.proposer !== dc.approver,
    [!qaUnique && `${verifier} is not on a per-issue worktree`, !stewardNoToken && 'Design Steward has GH_TOKEN',
      hireBad.length && 'canCreateAgents true somewhere', assignBad.length && `canAssignTasks wrong: ${assignBad.slice(0, 2)}`]
      .filter(Boolean).join('; '))

  const goalMissing = [...(renderedBySlug ?? new Map())].filter(([, t]) => !t.includes(roster.goal)).map(([s]) => s)
  check(12, 'The whole org is pointed at the 2,000-user goal',
    goalMissing.length === 0 && active.length === roster.expectedAgentCount,
    goalMissing.length ? `missing goal: ${goalMissing.slice(0, 3).join(', ')}` : `${active.length} agents`)

  // Env and secrets, checked alongside the twelve.
  const envBad = []
  for (const [slug, a] of bySlug) {
    const w = want.get(slug); if (!w) continue
    const env = (cfg.get(a.id)?.adapterConfig ?? {}).env ?? {}
    if (!env.PATH) envBad.push(`${slug} no PATH`)
    const wantsClaude = w.adapter.type === 'claude_local'
    if (wantsClaude !== ('CLAUDE_CODE_OAUTH_TOKEN' in env)) envBad.push(`${slug} claude token mismatch`)
    const wantsGit = w.git === 'write'
    if (wantsGit !== ('GH_TOKEN' in env)) envBad.push(`${slug} GH_TOKEN mismatch`)
    const wantsWorktree = Boolean(roster.workspaces?.[w.workspace]?.workspaceStrategy)
    const hasWorktree = Boolean((cfg.get(a.id)?.adapterConfig ?? {}).workspaceStrategy)
    if (wantsWorktree !== hasWorktree) envBad.push(`${slug} workspaceStrategy mismatch`)
    // Presence is not enough: a bare string is stored as { type: "plain" }, which
    // is how every agent once ended up with a literal "[secret: name]" for a token.
    for (const key of ['CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN']) {
      const v = env[key]
      if (v && v.type !== 'secret_ref') envBad.push(`${slug} ${key} is type '${v.type ?? typeof v}', not secret_ref`)
    }
    for (const v of Object.values(env)) {
      const s = typeof v === 'object' ? String(v.value ?? '') : String(v)
      for (const p of CREDENTIAL_PATTERNS) if (p.test(s)) { envBad.push(`${slug} literal credential in env`); break }
    }
    for (const problem of checkAdapterConfig(w.adapter.type, cfg.get(a.id)?.adapterConfig ?? {})) envBad.push(`${slug} ${problem}`)
  }
  rows.push({ n: '—', condition: 'env and secrets composed correctly', pass: envBad.length === 0, detail: envBad.slice(0, 3).join('; ') })

  return rows
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function loadRoster(rosterPath) {
  const roster = JSON.parse(readFileSync(rosterPath, 'utf8'))
  const dir = join(dirname(rosterPath), 'instructions')
  const fragments = {}
  const names = new Set()
  for (const a of roster.agents ?? []) names.add(a.instructions)
  for (const f of ['_preamble.md', '_repo-discipline.md', '_design-chain.md']) names.add(f)
  const missing = []
  for (const n of names) {
    const p = join(dir, n)
    if (!existsSync(p)) { missing.push(n); continue }
    const text = readFileSync(p, 'utf8')
    if (!text.trim()) { missing.push(`${n} (empty)`); continue }
    fragments[n] = text
  }
  return { roster, fragments, instructionFiles: new Set(Object.keys(fragments)), missing }
}

export function renderAll(roster, fragments) {
  const out = new Map()
  for (const a of roster.agents) out.set(a.slug, renderBundle(roster, a, fragments))
  return out
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const C = { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', bold: '\x1b[1m', off: '\x1b[0m' }
const paint = (c, s) => (process.stdout.isTTY ? `${c}${s}${C.off}` : s)
const ok = (s) => paint(C.green, s)
const bad = (s) => paint(C.red, s)
const warn = (s) => paint(C.yellow, s)

function parseArgs(argv) {
  const flags = { apply: false, verifyOnly: false, renderOnly: false, json: false, roster: null, confirmTerminate: null, allowBuiltinTermination: false, terminateRunning: false }
  for (const arg of argv) {
    if (arg === '--apply') flags.apply = true
    else if (arg === '--verify-only') flags.verifyOnly = true
    else if (arg === '--render-only') flags.renderOnly = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--allow-builtin-termination') flags.allowBuiltinTermination = true
    else if (arg === '--terminate-running') flags.terminateRunning = true
    else if (arg.startsWith('--confirm-terminate=')) flags.confirmTerminate = Number(arg.split('=')[1])
    else if (arg.startsWith('--roster=')) flags.roster = arg.split('=')[1]
    else if (arg === '--help' || arg === '-h') flags.help = true
    else return { error: `unknown flag: ${arg}` }
  }
  if (flags.apply && (flags.verifyOnly || flags.renderOnly)) return { error: '--apply cannot be combined with --verify-only or --render-only' }
  return { flags }
}

const USAGE = `paperclip-org — reconcile Paperclip to pipeline/org/roster.json

  node tools/paperclip-org/index.mjs                     dry run (default), mutates nothing
  node tools/paperclip-org/index.mjs --apply --confirm-terminate=N
  node tools/paperclip-org/index.mjs --verify-only       read-only success-condition check
  node tools/paperclip-org/index.mjs --render-only       render bundles offline, no credential

  --roster=<path>              default pipeline/org/roster.json
  --json                       machine-readable output
  --allow-builtin-termination  required if a termination target is platform-managed
  --terminate-running          required if a termination target has a live run

Env: PAPERCLIP_API_URL (default http://127.0.0.1:3100), PAPERCLIP_API_KEY, PAPERCLIP_COMPANY_ID
Exit: 0 clean · 1 verification failed · 2 usage/roster · 3 preflight · 4 partial apply`

async function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.error) { console.error(`paperclip-org: ${parsed.error}\n\n${USAGE}`); return 2 }
  const flags = parsed.flags
  if (flags.help) { console.log(USAGE); return 0 }

  const rosterPath = resolve(flags.roster ?? join(REPO_ROOT, 'pipeline/org/roster.json'))
  if (!existsSync(rosterPath)) { console.error(`paperclip-org: roster not found at ${rosterPath}`); return 2 }

  let loaded
  try { loaded = loadRoster(rosterPath) } catch (err) { console.error(`paperclip-org: cannot read roster — ${err.message}`); return 2 }
  const { roster, fragments, instructionFiles, missing } = loaded
  if (missing.length) { console.error(bad(`paperclip-org: missing or empty instruction files: ${missing.join(', ')}`)); return 2 }

  // ---- P0: offline roster self-validation --------------------------------
  const errors = validateRoster(roster, { instructionFiles })
  errors.push(...checkCharterCoupling(roster, (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8')))
  if (errors.length) {
    console.error(bad(`paperclip-org: roster has ${errors.length} problem(s):`))
    for (const e of errors) console.error(`  - ${e}`)
    return 2
  }
  const totalCents = roster.agents.reduce((n, a) => n + a.budgetMonthlyCents, 0)
  console.log(`${paint(C.bold, 'Roster')}  ${roster.agents.length} agents · ${roster.routines.length} routines · v${roster.version}`)
  console.log(`${paint(C.bold, 'Budget')}  ${roster.agents.length} × 200 = ${totalCents} cents ($${(totalCents / 100).toFixed(2)}) of ${roster.company.budgetMonthlyCents} cents ($${(roster.company.budgetMonthlyCents / 100).toFixed(2)}) — headroom $${((roster.company.budgetMonthlyCents - totalCents) / 100).toFixed(2)}`)
  console.log(ok('P0  roster self-validation passed'))

  const rendered = renderAll(roster, fragments)

  if (flags.renderOnly) {
    let bytes = 0
    for (const [slug, text] of rendered) bytes += Buffer.byteLength(text, 'utf8')
    console.log(ok(`     rendered ${rendered.size} bundles offline (${bytes} bytes total)`))
    if (flags.json) console.log(JSON.stringify(Object.fromEntries(rendered), null, 2))
    return 0
  }

  // ---- credential ---------------------------------------------------------
  const baseUrl = process.env.PAPERCLIP_API_URL ?? 'http://127.0.0.1:3100'
  const apiKey = process.env.PAPERCLIP_API_KEY
  const envCompany = process.env.PAPERCLIP_COMPANY_ID
  if (envCompany && envCompany !== roster.company.id) {
    console.error(bad(`paperclip-org: PAPERCLIP_COMPANY_ID (${envCompany}) does not match roster.company.id (${roster.company.id})`))
    return 2
  }
  const companyId = envCompany ?? roster.company.id
  if (!apiKey) {
    console.error(bad('paperclip-org: PAPERCLIP_API_KEY is not set.'))
    console.error('  This is a human-only step. Ryan must run, in his own shell:')
    console.error('    paperclipai auth login')
    console.error('    paperclipai token board create --name "focx-org-reconciler"')
    console.error('  then export PAPERCLIP_API_KEY. Never attempt the login from an agent.')
    return 3
  }

  const api = new PaperclipClient({ baseUrl, apiKey })

  // ---- P1 health ----------------------------------------------------------
  try {
    const health = await new PaperclipClient({ baseUrl, apiKey: null, timeoutMs: 3000 }).get('/api/health')
    if (health?.status !== 'ok') { console.error(bad(`P1  unhealthy — status ${health?.status}`)); return 3 }
    console.log(ok(`P1  service healthy at ${baseUrl}`))
  } catch (err) { console.error(bad(`P1  unreachable — ${err.message}`)); return 3 }

  // ---- P2/P3 auth and company --------------------------------------------
  let company
  try {
    company = await api.get(`/api/companies/${companyId}`)
  } catch (err) {
    if (err.status === 401) console.error(bad('P2  unauthenticated — the board token is missing or invalid. Ryan: paperclipai token board create'))
    else if (err.status === 403) console.error(bad('P2  authenticated, but this token lacks board scope for that company'))
    else console.error(bad(`P2  ${err.message}`))
    return 3
  }
  console.log(ok(`P2  authenticated · P3 company ${company.name ?? companyId}`))

  const result = { plan: null, verification: null }

  // ---- P4/P5 adapter schema and model catalog ----------------------------
  const adapterTypes = [...new Set(roster.agents.map((a) => a.adapter.type))]
  for (const t of adapterTypes) {
    try {
      const models = listOf(await api.get(`/api/companies/${companyId}/adapters/${t}/models`))
      const ids = new Set(models.map((m) => m.id ?? m))
      const wanted = [...new Set(roster.agents.filter((a) => a.adapter.type === t).map((a) => a.adapter.model))]
      const unknown = wanted.filter((m) => !ids.has(m))
      if (unknown.length) {
        console.error(bad(`P5  model(s) not in the live ${t} catalog: ${unknown.join(', ')}`))
        for (const m of unknown) if (REJECTED_MODELS[m]) console.error(`      ${m}: ${REJECTED_MODELS[m]}`)
        return 3
      }
    } catch (err) {
      console.error(warn(`P5  could not read the ${t} model catalog (${err.message}) — offline enum check stands, but the live catalog was not confirmed`))
    }
  }
  console.log(ok(`P5  models validated against the live catalog`))

  // ---- P7 skills ----------------------------------------------------------
  //
  // Only desiredSkills is checked, because only desiredSkills is sent to
  // Paperclip. claudeCodeSkills names Claude Code plugin skills, which come from
  // the local Claude Code install and are never in Paperclip's registry —
  // checking them here would fail every time, for the wrong reason.
  const wantedSkills = [...new Set(roster.agents.flatMap((a) => a.desiredSkills ?? []))]
  if (wantedSkills.length) {
    try {
      const skills = listOf(await api.get(`/api/companies/${companyId}/skills`))
      const have = new Set(skills.flatMap((s) => [s.id, s.key, s.slug, s.name].filter(Boolean)))
      const unresolved = wantedSkills.filter((s) => !have.has(s))
      if (unresolved.length) {
        console.error(bad(`P7  Paperclip skill(s) not in the company registry: ${unresolved.join(', ')}`))
        console.error(`      registry holds: ${[...have].filter((k) => String(k).includes('/')).join(', ') || '(none)'}`)
        return 3
      }
      console.log(ok(`P7  ${wantedSkills.length} Paperclip skill(s) resolve`))
    } catch (err) {
      console.log(warn(`P7  could not read the skills registry (${err.message}) — skills not confirmed`))
    }
  } else {
    console.log(ok('P7  no Paperclip-registry skills requested'))
  }
  const ccSkills = [...new Set(roster.agents.flatMap((a) => a.claudeCodeSkills ?? []))]
  if (ccSkills.length) {
    const discoveryOnly = new Set(roster.designChain?.discoveryOnlySkills ?? [])
    const gated = ccSkills.filter((s) => discoveryOnly.has(s))
    console.log(paint(C.dim, `     Claude Code plugin skills (local CLI, not Paperclip): ${ccSkills.join(', ')}`))
    if (gated.length) console.log(paint(C.dim, `     discovery-mode design needs ${gated.join(' + ')} present in the local Claude Code install`))
  }

  // ---- P8 secret references ----------------------------------------------
  const declared = (roster.secrets ?? []).map((s) => s.name)
  const secretIds = new Map()
  if (declared.length) {
    try {
      const secrets = listOf(await api.get(`/api/companies/${companyId}/secrets`))
      for (const s of secrets) {
        for (const n of [s.name, s.key].filter(Boolean)) if (s.id) secretIds.set(n, s.id)
      }
      const have = new Set(secretIds.keys())
      const absent = declared.filter((n) => !have.has(n))
      if (absent.length) {
        console.error(bad(`P8  secret(s) not found in the Paperclip store: ${absent.join(', ')}`))
        console.error('      A dangling reference is accepted at create time and fails at RUN time, as an')
        console.error('      agent that starts and can authenticate to nothing. Ryan must create these first.')
        return 3
      }
      console.log(ok(`P8  all ${declared.length} secret name(s) resolved to ids`))
    } catch (err) {
      console.error(bad(`P8  could not read the secret store (${err.message})`))
      console.error('      Refusing to continue: without resolved ids the tool would write plain values,')
      console.error('      and every agent would start with a literal string where its token should be.')
      return 3
    }
  }

  // ---- P9 live inventory --------------------------------------------------
  const live = { agents: [], routines: [], company, configurations: new Map(), bundles: new Map(), triggers: new Map() }
  live.agents = listOf(await api.get(`/api/companies/${companyId}/agents`))
  try { live.routines = listOf(await api.get(`/api/companies/${companyId}/routines`)) } catch { live.routines = [] }
  console.log(ok(`P9  live: ${live.agents.filter((a) => a.status !== 'terminated').length} active agents, ${live.routines.length} routines`))

  // ---- project checkout ---------------------------------------------------
  //
  // Worktrees are cut from the Connect project's checkout, and Paperclip owns
  // that directory. The tool checks the project EXISTS rather than reaching into
  // its filesystem — and leans on P0 having already rejected any baseRef that
  // would skip the pre-branch fetch.
  let workspacesReady = true
  const worktreeAgents = roster.agents.filter((a) => roster.workspaces?.[a.workspace]?.workspaceStrategy)
  if (worktreeAgents.length) {
    try {
      const project = await api.get(`/api/projects/${roster.project.id}`)
      const name = project?.project?.name ?? project?.name
      if (!name) throw new ApiError('project returned no name', 0)
      const refs = [...new Set(worktreeAgents.map((a) => roster.workspaces[a.workspace].workspaceStrategy.baseRef))]
      console.log(ok(`     project '${name}' backs ${worktreeAgents.length} worktree agent(s) from ${refs.join(', ')}`))
    } catch (err) {
      console.error(bad(`     project ${roster.project?.id} is not reachable — ${err.message}`))
      console.error('       Worktrees are cut from its checkout; without it no repo-tier agent has a workspace.')
      workspacesReady = false
    }
  }

  // ---- plan ---------------------------------------------------------------
  const plan = planActions(roster, live)
  result.plan = plan
  console.log('')
  console.log(paint(C.bold, 'Plan'))
  console.log(`  terminate ${plan.terminate.length}${plan.terminate.length ? ': ' + plan.terminate.map((t) => t.name).join(', ') : ''}`)
  console.log(`  create    ${plan.create.length}`)
  console.log(`  update    ${plan.update.length}`)
  if (plan.adopt.length) console.log(warn(`  adopt     ${plan.adopt.length}: ${plan.adopt.map((a) => a.name).join(', ')} (name-matched, will be given metadata.focx.slug)`))
  console.log(`  routines  ${plan.routineCreate.length} create, ${plan.routineUpdate.length} update`)

  if (!flags.apply) {
    if (flags.verifyOnly) return await runVerify(api, companyId, roster, live, rendered, flags)
    console.log('')
    console.log(paint(C.dim, `Dry run — nothing was changed. To apply: --apply --confirm-terminate=${plan.terminate.length}`))
    if (flags.json) console.log(JSON.stringify(result, null, 2))
    return 0
  }

  if (flags.confirmTerminate !== plan.terminate.length) {
    console.error(bad(`paperclip-org: --confirm-terminate=${flags.confirmTerminate ?? '(absent)'} does not match the ${plan.terminate.length} termination(s) planned. Nothing was changed.`))
    return 2
  }

  if (!workspacesReady) {
    console.error(bad(`paperclip-org: refusing to apply with ${missingWorkspaces.length} missing workspace(s).`))
    console.error('  An agent pointed at an empty directory starts fine and then has no repository at all —')
    console.error("  it is a failure that looks like success. Create the checkouts listed above, then re-run.")
    return 3
  }

  return await runApply(api, companyId, roster, live, rendered, plan, flags, secretIds)
}

// ---------------------------------------------------------------------------
// Apply. Ordered so that a mid-run failure leaves a uniform state rather than a
// half-configured org: terminate, create (parents first), then one sweep each
// for permissions, skills, budgets and routines.
//
// `mutated` flips on the first successful write. Any failure after that point
// exits 4 rather than 3 — a rerun is safe because every step is idempotent, but
// it must be a deliberate act, not a blind retry.
// ---------------------------------------------------------------------------

async function runApply(api, companyId, roster, live, rendered, plan, flags, secretIds) {
  let mutated = false
  const step = (label) => console.log(paint(C.bold, `\n${label}`))
  const fail = (msg) => { console.error(bad(`  ${msg}`)); return mutated ? 4 : 3 }

  // --- A: terminate ------------------------------------------------------
  if (plan.terminate.length) {
    step(`A  terminate ${plan.terminate.length}`)
    // A rollback record first. Deliberately a Paperclip export rather than a repo
    // file: live org state lives in Paperclip, and pipeline/org/snapshots/ would be
    // a second home for it, which AGENTS.md forbids.
    try {
      await api.post(`/api/companies/${companyId}/exports`, { reason: 'pre-rebuild snapshot' })
      console.log(`  ${ok('exported')} pre-change snapshot`)
    } catch (err) {
      console.log(warn(`  could not take a pre-change export (${err.message})`))
      if (!flags.terminateRunning) {
        console.error(bad('  refusing to terminate without a rollback record — re-run with --terminate-running only if you accept that'))
        return 3
      }
    }
    for (const t of plan.terminate) {
      let state = null
      try { state = await api.get(`/api/agents/${t.id}/runtime-state`) } catch { /* treated as unknown below */ }
      const running = t.status === 'running' || state?.status === 'running' || (state?.activeRuns ?? 0) > 0
      if (running && !flags.terminateRunning) {
        return fail(`${t.name} has a live run — pass --terminate-running to proceed, or wait for it to finish`)
      }
      try {
        // Pause first: reversible, and it stops new work being picked up mid-teardown.
        await api.post(`/api/agents/${t.id}/pause`, { reason: 'org rebuild: pipeline/org/roster.json' })
        mutated = true
        await api.post(`/api/agents/${t.id}/terminate`, { reason: 'org rebuild: not present in pipeline/org/roster.json' })
        console.log(`  ${ok('terminated')} ${t.name}`)
      } catch (err) { return fail(`terminating ${t.name}: ${err.message}`) }
    }
  }

  // --- B: create, parents before children --------------------------------
  const idBySlug = new Map()
  for (const a of live.agents) { const s = liveSlug(a); if (s) idBySlug.set(s, a.id) }
  for (const a of plan.adopt) idBySlug.set(a.slug, a.id)

  const toCreate = new Set(plan.create.map((c) => c.slug))
  const created = []
  if (toCreate.size) step(`B  create ${toCreate.size}, in reporting order`)
  for (const slug of topoOrder(roster.agents)) {
    if (!toCreate.has(slug)) continue
    const agent = roster.agents.find((x) => x.slug === slug)
    const parentId = agent.reportsTo != null ? idBySlug.get(agent.reportsTo) : null
    if (agent.reportsTo != null && !parentId) return fail(`${slug}: manager '${agent.reportsTo}' has no id yet — topological order was violated`)
    const payload = buildAgentPayload(roster, agent, rendered.get(slug), parentId, secretIds)
    try {
      const res = await api.post(`/api/companies/${companyId}/agents`, payload)
      mutated = true
      const id = res?.id ?? res?.agent?.id
      if (!id) return fail(`${slug}: create returned no id`)
      idBySlug.set(slug, id)
      created.push(slug)
      console.log(`  ${ok('created')} ${agent.name}`)
    } catch (err) {
      if (err.status === 409) return fail(`${slug}: ${err.message}\n     direct creation may require board approval — use agent-hires, or ask Ryan to allow it`)
      return fail(`creating ${slug}: ${err.message}`)
    }
  }

  // --- adopt + update: converge everything that already exists ------------
  const existing = roster.agents.filter((a) => !created.includes(a.slug) && idBySlug.has(a.slug))
  if (existing.length) {
    step(`B' converge ${existing.length} existing`)
    for (const agent of existing) {
      const parentId = agent.reportsTo != null ? idBySlug.get(agent.reportsTo) : null
      const payload = buildAgentPayload(roster, agent, rendered.get(agent.slug), parentId, secretIds)
      delete payload.permissions // not accepted on PATCH
      try {
        await api.patch(`/api/agents/${idBySlug.get(agent.slug)}`, { ...payload, replaceAdapterConfig: true })
        mutated = true
      } catch (err) { return fail(`updating ${agent.slug}: ${err.message}`) }
    }
    console.log(`  ${ok('converged')} ${existing.length} agents`)
  }

  // --- C: permissions. canAssignTasks is NOT settable at create time, and
  //     managers who cannot assign work make the whole org inert. ----------
  step(`C  permissions sweep (${roster.agents.length})`)
  for (const agent of roster.agents) {
    try {
      await api.patch(`/api/agents/${idBySlug.get(agent.slug)}/permissions`, {
        canCreateAgents: false,
        canCreateSkills: agent.permissions.canCreateSkills,
        canAssignTasks: agent.permissions.canAssignTasks,
        trustPreset: agent.permissions.trustPreset,
      })
      mutated = true
    } catch (err) { return fail(`permissions for ${agent.slug}: ${err.message}`) }
  }
  console.log(`  ${ok('set')} canAssignTasks on ${roster.agents.filter((a) => a.permissions.canAssignTasks).length} managers, false elsewhere`)

  // --- D: skills ----------------------------------------------------------
  const withSkills = roster.agents.filter((a) => (a.desiredSkills ?? []).length)
  if (withSkills.length) {
    step(`D  skills sync (${withSkills.length})`)
    for (const agent of withSkills) {
      try { await api.post(`/api/agents/${idBySlug.get(agent.slug)}/skills/sync`, { desiredSkills: agent.desiredSkills }); mutated = true }
      catch (err) { console.log(warn(`  ${agent.slug}: skills sync failed — ${err.message}`)) }
    }
  }

  // --- E: budgets ---------------------------------------------------------
  step('E  budgets and policies')
  try {
    await api.patch(`/api/companies/${companyId}/budgets`, { budgetMonthlyCents: roster.company.budgetMonthlyCents })
    mutated = true
  } catch (err) { return fail(`company budget: ${err.message}`) }
  for (const agent of roster.agents) {
    try { await api.patch(`/api/agents/${idBySlug.get(agent.slug)}/budgets`, { budgetMonthlyCents: agent.budgetMonthlyCents }); mutated = true }
    catch (err) { return fail(`budget for ${agent.slug}: ${err.message}`) }
  }
  const pol = roster.budgetPolicy
  try {
    await api.post(`/api/companies/${companyId}/budgets/policies`, {
      scopeType: 'company', scopeId: companyId, metric: 'billed_cents',
      windowKind: pol.company.windowKind, amount: roster.company.budgetMonthlyCents,
      warnPercent: pol.company.warnPercent, hardStopEnabled: pol.company.hardStopEnabled,
      notifyEnabled: pol.company.notifyEnabled, isActive: true,
    })
    for (const agent of roster.agents) {
      await api.post(`/api/companies/${companyId}/budgets/policies`, {
        scopeType: 'agent', scopeId: idBySlug.get(agent.slug), metric: 'billed_cents',
        windowKind: pol.agent.windowKind, amount: agent.budgetMonthlyCents,
        warnPercent: pol.agent.warnPercent, hardStopEnabled: pol.agent.hardStopEnabled,
        notifyEnabled: pol.agent.notifyEnabled, isActive: true,
      })
    }
    console.log(`  ${ok('set')} 1 company policy (hard stop) + ${roster.agents.length} agent policies (warn only)`)
  } catch (err) { return fail(`budget policy: ${err.message}`) }

  // --- F: routines. There is no upsert for triggers — a blind second POST
  //     stacks a duplicate schedule that double-fires. Read, then write. ---
  step(`F  routines (${roster.routines.length})`)
  for (const r of roster.routines) {
    const assignee = idBySlug.get(r.owner)
    const payload = buildRoutinePayload(roster, r, assignee)
    let routineId = plan.routineUpdate.find((x) => x.key === r.key)?.id ?? null
    try {
      if (routineId) await api.patch(`/api/routines/${routineId}`, payload)
      else {
        const res = await api.post(`/api/companies/${companyId}/routines`, payload)
        routineId = res?.id ?? res?.routine?.id
        if (!routineId) return fail(`routine ${r.key}: create returned no id`)
      }
      mutated = true
    } catch (err) { return fail(`routine ${r.key}: ${err.message}`) }

    let triggers = []
    try {
      const full = await api.get(`/api/routines/${routineId}`)
      triggers = full?.triggers ?? full?.routine?.triggers ?? []
    } catch { /* treat as none, and create below */ }
    const schedules = triggers.filter((t) => t.kind === 'schedule')
    const body = { kind: 'schedule', cronExpression: r.cron, timezone: r.timezone, enabled: true, label: r.key }
    try {
      if (schedules.length === 0) await api.post(`/api/routines/${routineId}/triggers`, body)
      else {
        await api.patch(`/api/routine-triggers/${schedules[0].id}`, body)
        for (const extra of schedules.slice(1)) {
          await api.patch(`/api/routine-triggers/${extra.id}`, { enabled: false })
          console.log(warn(`  ${r.key}: disabled a duplicate schedule trigger`))
        }
      }
      mutated = true
      console.log(`  ${ok(routineId ? 'ok' : 'created')} ${r.title} — ${r.cron} ${r.timezone}`)
    } catch (err) { return fail(`trigger for ${r.key}: ${err.message}`) }
  }

  // --- G: verify -----------------------------------------------------------
  step('G  verify')
  const fresh = { agents: [], routines: [], company: live.company, configurations: new Map(), bundles: new Map(), triggers: new Map() }
  try {
    fresh.agents = listOf(await api.get(`/api/companies/${companyId}/agents`))
    fresh.routines = listOf(await api.get(`/api/companies/${companyId}/routines`))
    fresh.company = await api.get(`/api/companies/${companyId}`)
  } catch (err) { console.error(warn(`  could not re-read live state: ${err.message}`)); return 4 }
  return await runVerify(api, companyId, roster, fresh, rendered, flags)
}

async function runVerify(api, companyId, roster, live, rendered, flags) {
  for (const a of live.agents.filter((x) => x.status !== 'terminated')) {
    try { live.configurations.set(a.id, await api.get(`/api/agents/${a.id}/configuration`)) } catch { /* reported as a failed row */ }
    try {
      const b = await api.get(`/api/agents/${a.id}/instructions-bundle`)
      const text = b?.files?.['AGENTS.md'] ?? b?.content ?? null
      if (text != null) live.bundles.set(a.id, text)
    } catch { /* reported as a failed row */ }
  }
  for (const r of live.routines) {
    try { live.triggers.set(r.id, listOf(await api.get(`/api/routines/${r.id}`))?.triggers ?? (await api.get(`/api/routines/${r.id}`))?.triggers ?? []) } catch { live.triggers.set(r.id, []) }
  }
  const rows = verify(roster, live, rendered)
  console.log('')
  console.log(paint(C.bold, 'Success conditions'))
  for (const r of rows) {
    const mark = r.pass ? ok('PASS') : bad('FAIL')
    console.log(`  ${String(r.n).padStart(2)}  ${mark}  ${r.condition}${r.pass || !r.detail ? '' : `\n         ${paint(C.dim, r.detail)}`}`)
  }
  const failed = rows.filter((r) => !r.pass).length
  console.log('')
  console.log(failed ? bad(`${failed} of ${rows.length} checks failed — the live org drifts from the roster`) : ok(`all ${rows.length} checks passed`))
  if (flags.json) console.log(JSON.stringify(rows, null, 2))
  return failed ? 1 : 0
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => { console.error(bad(`paperclip-org: ${err.stack ?? err.message}`)); process.exit(4) })
}
