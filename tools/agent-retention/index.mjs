#!/usr/bin/env node
// agent-retention — the retention clock and secret scrubber for the local agent
// data store: Claude transcripts under
// `<workspaces>/<agentId>/.claude/projects/**`, ACP session residue under
// `<companies>/<companyId>/acp-engine/agents/<agentId>/sessions/*.json`, and
// git worktrees under `.paperclip/worktrees/`.
//
// Dependency-free. The standard it enforces is docs/data-retention.md; the
// numbers it enforces come from retention.config.json at the repository root.
//
//   status                 what exists, how old it is, what the next sweep takes
//   scrub   [--apply]      redact secret patterns out of transcripts in place
//   sweep   [--apply]      delete expired transcripts and reclaimable worktrees
//   install-schedule       make expiry actually run (launchd, per-user)
//   uninstall-schedule
//
// Both scrub and sweep are dry-run by default. Nothing is deleted or rewritten
// without --apply.

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  transcripts: {
    // Every `<root>/<agentId>/.claude/projects/**` tree is in scope. Nothing
    // else under `.claude/` is — agent memory lives there and is not a
    // transcript.
    roots: ['~/.paperclip/instances/default/workspaces'],
    extensions: ['.jsonl', '.json'],
    retentionDays: 30,
    activeGraceMinutes: 120,
    // A transcript is only rewritten once its session has been quiet this long.
    scrubQuietMinutes: 15,
  },
  acpSessions: {
    roots: ['~/.paperclip/instances/default/companies'],
    extensions: ['.json'],
    scrubQuietMinutes: 15,
    // Binding safety invariant: ACP session files hold resumable state. They
    // are scrubbed in place but are never fed into the retention deletion plan.
    scrubOnly: true,
  },
  worktrees: {
    roots: ['.paperclip/worktrees'],
    retentionDays: 14,
    activeGraceMinutes: 120,
    // A worktree is only reclaimable once its work is somewhere durable.
    mergedInto: ['origin/develop', 'develop'],
  },
  log: {
    dir: '~/.paperclip/retention',
    retentionDays: 400,
  },
};

export function expandPath(value, repoRoot = REPO_ROOT) {
  if (value.startsWith('~')) return join(homedir(), value.slice(1));
  return resolve(repoRoot, value);
}

export function loadConfig({ repoRoot = REPO_ROOT, configPath, overrides = {} } = {}) {
  const path = configPath ?? join(repoRoot, 'retention.config.json');
  let file = {};
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      throw new Error(`retention config is not valid JSON (${path}): ${err.message}`);
    }
  }
  const merge = (key) => ({ ...DEFAULT_CONFIG[key], ...(file[key] ?? {}), ...(overrides[key] ?? {}) });
  return {
    repoRoot,
    configPath: existsSync(path) ? path : null,
    transcripts: merge('transcripts'),
    acpSessions: merge('acpSessions'),
    worktrees: merge('worktrees'),
    log: merge('log'),
  };
}

// ---------------------------------------------------------------------------
// Secret scrubbing
// ---------------------------------------------------------------------------

export const REDACTION = (kind) => `[redacted:${kind}]`;

