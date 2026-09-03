// node --test tools/paperclip-org/test.mjs
//
// The offline half (validateRoster, topoOrder, composeEnv, renderBundle,
// planActions) is tested directly. The live half runs against fake-api.mjs, so
// the whole reconciler is exercised with no credential and no live service.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  REPO_ROOT, validateRoster, topoOrder, composeEnv, composeAdapterConfig,
  renderBundle, planActions, loadRoster, renderAll, buildAgentPayload,
  PaperclipClient, verify, liveSlug, checkCharterCoupling, ROUTINE_PRIORITIES,
  resolveEnv, checkAdapterConfig, BUBBLEWRAP_KEYS, ADAPTER_KEYS, buildRoutinePayload,
} from './index.mjs'
import { createFakeApi } from './fake-api.mjs'

const run = promisify(execFile)
const CLI = join(REPO_ROOT, 'tools/paperclip-org/index.mjs')
const ROSTER = join(REPO_ROOT, 'pipeline/org/roster.json')

const load = () => loadRoster(ROSTER)
const clone = (o) => JSON.parse(JSON.stringify(o))
const bySlug = (r, s) => r.agents.find((a) => a.slug === s)

// ---------------------------------------------------------------------------
// The real roster
// ---------------------------------------------------------------------------

test('the committed roster is valid', () => {
  const { roster, instructionFiles, missing } = load()
  assert.deepEqual(missing, [], 'every instruction file exists and is non-empty')
  assert.deepEqual(validateRoster(roster, { instructionFiles }), [])
})

test('Paperclip skills and Claude Code plugin skills are kept apart', () => {
  const { roster } = load()
  // desiredSkills is sent to Paperclip and must name its registry keys.
  // claudeCodeSkills is documentation of local Claude Code plugin skills.
  for (const a of roster.agents) {
    for (const s of a.desiredSkills ?? []) assert.ok(s.includes('/'), `${a.slug}: '${s}' is not a Paperclip key`)
    for (const s of a.claudeCodeSkills ?? []) assert.ok(!s.includes('/'), `${a.slug}: '${s}' looks like a Paperclip key`)
  }
  const design = bySlug(roster, 'product-designer')
  // Paperclip's registry still holds no *craft* skill for the designer — the
  // design skills are Claude Code plugin skills, and that separation is the
  // point of this test. para-memory-files is the one exception, because memory
  // is not role-specific: every agent keeps its own, under its own $AGENT_HOME.
  assert.deepEqual(design.desiredSkills, ['paperclipai/paperclip/para-memory-files'],
    'the designer takes memory from Paperclip and nothing else')
  assert.ok(design.claudeCodeSkills.includes('design'))
})

test('rejects a Claude Code plugin skill placed in desiredSkills', () => rejects((r) => {
  bySlug(r, 'product-designer').desiredSkills = ['design:ux-copy']
}, 'belong in claudeCodeSkills'))

test('rejects a Paperclip registry key placed in claudeCodeSkills', () => rejects((r) => {
  bySlug(r, 'product-designer').claudeCodeSkills = ['paperclipai/paperclip/paperclip']
}, 'belong in desiredSkills'))

test('rejects discoveryOnlySkills naming a skill no agent lists', () => rejects((r) => {
  r.designChain.discoveryOnlySkills = ['not-a-skill-anyone-has']
}, 'no agent lists in claudeCodeSkills'))

test('the committed roster matches the agreed shape', () => {
  const { roster } = load()
  assert.equal(roster.agents.length, 26)
  assert.equal(roster.expectedAgentCount, 26)
  assert.equal(roster.routines.length, 10)
  const count = (f) => roster.agents.filter(f).length
  assert.equal(count((a) => a.adapter.type === 'claude_local'), 17)
  assert.equal(count((a) => a.adapter.type === 'codex_local'), 9)
  assert.equal(count((a) => a.adapter.model === 'claude-opus-5'), 8)
  assert.equal(count((a) => a.adapter.model === 'claude-sonnet-5'), 9)
  assert.equal(count((a) => a.adapter.model === 'gpt-5.6-sol'), 9)
  assert.equal(count((a) => a.tier === 'manager'), 6)
  assert.equal(count((a) => a.git === 'write'), 14)
  assert.equal(count((a) => a.git === 'read'), 2)
  assert.equal(count((a) => a.git === 'none'), 10)
  assert.equal(roster.agents.reduce((n, a) => n + a.budgetMonthlyCents, 0), 5200)
  assert.ok(5000 <= roster.company.budgetMonthlyCents)
})

// ---------------------------------------------------------------------------
// validateRoster rejections
// ---------------------------------------------------------------------------

