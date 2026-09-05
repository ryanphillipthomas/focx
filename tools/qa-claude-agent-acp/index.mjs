#!/usr/bin/env node
// Only the QA Paperclip adapter selects this launcher. Permission values remain
// owned by .focx/agents.json; the worktree file is a generated runtime mirror.
import {readFileSync, lstatSync, realpathSync, writeFileSync, renameSync, unlinkSync} from 'node:fs'
import {resolve, dirname, join} from 'node:path'
import {homedir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {spawn, execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {loadSource} from '../pilot-org/index.mjs'

export const COMMAND = 'node tools/qa-claude-agent-acp/index.mjs'
export const entrypoint = () => join(homedir(), '.paperclip/cli/current/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js')
const requireThat = (ok, message) => { if (!ok) throw Error(message) }
const object = value => value && typeof value === 'object' && !Array.isArray(value)
export function mergeSettings(existing, rules, cwd) {
  requireThat(object(existing) && object(existing.permissions), 'Expected Paperclip local settings before QA launch')
  const p = existing.permissions
  requireThat(p.defaultMode === 'default', 'Unexpected permission mode; refusing to override it')
  requireThat(Array.isArray(p.allow) && p.allow.every(x => typeof x === 'string'), 'Malformed local allow-list')
  // These are the installed Paperclip writer's five rules, not agent authority.
  // Reject new vendor or stale agent entries for review instead of accumulating
  // grants across launches. Preserve ask/deny and other local settings verbatim.
  const vendor = ['Bash(curl:*)', 'Bash(env:*)', 'Bash(env)', `Bash(${cwd}/scripts/paperclip-issue-update.sh:*)`, `Bash(${cwd}/scripts/paperclip:*)`]
  requireThat(vendor.every(x => p.allow.includes(x)), 'Paperclip local settings are incomplete')
  requireThat(p.allow.every(x => vendor.includes(x) || rules.includes(x)), 'Unknown or stale local permission rule; review required')
  return {...existing, permissions:{...p, allow:[...new Set([...vendor, ...rules])].sort()}}
}
export function validateContext({source, env, cwd, root, branch, commonDir}) {
  const qa = source.manifest.agents.find(a => a.roleKey === 'qa-engineer')
  requireThat(qa?.adapterLocal?.permissionDelivery === 'qa-worktree-local', 'QA permission delivery is not declared')
  requireThat(env.PAPERCLIP_AGENT_ID === qa.id && env.PAPERCLIP_COMPANY_ID === source.manifest.companyId, 'Launcher is restricted to the assigned QA agent and company')
  requireThat(/^[0-9a-f-]{36}$/.test(env.PAPERCLIP_RUN_ID ?? '') && /^[0-9a-f-]{36}$/.test(env.PAPERCLIP_TASK_ID ?? ''), 'A bound Paperclip task and run are required')
  requireThat(cwd === root && /^FOC-\d+-/.test(branch), 'QA must run at its FOC issue worktree root')
  const parent = resolve(commonDir, '..')
  requireThat(cwd.startsWith(join(parent, '.paperclip/worktrees') + '/') && commonDir !== join(cwd, '.git'), 'Refusing to write settings outside an isolated Paperclip worktree')
  return qa.adapterLocal.permissionsAllow
}
export function prepare({env=process.env, cwd=realpathSync(process.cwd()), root=resolve(dirname(fileURLToPath(import.meta.url)), '../..')}={}) {
  cwd = realpathSync(cwd)
  const git = (...args) => execFileSync('git', args, {cwd, encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim()
  const source = loadSource(root)
  const rules = validateContext({source, env, cwd, root:realpathSync(root), branch:git('branch','--show-current'), commonDir:realpathSync(resolve(cwd, git('rev-parse','--git-common-dir')))})
  requireThat(!lstatSync(join(cwd,'.claude')).isSymbolicLink(), 'Refusing symlinked .claude directory')
  const settingsPath = join(cwd,'.claude/settings.local.json')
  requireThat(lstatSync(settingsPath).isFile() && !lstatSync(settingsPath).isSymbolicLink(), 'Local settings must be a regular file')
  const next = mergeSettings(JSON.parse(readFileSync(settingsPath,'utf8')), rules, cwd)
  const temp = `${settingsPath}.qa-${process.pid}`
  try {
    writeFileSync(temp, JSON.stringify(next,null,2)+'\n', {flag:'wx', mode:0o600})
    renameSync(temp,settingsPath)
  } finally { try { unlinkSync(temp) } catch (e) { if(e.code !== 'ENOENT') throw e } }
  const readback = JSON.parse(readFileSync(settingsPath,'utf8'))
  requireThat(JSON.stringify(readback) === JSON.stringify(next), 'Local settings readback differs')
  return {rules:rules.length, digest:createHash('sha256').update(JSON.stringify(rules)).digest('hex')}
}
async function main() {
  const target = realpathSync(entrypoint()) // No installs, PATH fallback, or vendor edits.
  const evidence = prepare()
  console.error(`[focx-qa-permissions] local settings ready rules=${evidence.rules} sha256=${evidence.digest}`)
  const child = spawn(process.execPath,[target,...process.argv.slice(2)],{stdio:'inherit',env:process.env})
  for(const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal,()=>child.kill(signal))
  child.on('error',()=>{ console.error('[focx-qa-permissions] ACP child failed to start'); process.exitCode=1 })
  child.on('exit',(code,signal)=>{process.exitCode=code ?? (signal ? 1 : 0)})
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e=>{console.error(`[focx-qa-permissions] stopped: ${e.message}`);process.exitCode=1})