// Ordered. Structural patterns first so a longer, more specific match wins
// before the generic assignment rule sees the same bytes.
export const SECRET_PATTERNS = [
  {
    kind: 'private-key',
    re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
  },
  { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { kind: 'openai-key', re: /\bsk-(?:proj-)?(?!ant-)[A-Za-z0-9_-]{32,}/g },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { kind: 'github-token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { kind: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'slack-token', re: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'stripe-key', re: /\b[srp]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    kind: 'bearer-token',
    re: /\b(Bearer\s+)(?!\[redacted:)[A-Za-z0-9._~+/-]{16,}={0,2}/gi,
    replace: (kind, match, prefix) => `${prefix}${REDACTION(kind)}`,
  },
  {
    // `FOO_TOKEN=value`, `"apiSecret": "value"`, `--password value` and friends.
    // The value class must exclude `\` as well as `"`: transcripts are JSON, so
    // a value ends at an *escaped* quote, and consuming that backslash would
    // leave an unescaped quote behind and corrupt the line.
    kind: 'generic-secret',
    re: /(["']?\b[A-Za-z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_.-]*\b["']?\s*[:=]\s*["']?)(?!\[redacted:)([^\s"'\\,;}\]]{12,})/gi,
    replace: (kind, match, prefix) => `${prefix}${REDACTION(kind)}`,
  },
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Exact-value patterns for the credentials this process can actually see. This
// is what catches a token whose format we do not have a rule for — including
// PAPERCLIP_API_KEY. Only the variable *name* is ever recorded anywhere.
export function envSecretPatterns(env = process.env) {
  const interesting = /(TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL)/i;
  const patterns = [];
  for (const [name, value] of Object.entries(env)) {
    if (!interesting.test(name)) continue;
    if (typeof value !== 'string') continue;
    if (value.length < 16) continue;
    if (/\s/.test(value)) continue;
    if (value.startsWith('/') || value.startsWith('~')) continue; // a path, not a secret
    patterns.push({ kind: `env:${name}`, re: new RegExp(escapeRegExp(value), 'g') });
  }
  return patterns;
}

export function scrubText(text, patterns = SECRET_PATTERNS) {
  const counts = {};
  let out = text;
  for (const pattern of patterns) {
    const replace = pattern.replace ?? ((kind) => REDACTION(kind));
    out = out.replace(pattern.re, (...args) => {
      counts[pattern.kind] = (counts[pattern.kind] ?? 0) + 1;
      return replace(pattern.kind, ...args);
    });
  }
  return { text: out, counts };
}

// Rewrites in place, atomically, and restores the original mtime: scrubbing a
// transcript must never reset its retention clock.
export function scrubFile(path, { apply = false, patterns = SECRET_PATTERNS } = {}) {
  const before = statSync(path);
  const original = readFileSync(path, 'utf8');
  const { text, counts } = scrubText(original, patterns);
  const changed = text !== original;
  if (changed && apply) {
    const tmp = `${path}.retention-tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, path);
    utimesSync(path, before.atime, before.mtime);
  }
  return { path, changed, counts, applied: changed && apply };
}

// ACP session JSON is different from a transcript: only the spawn-time
// `acpx.session_options.env` residue is in scope. Keeping the key set makes the
// adapter shape diagnosable without retaining any value. The whole JSON value
// is parsed before any write, so malformed or unexpected files fail closed.
export function scrubAcpSessionFile(path, { apply = false } = {}) {
  const before = statSync(path);
  const original = readFileSync(path, 'utf8');
  const document = JSON.parse(original);
  const env = document?.acpx?.session_options?.env;
  const counts = {};
  let changed = false;
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    for (const key of Object.keys(env)) {
      const redaction = REDACTION('session-env');
      if (env[key] === redaction) continue;
      env[key] = redaction;
      counts['session-env'] = (counts['session-env'] ?? 0) + 1;
      changed = true;
    }
  }
  if (changed && apply) {
    const tmp = `${path}.retention-tmp`;
    const trailingNewline = original.endsWith('\n') ? '\n' : '';
    writeFileSync(tmp, `${JSON.stringify(document, null, 2)}${trailingNewline}`, { mode: before.mode });
    renameSync(tmp, path);
    utimesSync(path, before.atime, before.mtime);
  }
  return { kind: 'acp-session', path, changed, counts, applied: changed && apply };
}

// ---------------------------------------------------------------------------
// Walking the store
// ---------------------------------------------------------------------------

function walkFiles(dir, extensions, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, extensions, out);
    else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

// `<root>/<agentId>/.claude/projects/**` only. Agent memory under
// `.claude/memory/` is deliberately out of scope.
export function listTranscripts(config) {
  const files = [];
  for (const root of config.transcripts.roots) {
    const base = expandPath(root, config.repoRoot);
    let agents;
    try {
      agents = readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const agent of agents) {
      if (!agent.isDirectory()) continue;
      const projects = join(base, agent.name, '.claude', 'projects');
      if (!existsSync(projects)) continue;
      walkFiles(projects, config.transcripts.extensions, files);
    }
  }
  return files.sort();
}

// `<companies>/<companyId>/acp-engine/agents/<agentId>/sessions/*.json` only.
// In particular, this does not recursively absorb the rest of a company tree.
export function listAcpSessions(config) {
  const files = [];
  for (const root of config.acpSessions.roots) {
    const companies = expandPath(root, config.repoRoot);
    let companyEntries;
    try {
      companyEntries = readdirSync(companies, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const company of companyEntries) {
      if (!company.isDirectory()) continue;
      const agents = join(companies, company.name, 'acp-engine', 'agents');
      let agentEntries;
      try {
        agentEntries = readdirSync(agents, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const agent of agentEntries) {
        if (!agent.isDirectory()) continue;
        const sessions = join(agents, agent.name, 'sessions');
        let sessionEntries;
        try {
          sessionEntries = readdirSync(sessions, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of sessionEntries) {
          if (entry.isFile() && config.acpSessions.extensions.some((ext) => entry.name.endsWith(ext))) {
            files.push(join(sessions, entry.name));
          }
        }
      }
    }
  }
  return files.sort();
}

function latestMtimeMs(dir, skip = new Set(['node_modules', '.git'])) {
  let latest = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    try {
      latest = Math.max(latest, statSync(current).mtimeMs);
    } catch {
      /* raced with a delete */
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          latest = Math.max(latest, statSync(full).mtimeMs);
        } catch {
          /* raced with a delete */
        }
      }
    }
  }
  return latest;
}

function realpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path; // does not exist yet — the literal path is the best answer
  }
}

function git(repoRoot, args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function gitOk(repoRoot, args) {
  try {
    git(repoRoot, args);
    return true;
  } catch {
    return false;
  }
}

// `.paperclip/worktrees` lives under the primary checkout. The tool usually runs
// from inside one of those worktrees, so a repo-relative root has to resolve
// against the primary checkout, not against wherever we happen to be.
export function primaryCheckout(repoRoot) {
  try {
    const commonDir = git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    return realpath(dirname(commonDir));
  } catch {
    return repoRoot;
  }
}

export function listWorktrees(config) {
  const base = primaryCheckout(config.repoRoot);
  // git reports resolved paths; `/var` is a symlink to `/private/var` on macOS,
  // so compare realpaths or the prefix match silently finds nothing.
  const dirs = config.worktrees.roots.map((root) => realpath(expandPath(root, base)));
  let porcelain;
  try {
    porcelain = git(config.repoRoot, ['worktree', 'list', '--porcelain']);
  } catch {
    return [];
  }
  const worktrees = [];
  let current = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), locked: false, branch: null, head: null };
      worktrees.push(current);
    } else if (!current) continue;
    else if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length);
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true;
  }
  return worktrees.filter((wt) => dirs.some((dir) => wt.path.startsWith(`${dir}/`)));
}