const rejects = (mutate, fragment) => {
  const { roster, instructionFiles } = load()
  const r = clone(roster)
  mutate(r)
  const errs = validateRoster(r, { instructionFiles })
  assert.ok(errs.length > 0, 'expected at least one error')
  assert.ok(errs.some((e) => e.includes(fragment)), `expected an error containing ${JSON.stringify(fragment)}, got:\n  ${errs.join('\n  ')}`)
}

test('rejects a duplicate slug', () => rejects((r) => { r.agents[1].slug = r.agents[0].slug }, 'duplicate slug'))
test('rejects a duplicate name', () => rejects((r) => { r.agents[1].name = r.agents[0].name }, 'duplicate name'))
test('rejects an unknown reportsTo', () => rejects((r) => { bySlug(r, 'cto').reportsTo = 'nobody' }, "reportsTo 'nobody'"))
test('rejects two roots', () => rejects((r) => { bySlug(r, 'cto').reportsTo = null }, 'exactly one root'))
test('rejects a reporting cycle', () => rejects((r) => {
  bySlug(r, 'ceo').reportsTo = 'cto'; bySlug(r, 'cto').reportsTo = 'ceo'
}, 'cycle'))
test('rejects a count mismatch', () => rejects((r) => { r.agents.pop() }, 'expectedAgentCount'))
test('rejects agent budgets over the company ceiling', () => rejects((r) => { r.company.budgetMonthlyCents = 100 }, 'over the company ceiling'))
test('rejects a bad role', () => rejects((r) => { r.agents[0].role = 'wizard' }, 'not a valid AGENT_ROLE'))
test('rejects a bad icon', () => rejects((r) => { r.agents[0].icon = 'palette' }, 'not a valid AGENT_ICON_NAME'))
test('rejects xhigh reasoning on a claude_local agent', () => rejects((r) => {
  bySlug(r, 'ceo').adapter.reasoning = 'xhigh'
}, 'not valid for claude_local'))
test('accepts xhigh reasoning on a codex_local agent', () => {
  const { roster, instructionFiles } = load()
  const r = clone(roster)
  bySlug(r, 'web-engineer').adapter.reasoning = 'xhigh'
  assert.deepEqual(validateRoster(r, { instructionFiles }), [])
})
test('rejects the bare gpt-5.6 alias', () => rejects((r) => {
  bySlug(r, 'web-engineer').adapter.model = 'gpt-5.6'
}, 'gpt-5.6-sol'))
test('rejects a missing instructions file', () => rejects((r) => { r.agents[0].instructions = 'nope.md' }, 'not found'))
test('rejects a duplicate routine title', () => rejects((r) => { r.routines[1].title = r.routines[0].title }, 'duplicate title'))
test('rejects an invalid routine priority', () => rejects((r) => {
  r.routines[0].priority = 'normal'
}, "priority 'normal' is not valid"))

test('every routine priority is one Paperclip accepts', () => {
  const { roster } = load()
  for (const r of roster.routines) {
    assert.ok(ROUTINE_PRIORITIES.includes(r.priority), `${r.key}: ${r.priority}`)
  }
})

test('rejects a 4-field cron', () => rejects((r) => { r.routines[0].cron = '0 7 * *' }, 'expected 5'))
test('rejects canCreateAgents true', () => rejects((r) => { r.agents[0].permissions.canCreateAgents = true }, 'canCreateAgents must be false'))
test('rejects an IC that can assign tasks', () => rejects((r) => {
  bySlug(r, 'web-engineer').permissions.canAssignTasks = true
}, 'canAssignTasks must be true for managers'))
test('rejects an enabled heartbeat', () => rejects((r) => { r.agents[0].run.heartbeat = true }, 'heartbeat must be false'))

// --- design chain ---
test('rejects proposer === approver', () => rejects((r) => { r.designChain.approver = r.designChain.proposer }, 'must be different agents'))
test('rejects overlapping Figma read and write', () => rejects((r) => {
  r.designChain.figmaRead.push('product-designer')
}, 'both Figma write and read'))
test('rejects zero default modes', () => rejects((r) => { r.designChain.modes.production.default = false }, 'exactly one mode must be default'))
test('rejects two default modes', () => rejects((r) => { r.designChain.modes.discovery.default = true }, 'exactly one mode must be default'))
test('rejects a default mode that uses Claude Design', () => rejects((r) => {
  r.designChain.modes.production.usesClaudeDesign = true
}, 'must not use Claude Design'))
test('rejects an escalator that is also the decider', () => rejects((r) => {
  r.designChain.modeEscalation.decidedBy = r.designChain.modeEscalation.raisedBy
}, 'must not also be the decider'))

