import { isDeepStrictEqual as same } from 'node:util'

export const REGISTRY_SKILLS = ['paperclipai/paperclip/paperclip']
export const requireThat = (ok, message) => { if (!ok) throw new Error(message) }
export const slugOf = a => a.urlKey ?? a.name?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const pairs = (contract, live) => contract.agents.map(a => [a, live.agents.find(b => slugOf(b) === a.slug)])
const check = (contract, live, fn) => pairs(contract, live).flatMap(([a,b]) => b ? fn(a,b).map(s => `${a.slug}: ${s}`) : [`${a.slug}: missing agent`])
const positiveCap = n => Number.isInteger(n) && n > 0
const dailyCap = n => Number.isInteger(n) && n >= 0
export function tighter(live, target) {
  if (target === null) return positiveCap(live) ? live : null
  return positiveCap(live) ? Math.min(live, target) : target
}
export function tighterDaily(live,target) {
  requireThat(live===undefined || live===null || dailyCap(live),'Invalid live maxDailyRuns; refuse to rewrite it')
  return dailyCap(live) ? (target===null?live:Math.min(live,target)) : target
}
const dailyAtMost=(live,target)=>target===null?live===null||dailyCap(live):dailyCap(live)&&live<=target
const atMost = (live, target) => target === null ? live === null || positiveCap(live) : positiveCap(live) && live <= target
export const instructionPaths = a => ['AGENTS.md', ...a.skills.map(s => `skills/${s}/SKILL.md`)]
export const bypassFlag = a => a.adapterType === 'claude_local' ? 'dangerouslySkipPermissions' : 'dangerouslyBypassApprovalsAndSandbox'

export function invariant1(contract, live) {
  return same(live.agents.map(slugOf).sort(), contract.agents.map(a => a.slug).sort()) ? [] : [`Exact slug set differs; observed ids: ${live.agents.map(a => `${slugOf(a)}=${a.id}`).join(', ')}`]
}
export function invariant2(contract, live) {
  return check(contract, live, (a,b) => b.status === 'paused' && b.companyId === live.company.id ? [] : ['must be paused in the expected company'])
}
export function invariant3(contract, live) {
  return check(contract, live, (a,b) => b.adapterType === a.adapterType ? [] : ['adapter mismatch; a declared migration is not a performed migration'])
}
export function invariant4(contract, live) {
  return check(contract, live, (a,b) => b.files && Object.keys(b.files).every(p => instructionPaths(a).includes(p)) ? [] : ['instruction bundle has unknown files; nothing may be deleted'])
}
export function invariant5(contract, live) {
  return check(contract, live, (a,b) => same(b.desiredSkills, REGISTRY_SKILLS) ? [] : ['registry skills must equal the non-empty Paperclip singleton'])
}
export function invariant6(contract, live) {
  return Array.isArray(live.triggers) && live.triggers.every(t => t.kind !== 'schedule' || t.enabled === false) ? [] : ['every schedule trigger must be disabled']
}
export function invariant7(contract, live) {
  return check(contract, live, (a,b) => {
    const h = b.runtimeConfig?.heartbeat ?? {}, old = live.previous?.agents.find(x => x.id === b.id)?.runtimeConfig?.heartbeat
    const errors = []
    if (!(h.enabled === false && h.wakeOnDemand === false && h.maxTurnContinuation?.enabled === false && h.maxConcurrentRuns === 1)) errors.push('all heartbeat wake paths must be explicitly closed and concurrency one')
    if (!dailyAtMost(h.maxDailyRuns, a.limits.maxDailyRuns) || (dailyCap(old?.maxDailyRuns) && !dailyAtMost(h.maxDailyRuns, old.maxDailyRuns))) errors.push('maxDailyRuns cannot loosen a finite cap or replace it with null')
    return errors
  })
}
export function invariant8(contract, live) {
  return check(contract, live, (a,b) => {
    const c = b.adapterConfig ?? {}, old = live.previous?.agents.find(x => x.id === b.id)?.adapterConfig ?? {}
    const errors = []
    const mode = old.permissionMode ?? old.acpPermissionMode
    const unattended = old.nonInteractivePermissions ?? old.acpNonInteractivePermissions
    if (!['approve-reads','deny-all'].includes(c.permissionMode) || (mode === 'deny-all' && c.permissionMode !== 'deny-all')) errors.push('permissionMode must preserve a stricter deny-all')
    if (!['deny','fail'].includes(c.nonInteractivePermissions) || (unattended === 'fail' && c.nonInteractivePermissions !== 'fail')) errors.push('nonInteractivePermissions must preserve a stricter fail')
    if (c[bypassFlag(a)] !== false || c.dangerouslySkipPermissions === true || c.dangerouslyBypassApprovalsAndSandbox === true) errors.push('both adapter lanes must have their bypass flag explicitly false')
    if (b.permissions?.canCreateAgents !== false || b.permissions?.canCreateSkills !== false) errors.push('stored creation permissions must be false')
    if (c.engine !== 'acp') errors.push('engine must be acp without CLI fallback')
    if (!atMost(c.timeoutSec, a.limits.timeoutSec) || (positiveCap(old.timeoutSec) && !atMost(c.timeoutSec,old.timeoutSec))) errors.push('per-run timeout must remain bounded')
    if (a.limits.maxTurnsPerRun !== null && (!atMost(c.maxTurnsPerRun,a.limits.maxTurnsPerRun) || (positiveCap(old.maxTurnsPerRun) && !atMost(c.maxTurnsPerRun,old.maxTurnsPerRun)))) errors.push('Claude turn limit must remain bounded')
    return errors
  })
}
export const invariants = [invariant1,invariant2,invariant3,invariant4,invariant5,invariant6,invariant7,invariant8]
export function assess(contract, live, numbers = [1,2,3,4,5,6,7,8]) {
  return numbers.flatMap(n => invariants[n-1](contract,live).map(message => ({ invariant:n, message })))
}
export function assertInvariants(contract, live, numbers) {
  const failures = assess(contract,live,numbers)
  requireThat(!failures.length, failures.map(f => `Invariant ${f.invariant}: ${f.message}`).join('\n'))
}
// P20: effective assignment is evidence, not a persisted deny. Revocation of
// the explicit grant is checked separately as the completion of step 2.
export const accessReport = live => live.agents.map(a => ({slug:slugOf(a),canAssignTasks:a.access?.canAssignTasks,taskAssignSource:a.access?.taskAssignSource}))
