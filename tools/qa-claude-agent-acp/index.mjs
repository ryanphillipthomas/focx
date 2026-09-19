#!/usr/bin/env node
// Selected by a Paperclip adapter for any role that declares worktree-local
// permission delivery. The role is derived from the resolved agent's urlKey and
// checked against the manifest — never hardcoded here. Permission values remain
// owned by .focx/agents.json; the worktree file is a generated runtime mirror.
// (Path kept as-is: it is the command registered with the live QA adapter.)
import {readFileSync, lstatSync, realpathSync, writeFileSync, renameSync, unlinkSync} from 'node:fs'
import {resolve, dirname, join} from 'node:path'
import {homedir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {spawn, execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {loadRoleSource} from '../../packages/focx-bot/src/roles.mjs'

export const COMMAND = 'node tools/qa-claude-agent-acp/index.mjs'
export const entrypoint = () => join(homedir(), '.paperclip/cli/current/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js')
const requireThat = (ok, message) => { if (!ok) throw Error(message) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
export function mergeSettings(existing, rules, cwd, denyRules) {
  requireThat(object(existing) && object(existing.permissions), 'Expected Paperclip local settings before launch')
  requireThat(Array.isArray(denyRules) && denyRules.length > 0, 'Declared tool denials are required')
  const p = existing.permissions
  requireThat(p.deny === undefined || (Array.isArray(p.deny) && p.deny.every(x => typeof x === 'string')), 'Malformed local deny-list')
  requireThat(p.defaultMode === 'default', 'Unexpected permission mode; refusing to override it')
  requireThat(Array.isArray(p.allow) && p.allow.every(x => typeof x === 'string'), 'Malformed local allow-list')
  // These are the installed Paperclip writer's five rules, not agent authority.
  // Reject new vendor or stale agent entries for review instead of accumulating
  // grants across launches. Preserve ask/deny and other local settings verbatim.
  const vendor = ['Bash(curl:*)', 'Bash(env:*)', 'Bash(env)', `Bash(${cwd}/scripts/paperclip-issue-update.sh:*)`, `Bash(${cwd}/scripts/paperclip:*)`]
  requireThat(vendor.every(x => p.allow.includes(x)), 'Paperclip local settings are incomplete')
  requireThat(p.allow.every(x => vendor.includes(x) || rules.includes(x)), 'Unknown or stale local permission rule; review required')
  return {...existing, permissions:{...p, allow:[...new Set([...vendor, ...rules])].sort(), deny:[...new Set([...(p.deny ?? []), ...denyRules])].sort()}}
}
export function validateContext(resolvedAgent, {source, env, resolvedCompany, cwd, root, branch, commonDir}) {
  requireThat(object(resolvedAgent) && ['id','urlKey','companyId','adapterType','name'].every(key => typeof resolvedAgent[key] === 'string' && resolvedAgent[key].trim()), 'Paperclip agent identity is incomplete')
  // The live agent names its own role; the manifest decides whether that role is
  // entitled to worktree-local permission delivery. Neither is assumed here.
  const role = source.manifest.agents.find(a => a.roleKey === resolvedAgent.urlKey)
  requireThat(role !== undefined, 'Resolved Paperclip role is not declared in the manifest')
  requireThat(role.disposition === 'pilot', 'Only a declared pilot role may use the worktree-local launcher')
  requireThat(typeof role.adapterLocal?.permissionDelivery === 'string' && role.adapterLocal.permissionDelivery.endsWith('-worktree-local'), `${role.roleKey}: worktree-local permission delivery is not declared`)
  requireThat(resolvedAgent.companyId === env.PAPERCLIP_COMPANY_ID && resolvedAgent.adapterType === 'claude_local' && resolvedAgent.id === env.PAPERCLIP_AGENT_ID, 'Paperclip agent identity does not match the assigned role, company and adapter')
  requireThat(/^[0-9a-f-]{36}$/.test(env.PAPERCLIP_RUN_ID ?? '') && /^[0-9a-f-]{36}$/.test(env.PAPERCLIP_TASK_ID ?? ''), 'A bound Paperclip task and run are required')
  requireThat(cwd === root, 'The agent must run at its issue worktree root')
  requireThat(object(resolvedCompany) && resolvedCompany.id === resolvedAgent.companyId && resolvedCompany.id === env.PAPERCLIP_COMPANY_ID, 'Paperclip company identity does not match the assigned company')
  const prefix = resolvedCompany.issuePrefix
  requireThat(typeof prefix === 'string' && /^[A-Z][A-Z0-9]*$/.test(prefix), 'Authoritative Paperclip company issue prefix is unavailable')
  requireThat(typeof branch === 'string' && branch.startsWith(prefix + '-') && /^\d+-/.test(branch.slice(prefix.length + 1)), `Branch ${JSON.stringify(branch)} must be an issue branch with company prefix ${JSON.stringify(prefix)}`)
  const parent = resolve(commonDir, '..')
  requireThat(cwd.startsWith(join(parent, '.paperclip/worktrees') + '/') && commonDir !== join(cwd, '.git'), 'Refusing to write settings outside an isolated Paperclip worktree')
  return role.adapterLocal.permissionsAllow
}
async function resolveAgent(env, fetch) {
  for (const key of ['PAPERCLIP_API_URL','PAPERCLIP_API_KEY','PAPERCLIP_AGENT_ID','PAPERCLIP_COMPANY_ID']) requireThat(typeof env[key] === 'string' && env[key].trim(), key + ' is required')
  requireThat(/^[0-9a-f-]{36}$/.test(env.PAPERCLIP_RUN_ID ?? '') && /^[0-9a-f-]{36}$/.test(env.PAPERCLIP_TASK_ID ?? ''), 'A bound Paperclip task and run are required')
  let response
  try {
    response = await fetch(env.PAPERCLIP_API_URL.replace(/\/$/, '') + '/api/agents/' + encodeURIComponent(env.PAPERCLIP_AGENT_ID), {
      method:'GET', redirect:'error', signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer ' + env.PAPERCLIP_API_KEY, 'X-Paperclip-Run-Id':env.PAPERCLIP_RUN_ID}
    })
  } catch { throw Error('Paperclip agent identity request failed') }
  requireThat(response?.status === 200, 'Paperclip agent identity request did not return HTTP 200')
  try {
    const body = await response.json()
    requireThat(object(body), 'Invalid agent record')
    // Select only identity metadata; never expose the response or upstream errors.
    const {id, urlKey, companyId, adapterType, name} = body
    return {id, urlKey, companyId, adapterType, name}
  } catch { throw Error('Paperclip agent identity response is not a JSON object') }
}
async function resolveCompany(env, resolvedAgent, fetch) {
  let response
  try {
    response = await fetch(env.PAPERCLIP_API_URL.replace(/\/$/, '') + '/api/companies/' + encodeURIComponent(resolvedAgent.companyId), {
      method:'GET', redirect:'error', signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer ' + env.PAPERCLIP_API_KEY, 'X-Paperclip-Run-Id':env.PAPERCLIP_RUN_ID}
    })
  } catch { throw Error('Paperclip company identity request failed') }
  requireThat(response?.status === 200, 'Paperclip company identity request did not return HTTP 200')
  try {
    const body = await response.json()
    requireThat(object(body), 'Invalid company record')
    // The API company record is prefix authority; branch names and env hints are not.
    const {id, issuePrefix} = body
    return {id, issuePrefix}
  } catch { throw Error('Paperclip company identity response is not a JSON object') }
}
export async function prepare({env=process.env, cwd=realpathSync(process.cwd()), root=resolve(dirname(fileURLToPath(import.meta.url)), '../..'), fetch=globalThis.fetch}={}) {
  const resolvedAgent = await resolveAgent(env, fetch)
  const resolvedCompany = await resolveCompany(env, resolvedAgent, fetch)
  cwd = realpathSync(cwd)
  const git = (...args) => execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim()
  const source = loadRoleSource(root)
  const rules = validateContext(resolvedAgent, {source, env, resolvedCompany, cwd, root:realpathSync(root), branch:git('branch','--show-current'), commonDir:realpathSync(resolve(cwd, git('rev-parse','--git-common-dir')))})
  const role = source.manifest.agents.find(a => a.roleKey === resolvedAgent.urlKey)
  requireThat(!lstatSync(join(cwd,'.claude')).isSymbolicLink(), 'Refusing symlinked .claude directory')
  const settingsPath = join(cwd,'.claude/settings.local.json')
  requireThat(lstatSync(settingsPath).isFile() && !lstatSync(settingsPath).isSymbolicLink(), 'Local settings must be a regular file')
  const next = mergeSettings(JSON.parse(readFileSync(settingsPath,'utf8')), rules, cwd, role.adapterLocal.permissionsDeny)
  const temp = `${settingsPath}.${role.roleKey}-${process.pid}`
  try {
    writeFileSync(temp, JSON.stringify(next,null,2)+'\n', {flag:'wx', mode:0o600})
    renameSync(temp,settingsPath)
  } finally { try { unlinkSync(temp) } catch (e) { if(e.code !== 'ENOENT') throw e } }
  const readback = JSON.parse(readFileSync(settingsPath,'utf8'))
  requireThat(JSON.stringify(readback) === JSON.stringify(next), 'Local settings readback differs')
  return {rules:rules.length, digest:createHash('sha256').update(JSON.stringify({allow:next.permissions.allow,deny:next.permissions.deny})).digest('hex')}
}
async function main() {
  const target = realpathSync(entrypoint()) // No installs, PATH fallback, or vendor edits.
  const evidence = await prepare()
  console.error(`[focx-agent-permissions] local settings ready rules=${evidence.rules} sha256=${evidence.digest}`)
  const child = spawn(process.execPath,[target,...process.argv.slice(2)],{stdio:'inherit',env:process.env})
  for(const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal,()=>child.kill(signal))
  child.on('error',()=>{ console.error('[focx-agent-permissions] ACP child failed to start'); process.exitCode=1 })
  child.on('exit',(code,signal)=>{process.exitCode=code ?? (signal ? 1 : 0)})
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e=>{console.error(`[focx-agent-permissions] stopped: ${e.message}`);process.exitCode=1})