// --- secrets ---
test('rejects the legacy string form even when the secret name is real', () => rejects((r) => {
  r.env.gitWrite.GH_TOKEN = '[secret: github_focx_write_token]'
}, 'stores as a PLAIN value'))
test('rejects a literal credential pasted into env', () => rejects((r) => {
  r.env.gitWrite.GH_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
}, 'literal credential'))

// ---------------------------------------------------------------------------
// topoOrder
// ---------------------------------------------------------------------------

test('topoOrder puts the root first and every parent before its child', () => {
  const { roster } = load()
  const order = topoOrder(roster.agents)
  assert.equal(order.length, 26)
  assert.equal(order[0], 'ceo')
  const at = new Map(order.map((s, i) => [s, i]))
  for (const a of roster.agents) {
    if (a.reportsTo) assert.ok(at.get(a.reportsTo) < at.get(a.slug), `${a.reportsTo} must precede ${a.slug}`)
  }
})

test('topoOrder is deterministic', () => {
  const { roster } = load()
  const shuffled = clone(roster)
  shuffled.agents.reverse()
  assert.deepEqual(topoOrder(roster.agents), topoOrder(shuffled.agents))
})

// ---------------------------------------------------------------------------
// env composition — the part that decides what an agent can actually do
// ---------------------------------------------------------------------------

test('composeEnv gives PATH to every agent', () => {
  const { roster } = load()
  for (const a of roster.agents) assert.ok(composeEnv(roster, a).PATH, `${a.slug} has no PATH`)
})

test('composeEnv gives the Claude token to claude_local agents only', () => {
  const { roster } = load()
  for (const a of roster.agents) {
    const has = 'CLAUDE_CODE_OAUTH_TOKEN' in composeEnv(roster, a)
    assert.equal(has, a.adapter.type === 'claude_local', `${a.slug}`)
  }
  // codex_local authenticates via the shared per-company codex-home
  const codex = roster.agents.filter((a) => a.adapter.type === 'codex_local')
  assert.equal(codex.length, 9)
  for (const a of codex) assert.ok(!('CODEX_HOME' in composeEnv(roster, a)), 'the adapter supplies CODEX_HOME, not the roster')
})

test('composeEnv gives GH_TOKEN and the credential helper to git:write agents only', () => {
  const { roster } = load()
  for (const a of roster.agents) {
    const env = composeEnv(roster, a)
    const has = 'GH_TOKEN' in env
    assert.equal(has, a.git === 'write', `${a.slug}`)
    if (has) {
      assert.equal(env.GIT_CONFIG_COUNT, '1')
      assert.equal(env.GIT_CONFIG_KEY_0, 'credential.helper')
      assert.ok(env.GIT_CONFIG_VALUE_0.includes('x-access-token'))
      assert.equal(env.GH_TOKEN.secret, 'github_focx_write_token', 'referenced by name, not inlined')
    }
  }
})

test('Design Steward has no GH_TOKEN — the reviewer cannot write what it approves', () => {
  const { roster } = load()
  const steward = bySlug(roster, roster.designChain.approver)
  assert.equal(steward.git, 'read')
  assert.ok(!('GH_TOKEN' in composeEnv(roster, steward)))
  const designer = bySlug(roster, roster.designChain.proposer)
  assert.ok('GH_TOKEN' in composeEnv(roster, designer), 'the proposer does write, and needs the token')
})

test('composeAdapterConfig maps reasoning to each adapter\'s own key and disarms the dangerous defaults', () => {
  const { roster } = load()
  const claude = composeAdapterConfig(roster, bySlug(roster, 'ceo'))
  assert.equal(claude.effort, 'high')
  assert.ok(!('modelReasoningEffort' in claude))
  // Defaults to TRUE server-side; must be written explicitly.
  assert.equal(claude.dangerouslySkipPermissions, false)

  const codex = composeAdapterConfig(roster, bySlug(roster, 'apple-engineer'))
  assert.equal(codex.modelReasoningEffort, 'high')
  assert.ok(!('effort' in codex))
  assert.equal(codex.dangerouslyBypassApprovalsAndSandbox, false)
})

test('repo agents get a per-issue worktree, never a shared cwd', () => {
  const { roster } = load()
  for (const a of roster.agents) {
    const cfg = composeAdapterConfig(roster, a)
    const wantsRepo = Boolean(roster.workspaces[a.workspace]?.workspaceStrategy)
    assert.equal(Boolean(cfg.workspaceStrategy), wantsRepo, a.slug)
    // cwd is not a workable placement: the claude ACP lane ignores it.
    assert.ok(!('cwd' in cfg), `${a.slug} still pins a cwd`)
  }
})

