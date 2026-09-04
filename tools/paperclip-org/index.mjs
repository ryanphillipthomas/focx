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

import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, lstatSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

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

// Keys Paperclip itself owns and writes into adapterConfig, regardless of adapter.
// They never appear in the roster — only in LIVE config — so verify (P9) reported
// them as undocumented until they were listed here.
//
// The four instructions* keys are the server's managed instructions bundle system,
// declared together in @paperclipai/server services/agent-instructions.js as
// MODE/ROOT/ENTRY/BOOTSTRAP_PROMPT (the two that tool already knew, FILE_KEY
// 'instructionsFilePath' and PROMPT_KEY 'promptTemplate', stay in the adapter lists
// below). bootstrapPromptTemplate is marked @deprecated there but still rides along
// on older agents. paperclipSkillSync comes from @paperclipai/shared
// ADAPTER_AGNOSTIC_KEYS — "owned by Paperclip/company state rather than one
// concrete adapter" — and must survive an adapter swap.
export const PLATFORM_OWNED_KEYS = Object.freeze([
  'instructionsBundleMode', 'instructionsRootPath', 'instructionsEntryFile',
  'bootstrapPromptTemplate', 'paperclipSkillSync',
])

// The adapterConfig keys each adapter actually documents. adapterConfig is a
// z.record of unknown server-side, so an unknown key is ACCEPTED at create time
// and simply ignored — or worse, a known-but-unsupported one fails at first run.
// Lifted from the adapters' own self-documentation.
export const ADAPTER_KEYS = Object.freeze({
  claude_local: Object.freeze([...PLATFORM_OWNED_KEYS, 'engine', 'cwd', 'instructionsFilePath', 'model', 'effort', 'chrome',
    'promptTemplate', 'maxTurnsPerRun', 'dangerouslySkipPermissions', 'command', 'extraArgs', 'env',
    'workspaceStrategy', 'workspaceRuntime', 'filesystemScope', 'filesystemExtraPaths',
    'filesystemSandboxCommand', 'networkScope', 'networkAllowlist', 'agentCommand', 'mode', 'stateDir',
    'nonInteractivePermissions', 'warmHandleIdleMs', 'timeoutSec', 'graceSec']),
  codex_local: Object.freeze([...PLATFORM_OWNED_KEYS, 'engine', 'cwd', 'instructionsFilePath', 'model', 'modelReasoningEffort',
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
    if (typeof a.run?.heartbeat !== 'boolean') push(`${at} run.heartbeat must be a boolean`)
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
  const broker = roster.credentialBroker ?? {}
  const brokerOrigin = (() => { try { return new URL(broker.paperclipOrigin) } catch { return null } })()
  if (!brokerOrigin || !/^https:\/\/[^/:]+:[0-9]+$/.test(String(broker.paperclipOrigin ?? '')) ||
      brokerOrigin.protocol !== 'https:' || !brokerOrigin.hostname ||
      brokerOrigin.pathname !== '/' || brokerOrigin.username || brokerOrigin.password || brokerOrigin.search || brokerOrigin.hash) {
    push('credentialBroker.paperclipOrigin must be exactly https://host:port with no path, userinfo, query, or fragment')
  }
  if (broker.version !== 2) push('credentialBroker.version must be 2')
  if (!String(broker.binaryPath ?? '').startsWith('/Library/')) push('credentialBroker.binaryPath must live under /Library, outside agent-writable paths')
  if (broker.paperclipClientPath !== '/usr/local/bin/paperclip') push('credentialBroker.paperclipClientPath must be /usr/local/bin/paperclip')
  if (broker.gitCredentialHelperPath !== '/usr/local/bin/git-credential-focx') push('credentialBroker.gitCredentialHelperPath must be /usr/local/bin/git-credential-focx')
  if (broker.socketPath !== '/var/run/focx-credential-broker.sock') push('credentialBroker.socketPath must be /var/run/focx-credential-broker.sock')
  if (broker.githubRepository !== 'ryanphillipthomas/focx') push('credentialBroker.githubRepository must scope GitHub auth to ryanphillipthomas/focx')
  if (broker.requestBodyLimitBytes !== 65536 || broker.responseBodyLimitBytes !== 2097152) push('credentialBroker body limits must remain 65536 request / 2097152 response bytes')
  for (const [block, vars] of Object.entries(roster.env ?? {})) {
    if ('GH_TOKEN' in (vars ?? {})) push(`env.${block}.GH_TOKEN is forbidden — GitHub auth belongs in the host broker Keychain`)
  }
  const gitWrite = roster.env?.gitWrite ?? {}
  if (gitWrite.GIT_CONFIG_VALUE_0 !== `!${broker.gitCredentialHelperPath}` ||
      gitWrite.GIT_CONFIG_KEY_1 !== 'credential.useHttpPath' || gitWrite.GIT_CONFIG_VALUE_1 !== 'true') {
    push('env.gitWrite must select the absolute broker helper and enable credential.useHttpPath')
  }
  const containment = roster.durableContainment ?? {}
  if (containment.version !== 1 || containment.requiredBrokerVersion !== broker.version)
    push('durableContainment must require the configured broker version')
  if (!String(containment.attestationPath ?? '').startsWith('/Library/'))
    push('durableContainment.attestationPath must live under /Library, outside agent-writable paths')
  if (containment.brokerSocketPath !== broker.socketPath)
    push('durableContainment broker socket must match credentialBroker.socketPath')
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

  // --- routines need a project when their owner works in a repo ----------
  const repoTier = new Set(agents.filter((a) => roster.workspaces?.[a.workspace]?.workspaceStrategy).map((a) => a.slug))
  const repoRoutines = (roster.routines ?? []).filter((r) => repoTier.has(r.owner))
  if (repoRoutines.length && !roster.project?.id) {
    push(`roster.project.id is required: ${repoRoutines.length} routine(s) are owned by repo-tier agents, and a routine with no project produces issues with no project — the worktree has no source checkout and the agent fails with "not a git repository"`)
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
// agent hand-listing it — and so the absence of GH_TOKEN plus the presence of
// only the root-owned credential helper are structural facts.
// ---------------------------------------------------------------------------

// Paperclip's env value union is { type: "plain", value } | { type: "secret_ref",
// secretId } | { type: "user_secret_ref", key } | a bare string. A bare string is
// COERCED to plain — which is how "[secret: name]" once became a literal 34-character
// token on every agent. The roster says { secret: "<name>" }; resolveEnv turns that
// into a real secret_ref, and refuses to emit anything it could not resolve.
export function composeEnv(roster, agent, opts = {}) {
  const env = { ...(roster.env?.common ?? {}) }
  if (agent.adapter?.type === 'claude_local') {
    Object.assign(env, roster.env?.claudeAuth ?? {})
    // Only claude_local reads it, and only when the live id is known.
    if (opts.claudeConfigDir) env.CLAUDE_CONFIG_DIR = opts.claudeConfigDir
  }
  // codex_local authenticates through the shared per-company codex-home/auth.json;
  // the adapter supplies CODEX_HOME itself. Do not invent a token here.
  if (agent.git === 'write') Object.assign(env, roster.env?.gitWrite ?? {})
  return env
}

function normalizedOrigin(value) {
  try {
    const url = new URL(value)
    const port = url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '')
    return `${url.protocol}//${url.hostname.toLowerCase()}:${port}`
  } catch { return null }
}

export function inspectCredentialBrokerInstall(broker, deps = {}) {
  const stat = deps.stat ?? statSync
  const lstat = deps.lstat ?? lstatSync
  const realpath = deps.realpath ?? realpathSync
  const run = deps.execFile ?? execFileSync
  const problems = []
  const checkRootPath = (path, kind) => {
    let info
    try { info = kind === 'link' ? lstat(path) : stat(path) } catch { problems.push(`${path} is missing`); return }
    if (info.uid !== 0) problems.push(`${path} is not root-owned`)
    if (kind !== 'link' && (info.mode & 0o022)) problems.push(`${path} is group/other-writable`)
    if (kind === 'file' && !info.isFile()) problems.push(`${path} is not a file`)
    if (kind === 'file' && !(info.mode & 0o111)) problems.push(`${path} is not executable`)
    let current = dirname(path)
    while (current !== '/') {
      let parent
      try { parent = stat(current) } catch { problems.push(`${current} is missing`); break }
      if (parent.uid !== 0 || (parent.mode & 0o022)) problems.push(`${current} is not a root-owned, non-writable path component`)
      current = dirname(current)
    }
  }
  checkRootPath(broker.binaryPath, 'file')
  for (const client of [broker.paperclipClientPath, broker.gitCredentialHelperPath]) {
    checkRootPath(client, 'link')
    try {
      if (realpath(client) !== realpath(broker.binaryPath)) problems.push(`${client} does not resolve to the installed broker binary`)
    } catch { /* missing already reported */ }
  }
  if (problems.length) return { ready: false, problems }
  try {
    const output = run(broker.paperclipClientPath, ['doctor'], {
      encoding: 'utf8', timeout: 3000,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' },
    })
    const doctor = JSON.parse(String(output))
    if (doctor.ok !== true) problems.push('broker doctor did not return ok')
    if (String(doctor.version) !== String(broker.version)) problems.push(`broker doctor reported version ${doctor.version ?? 'missing'}`)
    if (normalizedOrigin(doctor.origin) !== normalizedOrigin(broker.paperclipOrigin)) problems.push('broker doctor origin does not match the roster')
    if (doctor.githubCredentialAvailable !== true) problems.push('broker doctor reports no GitHub credential in the system Keychain')
    if (doctor.privilegedRunRegistration !== true) problems.push('broker doctor reports no privileged run registration')
    if (doctor.agentEnvironmentCredentialDiscovery !== false) problems.push('broker still discovers credentials from the agent environment')
  } catch (err) {
    problems.push(`broker doctor failed: ${err.message}`)
  }
  return { ready: problems.length === 0, problems }
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

const TOOL_CHILD_SECRET_NAMES = Object.freeze([
  'PAPERCLIP_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'GH_TOKEN',
  'GITHUB_TOKEN', 'OPENAI_API_KEY', 'RENDER_API_KEY',
])

export function secretNamesInToolChildEnvironment(env, additionalNames = []) {
  const exact = new Set([...TOOL_CHILD_SECRET_NAMES, ...additionalNames])
  return Object.keys(env ?? {}).filter((name) => exact.has(name) ||
    /(?:^|_)(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY)$/.test(name)).sort()
}

export function validateGeneratedToolSettings(settings) {
  const problems = []
  const allow = settings?.permissions?.allow
  if (!Array.isArray(allow)) return ['generated settings permissions.allow must be an array']
  for (const grant of allow) {
    const value = String(grant)
    if (/^Bash\((?:env|printenv)(?::|\))/.test(value))
      problems.push(`raw environment grant is forbidden: ${value}`)
    if (/^Bash\((?:curl|wget|nc|ncat|ssh|scp|sftp)(?::|\))/.test(value) || /^WebFetch\(\*\)/.test(value))
      problems.push(`generic network grant is forbidden: ${value}`)
  }
  return problems
}

export function validateContainmentAttestation(policy, attestation) {
  const problems = []
  if (!attestation || typeof attestation !== 'object') return ['containment attestation is not an object']
  if (attestation.version !== 1) problems.push('containment attestation version must be 1')
  if (attestation.brokerVersion !== policy.requiredBrokerVersion) problems.push('containment attestation broker version mismatch')
  if (!['macos-sandbox-exec', 'linux-bubblewrap'].includes(attestation.platform))
    problems.push('containment platform is not an approved spawn boundary')
  if (attestation.egress?.enforcedAtSpawn !== true || attestation.egress?.defaultPolicy !== 'deny')
    problems.push('deny-by-default egress is not enforced at spawn')
  const sockets = attestation.egress?.allowUnixSockets
  if (!Array.isArray(sockets) || sockets.length !== 1 || sockets[0] !== policy.brokerSocketPath)
    problems.push('egress allowlist must contain only the credential broker Unix socket')
  if (attestation.credentials?.paperclip !== 'privileged-broker-registration' ||
      attestation.credentials?.github !== 'broker-keychain')
    problems.push('credentials are not broker-only')
  if (attestation.toolChildEnvironment?.secretVariables !== 'scrubbed')
    problems.push('tool-child secret variables are not scrubbed')
  if (attestation.generatedSettings?.rawEnvironmentGrants !== false ||
      attestation.generatedSettings?.genericNetworkGrants !== false)
    problems.push('generated settings do not forbid raw environment and generic network grants')
  return problems
}

export function inspectDurableContainmentAttestation(policy, deps = {}) {
  const stat = deps.stat ?? statSync
  const read = deps.readFile ?? readFileSync
  const problems = []
  let info
  try { info = stat(policy.attestationPath) } catch { return { ready: false, problems: [`${policy.attestationPath} is missing`] } }
  if (info.uid !== 0) problems.push(`${policy.attestationPath} is not root-owned`)
  if (info.mode & 0o022) problems.push(`${policy.attestationPath} is group/other-writable`)
  if (!info.isFile()) problems.push(`${policy.attestationPath} is not a file`)
  let current = dirname(policy.attestationPath)
  while (current !== '/') {
    try {
      const parent = stat(current)
      if (parent.uid !== 0 || (parent.mode & 0o022)) problems.push(`${current} is not a root-owned, non-writable path component`)
    } catch { problems.push(`${current} is missing`); break }
    current = dirname(current)
  }
  let attestation
  try { attestation = JSON.parse(String(read(policy.attestationPath, 'utf8'))) }
  catch (err) { problems.push(`containment attestation is unreadable: ${err.message}`) }
  if (attestation) problems.push(...validateContainmentAttestation(policy, attestation))
  return { ready: problems.length === 0, problems, attestation }
}

export function validateSecretBearingAdapterEgress(adapterConfig, attestationReady) {
  const secretBearing = Object.values(adapterConfig?.env ?? {}).some((value) => value?.type === 'secret_ref')
  return secretBearing && !attestationReady
    ? ['secret-bearing adapter has no attested deny-by-default egress boundary']
    : []
}

export function composeAdapterConfig(roster, agent, secretIds = null, opts = {}) {
  const ws = roster.workspaces?.[agent.workspace] ?? {}
  const spec = REASONING[agent.adapter.type]
  const env = composeEnv(roster, agent, opts)
  const cfg = {
    model: agent.adapter.model,
    [spec.key]: agent.adapter.reasoning,
    env: secretIds ? resolveEnv(env, secretIds) : env,
    timeoutSec: 3600,
    graceSec: 60,
  }
  // cwd is left unset deliberately. The adapter does read it, but a worktree
  // gives both lanes a real per-issue checkout, and pointing cwd elsewhere would
  // move the repo out from under the agent. Isolation comes from
  // CLAUDE_CONFIG_DIR instead, which does not disturb the workspace.
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

export function buildAgentPayload(roster, agent, bundleText, reportsToId, secretIds = null, opts = {}) {
  return {
    name: agent.name,
    role: agent.role,
    title: agent.title,
    icon: agent.icon,
    reportsTo: reportsToId ?? null,
    capabilities: agent.capabilities,
    desiredSkills: agent.desiredSkills ?? [],
    adapterType: agent.adapter.type,
    adapterConfig: composeAdapterConfig(roster, agent, secretIds, opts),
    instructionsBundle: { entryFile: 'AGENTS.md', files: { 'AGENTS.md': bundleText } },
    runtimeConfig: {
      heartbeat: {
        // Read from the roster, not hardcoded. It was false everywhere until
        // agents were given para-memory-files: PARA's Layer 1 rollup into
        // $AGENT_HOME/life/ happens on a heartbeat, so the agents that carry
        // cross-issue context need one. wakeOnDemand stays true regardless —
        // a heartbeat supplements event-driven waking, it never replaces it.
        enabled: agent.run.heartbeat,
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
    // Worktrees are cut from the PROJECT's checkout, so an issue with no project
    // has no repository to cut from and the agent dies on "not a git repository".
    // Routine-created issues inherit the routine's project, so this is where the
    // binding has to happen.
    ...(roster.project?.id ? { projectId: roster.project.id } : {}),
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

// ---------------------------------------------------------------------------
// Local skill attachment.
//
// Assigning a skill in the roster does not attach it to a claude_local agent.
// That adapter's syncClaudeSkills ignores its argument and only reports what is
// already installed. Claude Code loads skills from <cwd>/.claude/skills, so:
//
//   repo-worktree    cwd is the worktree  -> .claude/skills/ in THIS repo, committed
//   workspace: none  cwd is $AGENT_HOME   -> nothing carries it there
//
// The second case is what these helpers cover. Left to a human it is invisible
// machine state: rebuild an agent, it gets a new id and a new empty $AGENT_HOME,
// and its memory silently stops with every check still green.
// ---------------------------------------------------------------------------

export const PAPERCLIP_SKILL_KEY = /^paperclipai\/paperclip\/([A-Za-z0-9._-]+)$/

export function paperclipHome() {
  return process.env.PAPERCLIP_HOME?.trim() || join(homedir(), '.paperclip')
}

export function instanceRoot(home = paperclipHome()) {
  return join(home, 'instances', process.env.PAPERCLIP_INSTANCE_ID?.trim() || 'default')
}

// cli/current, never the versioned install under it — a pinned path breaks on
// the next Paperclip upgrade, and breaks silently.
export function adapterSkillsRoot(home = paperclipHome()) {
  return join(home, 'cli', 'current', 'node_modules', '@paperclipai', 'adapter-claude-local', 'skills')
}

// Claude Code keeps everything under one config root: projects/, sessions/,
// memory/ and skills/. Left at the default ~/.claude, every agent on this host
// shares it — and because Claude resolves a project by the git COMMON dir, all
// sixteen worktree agents landed in one memory store. Pointing each agent at its
// own $AGENT_HOME/.claude isolates them and, as a consequence, makes the native
// memory index auto-load per agent: MEMORY.md arrives in context at session
// start with no instruction to read it.
//
// The roster cannot express this — the path contains the agent id, and the
// roster is keyed by slug precisely so ids stay Paperclip's business. So it is
// injected here, at apply time, from live ids.
export function agentClaudeConfigDir(agentId, opts = {}) {
  const workspaces = opts.workspacesRoot ?? join(instanceRoot(), 'workspaces')
  return join(workspaces, agentId, '.claude')
}

// claudeCodeSkills name skills provided by the local Claude Code install, not by
// Paperclip. validateRoster checks they are well FORMED — no slash, so nobody
// files a Paperclip key here — but nothing has ever checked they EXIST. The
// roster claimed four for Product Designer and the agent had none of them: the
// design plugin is not installed on this host, and the reconciler only ever
// printed a hint about it at P7. A capability the roster asserts and the runtime
// lacks is drift, and drift is supposed to fail rather than be mentioned.
//
// Only what is verifiable from disk is asserted. A "plugin:skill" entry resolves
// when that plugin is installed AND enabled. A bare name resolves when it is a
// user skill or a skill in this repo. Anything else is reported unresolved, with
// where it was looked for, because a silent pass is what let this sit.
export function claudeCodeSkillSources(opts = {}) {
  // CLAUDE_CONFIG_DIR is the variable Claude Code itself honours, so reading it
  // here means the tool inspects the same install the agents will.
  const home = opts.claudeHome ?? (process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude'))
  const readJson = (file) => {
    try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
  }
  const installed = readJson(join(home, 'plugins', 'installed_plugins.json'))?.plugins ?? {}
  const enabled = readJson(join(home, 'settings.json'))?.enabledPlugins ?? {}
  // installed_plugins keys are "<name>@<marketplace>"; the roster prefix is the name.
  const plugins = new Set()
  for (const key of Object.keys(installed)) {
    if (enabled[key] === false) continue
    plugins.add(String(key).split('@')[0])
  }
  const dirSkills = (dir) => {
    try { return statSync(dir).isDirectory() ? new Set(readdirSync(dir)) : new Set() } catch { return new Set() }
  }
  return {
    plugins,
    userSkills: dirSkills(join(home, 'skills')),
    repoSkills: dirSkills(join(opts.repoRoot ?? REPO_ROOT, '.claude', 'skills')),
  }
}

export function checkClaudeCodeSkills(roster, opts = {}) {
  const src = opts.sources ?? claudeCodeSkillSources(opts)
  const wanted = new Set()
  for (const a of roster.agents ?? []) for (const k of a.claudeCodeSkills ?? []) wanted.add(k)
  const unresolved = []
  for (const skill of [...wanted].sort()) {
    if (skill.includes(':')) {
      const plugin = skill.split(':')[0]
      if (!src.plugins.has(plugin)) unresolved.push(`${skill} (plugin '${plugin}' not installed)`)
      continue
    }
    if (!src.userSkills.has(skill) && !src.repoSkills.has(skill)) {
      unresolved.push(`${skill} (not a user skill or a skill in this repo)`)
    }
  }
  return { wanted: wanted.size, unresolved }
}

export function needsLocalSkillLinks(roster, agent) {
  if (agent.adapter?.type !== 'claude_local') return false
  return !roster.workspaces?.[agent.workspace]?.workspaceStrategy
}

// Pure: what SHOULD exist, given live agent ids. The caller decides whether to
// create it (apply) or merely check it (verify).
export function planLocalSkillLinks(roster, idBySlug, opts = {}) {
  const skillsRoot = opts.skillsRoot ?? adapterSkillsRoot()
  const workspaces = opts.workspacesRoot ?? join(instanceRoot(), 'workspaces')
  const out = []
  for (const agent of roster.agents ?? []) {
    if (!needsLocalSkillLinks(roster, agent)) continue
    const id = idBySlug.get(agent.slug)
    if (!id) continue
    for (const key of agent.desiredSkills ?? []) {
      const m = PAPERCLIP_SKILL_KEY.exec(key)
      if (!m) continue
      out.push({
        slug: agent.slug,
        skill: m[1],
        source: join(skillsRoot, m[1]),
        target: join(workspaces, id, '.claude', 'skills', m[1]),
      })
    }
  }
  return out
}

export function ensureLocalSkillLink({ source, target }) {
  if (!existsSync(source)) return 'source-missing'
  mkdirSync(dirname(target), { recursive: true })
  let current = null
  try { current = lstatSync(target).isSymbolicLink() ? readlinkSync(target) : '<not a symlink>' } catch { /* absent */ }
  if (current === source) return 'ok'
  if (current !== null) unlinkSync(target)
  symlinkSync(source, target)
  return current === null ? 'created' : 'repointed'
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

export function verify(roster, live, renderedBySlug, opts = {}) {
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
    // Heartbeats are declared per agent now. What must hold is that live matches
    // the roster — an agent quietly gaining a heartbeat in the UI is drift, and
    // so is one losing the heartbeat its memory rollup depends on.
    if (hb.enabled !== w.run.heartbeat) wakeBad.push(`${slug} heartbeat ${hb.enabled ? 'on' : 'off'}, roster says ${w.run.heartbeat ? 'on' : 'off'}`)
    if (hb.wakeOnDemand !== true) wakeBad.push(`${slug} wakeOnDemand off`)
    if (hb.maxConcurrentRuns !== w.run.maxConcurrentRuns) wakeBad.push(`${slug} concurrency ${hb.maxConcurrentRuns}`)
  }
  const hbOn = roster.agents.filter((a) => a.run.heartbeat).map((a) => a.slug)
  check(9, `Waking matches the roster: wakeOnDemand everywhere, heartbeat on ${hbOn.length} (${hbOn.join(', ') || 'none'})`,
    wakeBad.length === 0, wakeBad.slice(0, 3).join('; '))

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
    if ('GH_TOKEN' in env) envBad.push(`${slug} exposes forbidden GH_TOKEN`)
    for (const [key, value] of Object.entries(roster.env?.gitWrite ?? {})) {
      const liveValue = env[key]
      const plain = liveValue && typeof liveValue === 'object' ? liveValue.value : liveValue
      if (wantsGit && String(plain ?? '') !== String(value)) envBad.push(`${slug} brokered Git config mismatch at ${key}`)
      if (!wantsGit && key in env) envBad.push(`${slug} has Git write broker config despite git:${w.git}`)
    }
    const wantsWorktree = Boolean(roster.workspaces?.[w.workspace]?.workspaceStrategy)
    const hasWorktree = Boolean((cfg.get(a.id)?.adapterConfig ?? {}).workspaceStrategy)
    if (wantsWorktree !== hasWorktree) envBad.push(`${slug} workspaceStrategy mismatch`)
    // Presence is not enough: a bare string is stored as { type: "plain" }, which
    // is how every agent once ended up with a literal "[secret: name]" for a token.
    for (const key of ['CLAUDE_CODE_OAUTH_TOKEN']) {
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

  // Worktrees are cut from the PROJECT's checkout, so an issue with no project
  // leaves its agent no source repo: the run dies inside workspace provisioning
  // with "fatal: not a git repository" before the adapter ever starts, and the
  // agent shows setup_failed with nothing else to go on.
  //
  // Binding routines to the project fixed that lane. An agent opening a child
  // issue is still only ASKED to carry the project across, in prose, in
  // _repo-discipline.md — and prose in a bundle is a request. This makes it a
  // fact the same way the credential tiers are.
  const OPEN_STATUSES = new Set(['backlog', 'todo', 'in_progress', 'in_review', 'blocked'])
  const worktreeAgentSlug = new Map()
  for (const [slug, a] of bySlug) {
    const w = want.get(slug)
    if (w && roster.workspaces?.[w.workspace]?.workspaceStrategy) worktreeAgentSlug.set(a.id, slug)
  }
  // A read that failed must not read as a clean board — live.issues is null only
  // when the caller could not fetch, and that is a failure, not an absence.
  const issuesReadable = Array.isArray(live.issues)
  const projectless = !issuesReadable ? [] : live.issues
    .filter((i) => OPEN_STATUSES.has(i.status) && i.assigneeAgentId && worktreeAgentSlug.has(i.assigneeAgentId) && !i.projectId)
    .map((i) => `${worktreeAgentSlug.get(i.assigneeAgentId)}: ${String(i.title ?? i.id).slice(0, 44)}`)
  // The roster asserted four design skills and a Figma capability that the host
  // does not provide. Nothing failed, because nothing looked.
  const cc = checkClaudeCodeSkills(roster, opts.claudeCodeSkills ?? {})
  rows.push({
    n: '—',
    condition: `Claude Code skills the roster claims are installed (${cc.wanted})`,
    pass: cc.unresolved.length === 0,
    detail: cc.unresolved.slice(0, 3).join('; '),
  })

  // Without this every claude agent shares ~/.claude: one memory store for the
  // sixteen worktree agents, and no per-agent recall. It is one env var, so it
  // is also one silent revert away from being lost.
  const cfgDirBad = []
  for (const [slug, a] of bySlug) {
    const w = want.get(slug); if (!w || w.adapter?.type !== 'claude_local') continue
    const got = ((cfg.get(a.id)?.adapterConfig ?? {}).env ?? {}).CLAUDE_CONFIG_DIR
    const value = typeof got === 'object' ? got?.value : got
    const wanted = agentClaudeConfigDir(a.id, opts.localSkills ?? {})
    if (value !== wanted) cfgDirBad.push(`${slug}: ${value ? 'points elsewhere' : 'unset'}`)
  }
  rows.push({
    n: '—',
    condition: 'Claude agents have their own config dir, so memory is per-agent',
    pass: cfgDirBad.length === 0,
    detail: cfgDirBad.slice(0, 3).join('; '),
  })

  // A skill the roster assigns but the runtime never loads is worse than one it
  // never assigned: every board stays green while the capability is absent.
  // Worktree agents get theirs from .claude/skills in the repo; these cannot.
  const liveIds = new Map([...bySlug].map(([slug, a]) => [slug, a.id]))
  const linkExpect = planLocalSkillLinks(roster, liveIds, opts.localSkills ?? {})
  const linkMissing = linkExpect
    .filter((l) => { try { return !existsSync(l.target) } catch { return true } })
    .map((l) => `${l.slug}/${l.skill}`)
  rows.push({
    n: '—',
    condition: `Workspace-none agents have their skills attached locally (${linkExpect.length} link(s))`,
    pass: linkMissing.length === 0,
    detail: linkMissing.slice(0, 3).join('; '),
  })

  // POST /issues deduplicates on (title, description): an identical create
  // returns the EXISTING issue and silently discards the fields you sent with
  // it. An agent that retries a handoff — the natural response to any hiccup —
  // gets back its first attempt, assignee and all dropped, and reports the
  // assignee as having vanished. Reproduced 2026-09-03: create without an
  // assignee, retry the same title and body with one, and the stored issue
  // still has none.
  //
  // The cost lands on the child issue: work handed to nobody, which no agent
  // will ever pick up and no other check notices. A parented issue with no
  // assignee is that, and is never legitimate — a handoff names its recipient.
  const orphanWork = !issuesReadable ? [] : live.issues
    .filter((i) => OPEN_STATUSES.has(i.status) && i.parentId && !i.assigneeAgentId)
    .map((i) => String(i.title ?? i.id).slice(0, 44))
  rows.push({
    n: '—',
    condition: 'Every open child issue has someone to do it',
    pass: issuesReadable && orphanWork.length === 0,
    detail: !issuesReadable ? 'could not read issues — this check could not run' : orphanWork.slice(0, 3).join('; '),
  })

  rows.push({
    n: '—',
    condition: 'Open worktree-agent issues all carry a project',
    pass: issuesReadable && projectless.length === 0,
    detail: !issuesReadable ? 'could not read issues — this check could not run' : projectless.slice(0, 3).join('; '),
  })

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

  if ((flags.apply || flags.verifyOnly) && normalizedOrigin(baseUrl) === normalizedOrigin(roster.credentialBroker.paperclipOrigin)) {
    const broker = inspectCredentialBrokerInstall(roster.credentialBroker)
    if (!broker.ready) {
      console.error(bad('P0B credential broker is not ready; refusing to remove agent GitHub credentials'))
      for (const problem of broker.problems) console.error(`    ${problem}`)
      return 3
    }
    console.log(ok('P0B root-owned credential broker and Keychain credential are ready'))
    const containment = inspectDurableContainmentAttestation(roster.durableContainment)
    if (!containment.ready) {
      console.error(bad('P0C durable containment is not attested; refusing to configure secret-bearing agents'))
      for (const problem of containment.problems) console.error(`    ${problem}`)
      return 3
    }
    console.log(ok('P0C deny-by-default egress and tool-child secret scrubbing are attested'))
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
  const live = { agents: [], routines: [], issues: null, company, configurations: new Map(), bundles: new Map(), triggers: new Map() }
  live.agents = listOf(await api.get(`/api/companies/${companyId}/agents`))
  try { live.routines = listOf(await api.get(`/api/companies/${companyId}/routines`)) } catch { live.routines = [] }
  // null on failure, never [] — an unread list must not verify as a clean one.
  try { live.issues = listOf(await api.get(`/api/companies/${companyId}/issues?limit=500`)) } catch { live.issues = null }
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

  // ---- live routines must be bound to the project -------------------------
  if (roster.project?.id && live.routines.length) {
    const unbound = live.routines.filter((r) => !r.projectId).map((r) => r.title)
    if (unbound.length) {
      console.log(warn(`     ${unbound.length} live routine(s) have no project — their issues get no worktree:`))
      for (const t of unbound.slice(0, 4)) console.log(`       ${t}`)
      console.log(paint(C.dim, '     --apply rebinds them.'))
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
  // Every agent with an id, including ones created moments ago. A create cannot
  // carry CLAUDE_CONFIG_DIR — the id does not exist until the API answers — so a
  // rebuilt agent would run without it until some later apply. That is precisely
  // the case this has to cover: agents get rebuilt after mistakes.
  const existing = roster.agents.filter((a) => idBySlug.has(a.slug))
  if (existing.length) {
    step(`B' converge ${existing.length}`)
    for (const agent of existing) {
      const parentId = agent.reportsTo != null ? idBySlug.get(agent.reportsTo) : null
      const payload = buildAgentPayload(roster, agent, rendered.get(agent.slug), parentId, secretIds,
        { claudeConfigDir: agentClaudeConfigDir(idBySlug.get(agent.slug)) })
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
  const skillFailures = []
  if (withSkills.length) {
    step(`D  skills sync (${withSkills.length})`)
    for (const agent of withSkills) {
      // mode is REQUIRED — the API 422s without it. 'replace' is the only value
      // that means what this tool means: the roster is the complete desired set.
      // 'add' would let a skill deleted from the roster linger on the agent
      // forever, which is the drift this tool exists to prevent.
      try {
        await api.post(`/api/agents/${idBySlug.get(agent.slug)}/skills/sync`,
          { mode: 'replace', desiredSkills: agent.desiredSkills })
        mutated = true
      } catch (err) {
        skillFailures.push(agent.slug)
        console.log(warn(`  ${agent.slug}: skills sync failed — ${err.message}`))
      }
    }
  }

  // --- D2: local skill attachment -----------------------------------------
  const linkPlan = planLocalSkillLinks(roster, idBySlug)
  const linkFailures = []
  if (linkPlan.length) {
    step(`D2 attach skills locally (${linkPlan.length} link(s) for workspace-none agents)`)
    const counts = { ok: 0, created: 0, repointed: 0 }
    for (const link of linkPlan) {
      let result
      try { result = ensureLocalSkillLink(link) }
      catch (err) { result = `error: ${err.message}` }
      if (result === 'ok' || result === 'created' || result === 'repointed') {
        counts[result] += 1
        if (result !== 'ok') mutated = true
      } else {
        linkFailures.push(`${link.slug}/${link.skill}: ${result}`)
        console.log(warn(`  ${link.slug}: ${link.skill} — ${result}`))
      }
    }
    console.log(`  ${ok('linked')} ${counts.created} created, ${counts.repointed} repointed, ${counts.ok} already correct`)
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
  const fresh = { agents: [], routines: [], issues: null, company: live.company, configurations: new Map(), bundles: new Map(), triggers: new Map() }
  try {
    fresh.agents = listOf(await api.get(`/api/companies/${companyId}/agents`))
    fresh.routines = listOf(await api.get(`/api/companies/${companyId}/routines`))
    fresh.company = await api.get(`/api/companies/${companyId}`)
  } catch (err) { console.error(warn(`  could not re-read live state: ${err.message}`)); return 4 }
  try { fresh.issues = listOf(await api.get(`/api/companies/${companyId}/issues?limit=500`)) } catch { fresh.issues = null }
  const verdict = await runVerify(api, companyId, roster, fresh, rendered, flags)

  // A failed skills sync must not exit 0. verify reads agents, bundles, config,
  // budgets and routines — it never reads skills, so a green board below says
  // nothing about whether step D landed. Left silent, every agent could miss
  // every skill and this would still report success.
  if (linkFailures.length) {
    console.error(bad(`D2 could not attach ${linkFailures.length} local skill link(s): ${linkFailures.slice(0, 3).join('; ')}`))
    console.error(bad('   those agents cannot load the skill, whatever the roster says — this is a PARTIAL APPLY.'))
    return 4
  }
  if (skillFailures.length) {
    const shown = skillFailures.slice(0, 3).join(', ')
    console.error(bad(`D  skills sync failed for ${skillFailures.length} agent(s): ${shown}${skillFailures.length > 3 ? ', …' : ''}`))
    console.error(bad('   verify does not read skills, so the rows above do not vouch for them — this is a PARTIAL APPLY.'))
    return 4
  }
  return verdict
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