// ---------------------------------------------------------------------------
// Planning: what expires, what is held back, and why
// ---------------------------------------------------------------------------

export function planTranscripts(config, now = Date.now()) {
  const { retentionDays, activeGraceMinutes } = config.transcripts;
  const graceMs = activeGraceMinutes * 60_000;
  return listTranscripts(config).map((path) => {
    const stat = statSync(path);
    const ageMs = now - stat.mtimeMs;
    const ageDays = ageMs / DAY_MS;
    let verdict = 'retain';
    let reason = `within ${retentionDays}d retention`;
    if (ageMs < graceMs) {
      reason = 'active — inside the write grace window';
    } else if (ageDays > retentionDays) {
      verdict = 'expire';
      reason = `older than ${retentionDays}d retention`;
    }
    return { kind: 'transcript', path, bytes: stat.size, ageDays: round(ageDays), verdict, reason };
  });
}

// A worktree is reclaimable only when losing it cannot lose work: old enough,
// quiet, unlocked, clean, not the tree we are running in, and already merged.
export function classifyWorktree(config, worktree, { now = Date.now(), cwd = process.cwd() } = {}) {
  const { retentionDays, activeGraceMinutes, mergedInto } = config.worktrees;
  const hold = (reason) => ({ verdict: 'retain', reason });
  const here = realpath(cwd);
  const tree = realpath(worktree.path);

  if (tree === realpath(config.repoRoot) || tree === primaryCheckout(config.repoRoot)) return hold('primary checkout');
  if (here === tree || here.startsWith(`${tree}/`)) return hold('in use by this process');
  // Never delete the tree the running copy of this tool lives in: a sweep that
  // removes its own scheduled script silently disables the retention clock.
  if (realpath(HERE).startsWith(`${tree}/`)) return hold('holds the running retention tool');
  if (worktree.locked) return hold('locked');

  const lastActivityMs = latestMtimeMs(worktree.path);
  const ageDays = (now - lastActivityMs) / DAY_MS;
  if (now - lastActivityMs < activeGraceMinutes * 60_000) return { ...hold('active — touched inside the grace window'), ageDays: round(ageDays) };
  if (ageDays <= retentionDays) return { ...hold(`within ${retentionDays}d retention`), ageDays: round(ageDays) };

  let dirty = true;
  try {
    dirty = git(worktree.path, ['status', '--porcelain']).length > 0;
  } catch {
    return { ...hold('git status unavailable'), ageDays: round(ageDays) };
  }
  if (dirty) return { ...hold('uncommitted or untracked changes'), ageDays: round(ageDays) };

  const head = worktree.head ?? (() => {
    try {
      return git(worktree.path, ['rev-parse', 'HEAD']);
    } catch {
      return null;
    }
  })();
  if (!head) return { ...hold('HEAD unreadable'), ageDays: round(ageDays) };

  const mergedRef = mergedInto.find(
    (ref) => gitOk(config.repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]) &&
      gitOk(config.repoRoot, ['merge-base', '--is-ancestor', head, ref]),
  );
  if (!mergedRef) return { ...hold('work not merged into a durable branch'), ageDays: round(ageDays) };

  return {
    verdict: 'expire',
    reason: `older than ${retentionDays}d and merged into ${mergedRef}`,
    ageDays: round(ageDays),
  };
}