test('worktree baseRef is remote-tracking, so Paperclip fetches before branching', () => {
  const { roster } = load()
  for (const [name, ws] of Object.entries(roster.workspaces)) {
    if (ws.workspaceStrategy?.type !== 'git_worktree') continue
    assert.ok(String(ws.workspaceStrategy.baseRef).includes('/'), `${name} baseRef must be <remote>/<branch>`)
  }
})

test('rejects a bare baseRef — the silent-staleness bug', () => rejects((r) => {
  r.workspaces['repo-worktree'].workspaceStrategy.baseRef = 'develop'
}, 'is not remote-tracking'))

test('rejects a branchTemplate with no placeholder — the shared-branch bug', () => rejects((r) => {
  // Single braces render literally: every agent and issue collide on one branch.
  r.workspaces['repo-worktree'].workspaceStrategy.branchTemplate = 'agent/{agentSlug}/{issueId}'
}, 'renders literally'))

test('accepts a branchTemplate that actually interpolates', () => {
  const { roster, instructionFiles } = load()
  const r = clone(roster)
  r.workspaces['repo-worktree'].workspaceStrategy.branchTemplate = '{{issue.identifier}}-{{slug}}'
  assert.deepEqual(validateRoster(r, { instructionFiles }), [])
})

test("QA's independence is git-enforced rather than a static path", () => {
  const { roster } = load()
  const qa = bySlug(roster, roster.independence.verifier)
  const ws = roster.workspaces[qa.workspace].workspaceStrategy
  assert.equal(ws.type, 'git_worktree')
  // No branchTemplate => the per-issue default, so QA's child issue gets its own
  // branch and directory, distinct from the build it verifies.
  assert.ok(!ws.branchTemplate)
  assert.equal(qa.git, 'write', 'QA must still push its verdict and evidence')
})

test('resolveEnv turns a named secret into a real secret_ref', () => {
  const ids = new Map([['claude_subscription_token', 'uuid-1']])
  const out = resolveEnv({ PATH: '/bin', TOK: { secret: 'claude_subscription_token' } }, ids)
  assert.deepEqual(out.PATH, { type: 'plain', value: '/bin' })
  assert.deepEqual(out.TOK, { type: 'secret_ref', secretId: 'uuid-1' })
})

test('resolveEnv refuses to fall back to a plain value when a secret does not resolve', () => {
  // The original bug: an unresolved reference became a literal string on every
  // agent, and nothing complained until first run.
  assert.throws(() => resolveEnv({ TOK: { secret: 'missing' } }, new Map()),
    /did not resolve to an id — refusing to write a plain value/)
})

test('the roster references secrets by name, never with the string form', () => {
  const { roster } = load()
  assert.deepEqual(roster.env.claudeAuth.CLAUDE_CODE_OAUTH_TOKEN, { secret: 'claude_subscription_token' })
  assert.deepEqual(roster.env.gitWrite.GH_TOKEN, { secret: 'github_focx_write_token' })
})

test('rejects the "[secret: name]" string form that Paperclip stores as plain', () => rejects((r) => {
  r.env.claudeAuth.CLAUDE_CODE_OAUTH_TOKEN = '[secret: claude_subscription_token]'
}, 'stores as a PLAIN value'))

test('rejects a secret reference to something not declared', () => rejects((r) => {
  r.env.gitWrite.GH_TOKEN = { secret: 'nope' }
}, "undeclared secret 'nope'"))

test('no agent config carries a Bubblewrap-only key on a non-Linux host', () => {
  const { roster } = load()
  for (const a of roster.agents) {
    const cfg = composeAdapterConfig(roster, a)
    for (const k of BUBBLEWRAP_KEYS) assert.ok(!(k in cfg), `${a.slug} sets ${k}`)
    assert.deepEqual(checkAdapterConfig(a.adapter.type, cfg, { platform: 'darwin' }), [])
  }
})

test('checkAdapterConfig catches the two failures that actually happened', () => {
  // filesystemScope on macOS -> "bwrap was not found in PATH" at first run
  const bw = checkAdapterConfig('claude_local', { filesystemScope: 'workspace' }, { platform: 'darwin' })
  assert.equal(bw.length, 1)
  assert.match(bw[0], /Bubblewrap, which is Linux only/)
  assert.deepEqual(checkAdapterConfig('claude_local', { filesystemScope: 'workspace' }, { platform: 'linux' }), [])

  // keys that are not documented at all are accepted by the API and ignored
  const unknown = checkAdapterConfig('claude_local', { repository: 'x', baseBranch: 'develop' }, { platform: 'darwin' })
  assert.equal(unknown.length, 2)
  assert.match(unknown[0], /not a documented adapterConfig key/)
})

test('every documented reasoning key belongs to its own adapter', () => {
  assert.ok(ADAPTER_KEYS.claude_local.includes('effort'))
  assert.ok(!ADAPTER_KEYS.claude_local.includes('modelReasoningEffort'))
  assert.ok(ADAPTER_KEYS.codex_local.includes('modelReasoningEffort'))
  assert.ok(!ADAPTER_KEYS.codex_local.includes('effort'))
})

// ---------------------------------------------------------------------------
// renderBundle
// ---------------------------------------------------------------------------

test('renderBundle is deterministic and idempotent', () => {
  const { roster, fragments } = load()
  const a = bySlug(roster, 'cto')
  assert.equal(renderBundle(roster, a, fragments), renderBundle(roster, a, fragments))
})

test('the reporting line is generated from the roster, not the markdown source', () => {
  const { roster, fragments } = load()
  const text = renderBundle(roster, bySlug(roster, 'cto'), fragments)
  assert.match(text, /You report to \*\*Focx CEO\*\*/)
  assert.match(text, /Your direct reports are .*QA Engineer/)

  const moved = clone(roster)
  bySlug(moved, 'qa-engineer').reportsTo = 'head-of-product'
  const after = renderBundle(moved, bySlug(moved, 'cto'), fragments)
  assert.doesNotMatch(after, /Your direct reports are .*QA Engineer/, 'prose tree follows reportsTo')
})

test('the root bundle names Ryan rather than an agent', () => {
  const { roster, fragments } = load()
  const text = renderBundle(roster, bySlug(roster, 'ceo'), fragments)
  assert.match(text, /You report to \*\*Ryan\*\*/)
})

test('repo discipline is selected by workspace, never by tier', () => {
  const { roster, fragments } = load()
  for (const a of roster.agents) {
    const text = renderBundle(roster, a, fragments)
    const hasRepo = text.includes('## Repository discipline')
    assert.equal(hasRepo, a.workspace !== 'none', `${a.slug} (tier=${a.tier}, workspace=${a.workspace})`)
    if (!hasRepo) assert.match(text, /## No code access/, `${a.slug} must be told it has none`)
  }
  // Chief of Staff is a manager with a repo; AI Experience is an IC without one.
  assert.equal(bySlug(roster, 'chief-of-staff').tier, 'manager')
  assert.notEqual(bySlug(roster, 'chief-of-staff').workspace, 'none')
  assert.equal(bySlug(roster, 'ai-experience').workspace, 'none')
})

test('the design-chain fragment goes to exactly the three design-chain agents', () => {
  const { roster, fragments } = load()
  const withChain = roster.agents.filter((a) => renderBundle(roster, a, fragments).includes('## The design chain')).map((a) => a.slug)
  assert.deepEqual(withChain.sort(), ['design-research', 'design-steward', 'product-designer'])
})

test('every bundle carries the company goal and the budget in dollars', () => {
  const { roster, fragments } = load()
  for (const a of roster.agents) {
    const text = renderBundle(roster, a, fragments)
    assert.ok(text.includes(roster.goal), `${a.slug} is missing the goal`)
    assert.ok(text.includes('$2.00'), `${a.slug} is missing its budget`)
    assert.ok(!text.includes('{{'), `${a.slug} has an unsubstituted placeholder`)
  }
})

test('the design chain is three distinct agents, and the researcher cannot implement', () => {
  const { roster } = load()
  const dc = roster.designChain
  assert.equal(new Set([dc.proposer, dc.approver, dc.researcher]).size, 3)
  const res = bySlug(roster, dc.researcher)
  assert.equal(res.git, 'read', 'a researcher that can push is not independent of what it evaluates')
  assert.ok(!('GH_TOKEN' in composeEnv(roster, res)))
  assert.ok(!(dc.figmaWrite ?? []).includes(dc.researcher))
})

test('research informs and never gates', () => {
  const { roster } = load()
  assert.equal(roster.designChain.researchPolicy.gatesApproval, false)
})

test('rejects a researcher that is also the proposer or approver', () => {
  rejects((r) => { r.designChain.researcher = r.designChain.approver }, 'three different agents')
  rejects((r) => { r.designChain.researcher = r.designChain.proposer }, 'three different agents')
})

test('rejects a researcher with git write', () => rejects((r) => {
  bySlug(r, r.designChain.researcher).git = 'write'
}, 'not independent of what it evaluates'))

test('rejects research that gates approval', () => rejects((r) => {
  r.designChain.researchPolicy.gatesApproval = true
}, 'research informs, it does not decide'))

test('the researcher bundle refuses to claim user evidence it does not have', () => {
  const { roster, fragments } = load()
  const text = renderBundle(roster, bySlug(roster, 'design-research'), fragments)
  assert.match(text, /Heuristic evaluation is not user evidence/)
  assert.match(text, /kind=user-study/)
  assert.match(text, /DESIGN_EVIDENCE/)
})

// ---------------------------------------------------------------------------
// planActions — idempotency
// ---------------------------------------------------------------------------

const FAKE_SECRET_IDS = new Map([
  ['claude_subscription_token', 'sec-claude-0001'],
  ['github_focx_write_token', 'sec-github-0002'],
])

const asLive = (roster, rendered) => roster.agents.map((a, i) => ({
  id: `id-${i}`, name: a.name, status: 'idle',
  reportsTo: a.reportsTo ? `id-${roster.agents.findIndex((x) => x.slug === a.reportsTo)}` : null,
  adapterType: a.adapter.type,
  adapterConfig: composeAdapterConfig(roster, a, FAKE_SECRET_IDS),
  runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true, maxConcurrentRuns: a.run.maxConcurrentRuns } },
  budgetMonthlyCents: a.budgetMonthlyCents,
  permissions: { canCreateAgents: false, canAssignTasks: a.permissions.canAssignTasks },
  instructionsBundle: { files: { 'AGENTS.md': rendered.get(a.slug) } },
  metadata: { focx: { slug: a.slug } },
}))