export function planWorktrees(config, { now = Date.now(), cwd = process.cwd() } = {}) {
  return listWorktrees(config).map((worktree) => {
    const classification = classifyWorktree(config, worktree, { now, cwd });
    return {
      kind: 'worktree',
      path: worktree.path,
      branch: worktree.branch,
      bytes: dirBytes(worktree.path),
      ageDays: classification.ageDays ?? null,
      verdict: classification.verdict,
      reason: classification.reason,
    };
  });
}

function dirBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += statSync(full).size;
        } catch {
          /* raced with a delete */
        }
      }
    }
  }
  return total;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// The deletion log — metadata only, never content
// ---------------------------------------------------------------------------

export function logPath(config) {
  return join(expandPath(config.log.dir, config.repoRoot), 'deletions.jsonl');
}

export function appendDeletionLog(config, entries, { now = Date.now() } = {}) {
  if (!entries.length) return;
  const path = logPath(config);
  mkdirSync(dirname(path), { recursive: true });
  pruneDeletionLog(config, { now });
  const lines = entries.map((entry) =>
    JSON.stringify({
      ts: new Date(now).toISOString(),
      kind: entry.kind,
      path: entry.path,
      bytes: entry.bytes,
      ageDays: entry.ageDays,
      reason: entry.reason,
    }),
  );
  appendFileSync(path, `${lines.join('\n')}\n`);
}

export function pruneDeletionLog(config, { now = Date.now() } = {}) {
  const path = logPath(config);
  if (!existsSync(path)) return 0;
  const cutoff = now - config.log.retentionDays * DAY_MS;
  const kept = [];
  let dropped = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (Date.parse(entry.ts) >= cutoff) kept.push(line);
    else dropped += 1;
  }
  if (dropped) writeFileSync(path, kept.length ? `${kept.join('\n')}\n` : '');
  return dropped;
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export function sweep(config, { apply = false, now = Date.now(), cwd = process.cwd() } = {}) {
  const plan = [...planTranscripts(config, now), ...planWorktrees(config, { now, cwd })];
  const expiring = plan.filter((entry) => entry.verdict === 'expire');
  const deleted = [];
  const failed = [];

  if (apply) {
    for (const entry of expiring) {
      try {
        if (entry.kind === 'worktree') {
          git(primaryCheckout(config.repoRoot), ['worktree', 'remove', '--force', entry.path]);
        } else {
          rmSync(entry.path);
          pruneEmptyParents(entry.path);
        }
        deleted.push(entry);
      } catch (err) {
        failed.push({ ...entry, error: err.message.split('\n')[0] });
      }
    }
    if (deleted.some((entry) => entry.kind === 'worktree')) {
      try {
        git(primaryCheckout(config.repoRoot), ['worktree', 'prune']);
      } catch {
        /* best effort */
      }
    }
    appendDeletionLog(config, deleted, { now });
  }

  return { plan, expiring, deleted, failed, applied: apply };
}

// Remove directories that the deletion just emptied, never climbing above the
// `.claude/projects` tree the file belonged to.
function pruneEmptyParents(filePath) {
  const PROJECTS = join('.claude', 'projects');
  let dir = dirname(filePath);
  while (dir.includes(PROJECTS)) {
    if (dir.endsWith(PROJECTS)) break;
    try {
      if (readdirSync(dir).length > 0) break;
      rmdirSync(dir);
    } catch {
      break;
    }
    dir = dirname(dir);
  }
}