test('an empty company plans 25 creates and no terminations', () => {
  const { roster } = load()
  const plan = planActions(roster, { agents: [], routines: [] })
  assert.equal(plan.create.length, 26)
  assert.equal(plan.terminate.length, 0)
  assert.equal(plan.routineCreate.length, 10)
  assert.equal(plan.create[0].slug, 'ceo', 'created in reporting order')
})

test('a matching company plans zero changes — the idempotency proof', () => {
  const { roster, fragments } = load()
  const rendered = renderAll(roster, fragments)
  const live = { agents: asLive(roster, rendered), routines: roster.routines.map((r, i) => ({ id: `r-${i}`, title: r.title })) }
  const plan = planActions(roster, live)
  assert.equal(plan.create.length, 0)
  assert.equal(plan.terminate.length, 0)
  assert.equal(plan.routineCreate.length, 0)
  assert.equal(plan.update.length, 26)
})

test('an agent renamed in the UI is updated, not duplicated', () => {
  const { roster, fragments } = load()
  const rendered = renderAll(roster, fragments)
  const live = { agents: asLive(roster, rendered), routines: [] }
  live.agents.find((a) => a.metadata.focx.slug === 'head-of-growth').name = 'CMO'
  const plan = planActions(roster, live)
  assert.equal(plan.create.length, 0, 'slug-keyed, so a rename is not a new agent')
  assert.equal(plan.terminate.length, 0, 'and not a termination either')
})

test('a name-matched agent with no focx metadata is adopted once, not duplicated', () => {
  const { roster } = load()
  const live = { agents: [{ id: 'legacy-1', name: 'QA Engineer', status: 'idle' }], routines: [] }
  const plan = planActions(roster, live)
  assert.equal(plan.adopt.length, 1)
  assert.equal(plan.adopt[0].slug, 'qa-engineer')
  assert.equal(plan.terminate.length, 0)
  assert.equal(plan.create.length, 25)
})

test('live agents absent from the roster are planned for termination', () => {
  const { roster } = load()
  const live = { agents: [
    { id: 'x1', name: 'Development Agent', status: 'idle' },
    { id: 'x2', name: 'Security Review Agent', status: 'idle' },
    { id: 'x3', name: 'Gone Already', status: 'terminated' },
  ], routines: [] }
  const plan = planActions(roster, live)
  assert.deepEqual(plan.terminate.map((t) => t.name).sort(), ['Development Agent', 'Security Review Agent'])
})

// ---------------------------------------------------------------------------
// The CLI, and the live half against the fake API
// ---------------------------------------------------------------------------

const cli = async (args, env = {}) => {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } })
    return { code: 0, stdout, stderr }
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

test('--render-only works with no credential and no service', async () => {
  const r = await cli(['--render-only'], { PAPERCLIP_API_KEY: '', PAPERCLIP_API_URL: 'http://127.0.0.1:9' })
  assert.equal(r.code, 0)
  assert.match(r.stdout, /rendered 26 bundles offline/)
})

test('a missing credential exits 3 and names the human-only step', async () => {
  const r = await cli([], { PAPERCLIP_API_KEY: '' })
  assert.equal(r.code, 3)
  assert.match(r.stderr, /paperclipai auth login/)
})

test('a company-id conflict exits 2 before touching anything', async () => {
  const r = await cli([], { PAPERCLIP_API_KEY: 'k', PAPERCLIP_COMPANY_ID: '00000000-0000-0000-0000-000000000000' })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /does not match roster.company.id/)
})

test('an unknown flag exits 2', async () => {
  const r = await cli(['--yolo'])
  assert.equal(r.code, 2)
})

test('dry run against the fake API plans the full build and changes nothing', async () => {
  const { roster } = load()
  const fake = createFakeApi({ companyId: roster.company.id, seedAgents: [
    { id: 'old-1', name: 'Development Agent', status: 'idle' },
    { id: 'old-2', name: 'Security & Privacy Agent', status: 'idle' },
  ] })
  const url = await fake.listen()
  try {
    const r = await cli([], { PAPERCLIP_API_KEY: 'board-token', PAPERCLIP_API_URL: url })
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /terminate 2/)
    assert.match(r.stdout, /create {4}26/)
    assert.match(r.stdout, /Dry run — nothing was changed/)
    const writes = fake.state.calls.filter((c) => c.method !== 'GET')
    assert.deepEqual(writes, [], 'a dry run issues no writes at all')
  } finally { await fake.close() }
})

test('--apply refuses when --confirm-terminate does not match, before writing anything', async () => {
  const { roster } = load()
  const fake = createFakeApi({ companyId: roster.company.id, seedAgents: [{ id: 'old-1', name: 'Development Agent', status: 'idle' }] })
  const url = await fake.listen()
  try {
    const r = await cli(['--apply', '--confirm-terminate=5'], { PAPERCLIP_API_KEY: 'k', PAPERCLIP_API_URL: url })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /does not match the 1 termination/)
    assert.deepEqual(fake.state.calls.filter((c) => c.method !== 'GET'), [])
  } finally { await fake.close() }
})

// The skills step used to POST { desiredSkills } with no mode. The API requires
// one and 422s without it, so every agent's skills were silently skipped while
// the run still exited 0 with a green board — verify never reads skills.
test('--apply syncs skills with mode replace, and exits 0', async () => {
  const { roster } = load()
  const fake = createFakeApi({ companyId: roster.company.id })
  const url = await fake.listen()
  try {
    const r = await cli(['--apply', '--confirm-terminate=0'], { PAPERCLIP_API_KEY: 'k', PAPERCLIP_API_URL: url })
    assert.equal(r.code, 0, r.stderr)
    const syncs = fake.state.calls.filter((c) => /\/skills\/sync$/.test(c.path))
    const wanted = roster.agents.filter((a) => (a.desiredSkills ?? []).length).length
    assert.equal(syncs.length, wanted, 'every agent with desiredSkills is synced')
    for (const c of syncs) {
      assert.equal(c.body.mode, 'replace', 'the roster is the complete desired set, so replace')
      assert.ok(Array.isArray(c.body.desiredSkills) && c.body.desiredSkills.length)
    }
  } finally { await fake.close() }
})

test('a failed skills sync is a partial apply, not a green run', async () => {
  const { roster } = load()
  const fake = createFakeApi({ companyId: roster.company.id, failSkillSync: true })
  const url = await fake.listen()
  try {
    const r = await cli(['--apply', '--confirm-terminate=0'], { PAPERCLIP_API_KEY: 'k', PAPERCLIP_API_URL: url })
    assert.equal(r.code, 4, 'exit 4 — mixed state, rerun must be deliberate')
    assert.match(r.stderr, /PARTIAL APPLY/)
  } finally { await fake.close() }
})

test('the create payload never sends canAssignTasks — the API rejects it there', () => {
  const { roster, fragments } = load()
  const rendered = renderAll(roster, fragments)
  for (const a of roster.agents) {
    const p = buildAgentPayload(roster, a, rendered.get(a.slug), null)
    assert.ok(!('canAssignTasks' in p.permissions), `${a.slug}`)
    assert.equal(p.permissions.canCreateAgents, false)
    assert.equal(p.metadata.focx.slug, a.slug)
    assert.equal(p.instructionsBundle.entryFile, 'AGENTS.md')
  }
})