export function scrub(config, { apply = false, env = process.env, now = Date.now() } = {}) {
  const patterns = [...SECRET_PATTERNS, ...envSecretPatterns(env)];
  // Rewriting a transcript that a live session still holds open would drop that
  // session's later lines, so only quiet files are rewritten. This is what makes
  // the periodic scrubber eventually-consistent rather than on-write; closing
  // that window needs a harness-side write hook (see README).
  const quietMs = (config.transcripts.scrubQuietMinutes ?? 15) * 60_000;
  const results = [];
  const skipped = [];
  for (const path of listTranscripts(config)) {
    const result = scrubFile(path, { apply: apply && now - statSync(path).mtimeMs >= quietMs, patterns });
    if (!result.changed) continue;
    if (apply && !result.applied) skipped.push(result.path);
    results.push(result);
  }
  const acpQuietMs = (config.acpSessions.scrubQuietMinutes ?? 15) * 60_000;
  for (const path of listAcpSessions(config)) {
    const isQuiet = now - statSync(path).mtimeMs >= acpQuietMs;
    const result = scrubAcpSessionFile(path, { apply: apply && isQuiet });
    if (!result.changed) continue;
    if (apply && !result.applied) skipped.push(result.path);
    results.push(result);
  }
  const counts = {};
  for (const result of results) {
    for (const [kind, n] of Object.entries(result.counts)) counts[kind] = (counts[kind] ?? 0) + n;
  }
  return { files: results, counts, skipped, applied: apply };
}

// ---------------------------------------------------------------------------
// Schedule (launchd, per-user) — expiry that runs rather than expiry documented
// ---------------------------------------------------------------------------

export const SCHEDULE = [
  { label: 'ai.focx.agent-retention.scrub', args: ['scrub', '--apply'], startInterval: 900 },
  { label: 'ai.focx.agent-retention.sweep', args: ['sweep', '--apply'], calendar: { Hour: 3, Minute: 15 } },
];

export function plist({ label, args, startInterval, calendar }, { node = process.execPath, script, logDir }) {
  const schedule = startInterval
    ? `  <key>StartInterval</key>\n  <integer>${startInterval}</integer>`
    : `  <key>StartCalendarInterval</key>\n  <dict>\n${Object.entries(calendar)
        .map(([key, value]) => `    <key>${key}</key>\n    <integer>${value}</integer>`)
        .join('\n')}\n  </dict>`;
  const program = [node, script, ...args]
    .map((value) => `    <string>${value}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${program}
  </array>
${schedule}
  <key>StandardOutPath</key>
  <string>${logDir}/${label}.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/${label}.log</string>
</dict>
</plist>
`;
}

function launchAgentsDir() {
  return join(homedir(), 'Library', 'LaunchAgents');
}

// The scheduled job must point at a copy of this script that outlives any one
// run — the primary checkout, not the throwaway worktree we are probably
// running from.
export function scheduledScript(config) {
  const durable = join(primaryCheckout(config.repoRoot), 'tools', 'agent-retention', 'index.mjs');
  if (existsSync(durable)) return { path: durable, durable: true };
  return { path: join(HERE, 'index.mjs'), durable: false };
}

function installSchedule(config) {
  const script = scheduledScript(config);
  if (!script.durable) {
    console.warn(
      `warning: ${script.path} is not in the primary checkout. The schedule will break when this worktree goes away — re-run install-schedule once this branch has merged.`,
    );
  }
  const logDir = expandPath(config.log.dir, config.repoRoot);
  mkdirSync(logDir, { recursive: true });
  mkdirSync(launchAgentsDir(), { recursive: true });
  const uid = process.getuid();
  const installed = [];
  for (const job of SCHEDULE) {
    const path = join(launchAgentsDir(), `${job.label}.plist`);
    writeFileSync(path, plist(job, { script: script.path, logDir }));
    try {
      execFileSync('launchctl', ['bootout', `gui/${uid}/${job.label}`], { stdio: 'ignore' });
    } catch {
      /* not loaded yet */
    }
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, path], { stdio: 'inherit' });
    installed.push({ label: job.label, path });
  }
  return installed;
}