test('verify passes against a live org built from the roster, and catches drift', () => {
  const { roster, fragments } = load()
  const rendered = renderAll(roster, fragments)
  const agents = asLive(roster, rendered)
  const cfgs = new Map(agents.map((a) => [a.id, {
    adapterType: a.adapterType, adapterConfig: a.adapterConfig,
    runtimeConfig: a.runtimeConfig, permissions: a.permissions,
  }]))
  const bundles = new Map(agents.map((a) => [a.id, a.instructionsBundle.files['AGENTS.md']]))
  const routines = roster.routines.map((r, i) => ({ id: `r-${i}`, title: r.title, assigneeAgentId: agents[roster.agents.findIndex((x) => x.slug === r.owner)].id }))
  const triggers = new Map(routines.map((r, i) => [r.id, [{ id: `t-${i}`, kind: 'schedule', enabled: true, cronExpression: roster.routines[i].cron, timezone: roster.routines[i].timezone }]]))
  const live = { agents, routines, triggers, configurations: cfgs, bundles, company: { budgetMonthlyCents: 6000 } }

  const rows = verify(roster, live, rendered)
  const failed = rows.filter((r) => !r.pass)
  assert.deepEqual(failed.map((f) => `${f.n}: ${f.detail}`), [], 'a correctly built org passes every check')

  // A hand-edit in the Paperclip UI must surface as drift, not become the org.
  const drifted = new Map(bundles)
  drifted.set(agents[0].id, 'hand-edited in the UI')
  const after = verify(roster, { ...live, bundles: drifted }, rendered)
  assert.ok(after.find((r) => r.n === 10 && !r.pass), 'check 10 catches a bundle hand-edit')

  // And so must a reviewer quietly gaining write access.
  const withToken = new Map(cfgs)
  const stewardId = agents[roster.agents.findIndex((a) => a.slug === 'design-steward')].id
  const c = { ...withToken.get(stewardId) }
  c.adapterConfig = { ...c.adapterConfig, env: { ...c.adapterConfig.env, GH_TOKEN: 'x' } }
  withToken.set(stewardId, c)
  const after2 = verify(roster, { ...live, configurations: withToken }, rendered)
  assert.ok(after2.find((r) => r.n === 11 && !r.pass), 'check 11 catches Design Steward gaining GH_TOKEN')
})

test('PaperclipClient never puts the key in an error message', async () => {
  const client = new PaperclipClient({ baseUrl: 'http://127.0.0.1:9', apiKey: 'super-secret-token', timeoutMs: 200 })
  await assert.rejects(() => client.get('/api/health'), (err) => !String(err.message).includes('super-secret-token'))
})

test('liveSlug reads the focx metadata key and tolerates its absence', () => {
  assert.equal(liveSlug({ metadata: { focx: { slug: 'cto' } } }), 'cto')
  assert.equal(liveSlug({ metadata: {} }), null)
  assert.equal(liveSlug({}), null)
  assert.equal(liveSlug(null), null)
})

test('every routine payload carries the project', () => {
  const { roster } = load()
  for (const r of roster.routines) {
    const p = buildRoutinePayload(roster, r, 'agent-id')
    assert.equal(p.projectId, roster.project.id, `${r.key} has no project — its issues would get no worktree`)
  }
})

test('rejects repo-tier routines with no project configured', () => {
  const { roster, instructionFiles } = load()
  const r = clone(roster)
  delete r.project
  const errs = validateRoster(r, { instructionFiles })
  assert.ok(errs.some((e) => e.includes('not a git repository')), errs.join('\n'))
})

test('repo-tier agents are told to carry the project into child issues', () => {
  const { roster, fragments } = load()
  const cto = renderBundle(roster, bySlug(roster, 'cto'), fragments)
  assert.match(cto, /carry the project across/i)
  assert.match(cto, /not a git repository/)
  // Non-repo agents have no worktree, so the rule would be noise for them.
  const ceo = renderBundle(roster, bySlug(roster, 'ceo'), fragments)
  assert.doesNotMatch(ceo, /carry the project across/i)
})

// ---------------------------------------------------------------------------
// Charter coupling — the check that stops the QA rename breaking every run
// ---------------------------------------------------------------------------

test('the development charter hands off to an agent that exists in the roster', () => {
  const { roster } = load()
  const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8')
  assert.deepEqual(checkCharterCoupling(roster, read), [])
})

test('coupling check catches a charter naming an agent the roster does not have', () => {
  const { roster } = load()
  const stale = () => 'Hand it off to the separate Paperclip agent named `QA` in the same company.'
  const problems = checkCharterCoupling(roster, stale)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /agent named 'QA', which is not in the roster/)
  assert.match(problems[0], /halt as blocked/)
})

test('coupling check reports when it can no longer see any handoff at all', () => {
  const { roster } = load()
  const problems = checkCharterCoupling(roster, () => 'a charter that names nobody')
  assert.equal(problems.length, 1)
  assert.match(problems[0], /has gone blind/)
})

test('coupling check accepts the current roster name', () => {
  const { roster } = load()
  assert.deepEqual(checkCharterCoupling(roster, () => 'assign it to the agent named `QA Engineer`'), [])
})