function uninstallSchedule() {
  const uid = process.getuid();
  const removed = [];
  for (const job of SCHEDULE) {
    const path = join(launchAgentsDir(), `${job.label}.plist`);
    try {
      execFileSync('launchctl', ['bootout', `gui/${uid}/${job.label}`], { stdio: 'ignore' });
    } catch {
      /* not loaded */
    }
    if (existsSync(path)) {
      rmSync(path);
      removed.push(job.label);
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function human(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)}${units[unit]}`;
}

function short(path, config) {
  const fromRepo = relative(config.repoRoot, path);
  if (!fromRepo.startsWith('..')) return fromRepo;
  const fromHome = relative(homedir(), path);
  return fromHome.startsWith('..') ? path : `~/${fromHome}`;
}

function main(argv) {
  const command = argv[0] ?? 'status';
  const flags = new Set(argv.slice(1).filter((arg) => arg.startsWith('--')));
  const apply = flags.has('--apply');
  const json = flags.has('--json');
  const config = loadConfig();

  if (command === 'status') {
    const plan = [...planTranscripts(config), ...planWorktrees(config)];
    const acpSessions = listAcpSessions(config).map((path) => ({ kind: 'acp-session', path, bytes: statSync(path).size }));
    if (json) return void console.log(JSON.stringify({ config, plan, acpSessions }, null, 2));
    const transcripts = plan.filter((entry) => entry.kind === 'transcript');
    const worktrees = plan.filter((entry) => entry.kind === 'worktree');
    const sum = (entries) => entries.reduce((total, entry) => total + entry.bytes, 0);
    console.log(`agent-retention — config: ${config.configPath ?? 'defaults'}`);
    console.log(
      `  transcripts  ${transcripts.length} files, ${human(sum(transcripts))}, retention ${config.transcripts.retentionDays}d` +
        ` — ${transcripts.filter((e) => e.verdict === 'expire').length} expiring`,
    );
    console.log(
      `  worktrees    ${worktrees.length} trees, ${human(sum(worktrees))}, retention ${config.worktrees.retentionDays}d` +
        ` — ${worktrees.filter((e) => e.verdict === 'expire').length} reclaimable`,
    );
    console.log(`  acp sessions ${acpSessions.length} files, ${human(sum(acpSessions))}, scrub-only — never deleted`);
    for (const entry of plan.filter((e) => e.verdict === 'expire')) {
      console.log(`    expire  ${short(entry.path, config)}  ${human(entry.bytes)}  ${entry.ageDays}d  ${entry.reason}`);
    }
    return;
  }

  if (command === 'scrub') {
    const result = scrub(config, { apply });
    if (json) return void console.log(JSON.stringify(result, null, 2));
    const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
    console.log(`agent-retention scrub ${apply ? '(applied)' : '(dry run — pass --apply)'}`);
    console.log(`  ${result.files.length} file(s) with ${total} secret-shaped match(es)`);
    for (const [kind, n] of Object.entries(result.counts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${kind.padEnd(24)} ${n}`);
    }
    for (const file of result.files) console.log(`    ${short(file.path, config)}`);
    for (const path of result.skipped) console.log(`    deferred (session still live)  ${short(path, config)}`);
    return;
  }

  if (command === 'sweep') {
    const result = sweep(config, { apply });
    if (json) return void console.log(JSON.stringify(result, null, 2));
    console.log(`agent-retention sweep ${apply ? '(applied)' : '(dry run — pass --apply)'}`);
    for (const entry of result.expiring) {
      const verb = apply ? (result.deleted.includes(entry) ? 'deleted' : 'FAILED') : 'would delete';
      console.log(`  ${verb}  ${entry.kind}  ${short(entry.path, config)}  ${human(entry.bytes)}  ${entry.ageDays}d`);
    }
    const held = result.plan.filter((entry) => entry.verdict === 'retain' && entry.kind === 'worktree');
    for (const entry of held) console.log(`  held     worktree  ${short(entry.path, config)}  ${entry.reason}`);
    if (result.failed.length) {
      for (const entry of result.failed) console.error(`  error    ${short(entry.path, config)}: ${entry.error}`);
      process.exitCode = 1;
    }
    console.log(`  ${result.expiring.length} expiring, ${result.deleted.length} deleted, log: ${logPath(config)}`);
    return;
  }

  if (command === 'install-schedule') {
    for (const job of installSchedule(config)) console.log(`installed ${job.label} → ${job.path}`);
    return;
  }

  if (command === 'uninstall-schedule') {
    const removed = uninstallSchedule();
    console.log(removed.length ? `removed ${removed.join(', ')}` : 'nothing installed');
    return;
  }

  console.error(`usage: agent-retention <status|scrub|sweep|install-schedule|uninstall-schedule> [--apply] [--json]`);
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
