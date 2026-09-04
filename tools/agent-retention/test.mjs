// Tests for agent-retention. The point of this suite is that expiry is
// *demonstrated*, not configured: every retention rule below is proved by
// building a store, ageing it, running the sweep, and checking what survived.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_CONFIG,
  SECRET_PATTERNS,
  appendDeletionLog,
  classifyWorktree,
  envSecretPatterns,
  expandGlobDirs,
  listRecords,
  listTranscripts,
  loadConfig,
  logPath,
  planTranscripts,
  planWorktrees,
  plist,
  scheduleState,
  scheduledScript,
  stage,
  stageDir,
  pruneDeletionLog,
  scrub,
  scrubFile,
  scrubText,
  sweep,
} from './index.mjs';

const DAY_MS = 86_400_000;

// --- fixtures --------------------------------------------------------------

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function age(path, days) {
  const when = new Date(Date.now() - days * DAY_MS);
  utimesSync(path, when, when);
}

function ageTree(dir, days) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) ageTree(full, days);
    else age(full, days);
  }
  age(dir, days);
}

// A transcript store: <workspaces>/<agentId>/.claude/projects/<project>/*.jsonl
function transcriptStore(files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'retention-transcripts-')));
  for (const [relPath, { content = '{"type":"user"}\n', ageDays = 0 }] of Object.entries(files)) {
    const full = join(root, relPath);
    write(full, content);
    if (ageDays) age(full, ageDays);
  }
  return root;
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function gitRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'retention-repo-')));
  git(root, ['init', '-b', 'develop', '-q']);
  git(root, ['config', 'user.email', 'test@focx.ai']);
  git(root, ['config', 'user.name', 'Retention Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  write(join(root, 'README.md'), '# fixture\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'initial']);
  mkdirSync(join(root, '.paperclip', 'worktrees'), { recursive: true });
  return root;
}

function addWorktree(root, name, { unmerged = false, dirty = false, ageDays = 0 } = {}) {
  const path = join(root, '.paperclip', 'worktrees', name);
  git(root, ['worktree', 'add', '-q', '-b', name, path]);
  if (unmerged) {
    write(join(path, `${name}.txt`), 'work in progress\n');
    git(path, ['config', 'user.email', 'test@focx.ai']);
    git(path, ['config', 'user.name', 'Retention Test']);
    git(path, ['config', 'commit.gpgsign', 'false']);
    git(path, ['add', '-A']);
    git(path, ['commit', '-q', '-m', 'unmerged work']);
  }
  if (dirty) write(join(path, 'scratch.txt'), 'uncommitted\n');
  if (ageDays) ageTree(path, ageDays);
  return path;
}

// `dirs` and `roots` are always overridden, never inherited: the shipped
// defaults name this machine's real agent store, and a test that silently
// widened to it would be operating on live data.
function configFor({ transcriptRoot, transcriptDirs, repoRoot, logDir, ...rest } = {}) {
  const root = repoRoot ?? mkdtempSync(join(tmpdir(), 'retention-root-'));
  return {
    repoRoot: root,
    configPath: null,
    transcripts: {
      ...DEFAULT_CONFIG.transcripts,
      dirs: transcriptDirs ?? [],
      roots: transcriptRoot ? [transcriptRoot] : [],
      ...(rest.transcripts ?? {}),
    },
    worktrees: { ...DEFAULT_CONFIG.worktrees, mergedInto: ['develop'], ...(rest.worktrees ?? {}) },
    log: { ...DEFAULT_CONFIG.log, dir: logDir ?? mkdtempSync(join(tmpdir(), 'retention-log-')), ...(rest.log ?? {}) },
  };
}

// --- scrubbing -------------------------------------------------------------

// Some fixtures are assembled from parts rather than written literally: a
// well-formed fake Slack or Stripe token in the source trips GitHub's push
// protection, and a test that cannot be pushed is a test that does not run.
const fake = (...parts) => parts.join('');

test('scrubText redacts every supported secret shape', () => {
  const cases = {
    'anthropic-key': 'key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA end',
    'github-token': 'token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA end',
    'aws-access-key-id': 'id AKIAIOSFODNN7EXAMPLE end',
    'google-api-key': 'AIzaSyA12345678901234567890123456789012 end',
    'slack-token': `${fake('xox', 'b-', '123456789012', '-abcdefghijklmno')} end`,
    'stripe-key': `${fake('sk', '_live', '_AAAAAAAAAAAAAAAAAAAAAAAA')} end`,
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk end',
    'bearer-token': 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    'generic-secret': 'PAPERCLIP_API_KEY=pk-abcdefghijklmnopqrstuvwxyz',
    'private-key': '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  };
  for (const [kind, input] of Object.entries(cases)) {
    const { text, counts } = scrubText(input);
    assert.equal(counts[kind], 1, `${kind} did not match: ${text}`);
    assert.match(text, new RegExp(`\\[redacted:${kind}\\]`));
  }
});

test('scrubText leaves the secret value out of the output entirely', () => {
  const secret = 'ghp_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
  const { text } = scrubText(`ran with ${secret} today`);
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes('ZZZZ'), false); // no truncated prefix either
});

test('scrubText does not touch ordinary transcript prose or code', () => {
  const benign = [
    'the token bucket refills every second',
    'const apiKey = readKey();',
    'PASSWORD=short', // below the 12-char value floor
    'see docs/data-retention.md for the secret handling standard',
    'Bearer with a space and then prose that is long enough to be a sentence',
  ].join('\n');
  const { text, counts } = scrubText(benign);
  assert.equal(text, benign, `false positive: ${JSON.stringify(counts)}`);
});

test('scrubbing a JSON transcript line leaves it parseable', () => {
  // Transcripts are JSON: a secret inside a string is followed by an *escaped*
  // quote. A value pattern that eats the backslash leaves a bare quote behind
  // and destroys the line — which is exactly what happened on the first live run.
  const line = JSON.stringify({
    type: 'assistant',
    text: 'env output:\nPAPERCLIP_AGENT_JWT_SECRET=s3cretvaluethatislong\nDONE',
    nested: JSON.stringify({ command: 'echo \\"password=hunter2islongenough\\"; }' }),
  });
  assert.doesNotThrow(() => JSON.parse(line), 'fixture is not valid JSON');

  const { text, counts } = scrubText(line);
  assert.ok(counts['generic-secret'] >= 1, 'the fixture should contain a secret to redact');
  assert.doesNotThrow(() => JSON.parse(text), `scrub corrupted the line: ${text}`);
  assert.equal(text.includes('s3cretvaluethatislong'), false);
});

test('scrubText is idempotent — a scrubbed file rescrubs to itself', () => {
  const once = scrubText('AUTH_TOKEN=abcdefghijklmnopqrstuvwxyz').text;
  const twice = scrubText(once).text;
  assert.equal(twice, once);
});

test('envSecretPatterns catches a credential by exact value and names only the variable', () => {
  const env = {
    PAPERCLIP_API_KEY: 'unpredictable-value-with-no-known-prefix-1234',
    HOME_PATH_TOKEN: '/Users/somebody/path/that/is/not/a/secret',
    SHORT_TOKEN: 'tiny',
    UNRELATED: 'not-a-secret-but-long-enough-to-look-like-one',
  };
  const patterns = envSecretPatterns(env);
  assert.deepEqual(patterns.map((p) => p.kind), ['env:PAPERCLIP_API_KEY']);
  const { text, counts } = scrubText(`curl -H "x: ${env.PAPERCLIP_API_KEY}"`, patterns);
  assert.equal(counts['env:PAPERCLIP_API_KEY'], 1);
  assert.equal(text.includes(env.PAPERCLIP_API_KEY), false);
  assert.match(text, /\[redacted:env:PAPERCLIP_API_KEY\]/);
});

test('scrubFile rewrites in place without resetting the retention clock', () => {
  const root = transcriptStore({
    'agent-1/.claude/projects/proj/a.jsonl': { content: '{"out":"ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}\n', ageDays: 10 },
  });
  const path = join(root, 'agent-1/.claude/projects/proj/a.jsonl');
  const before = statSync(path).mtimeMs;

  const result = scrubFile(path, { apply: true });
  assert.equal(result.applied, true);
  assert.equal(statSync(path).mtimeMs, before, 'scrubbing must not extend retention');
  assert.equal(readFileSync(path, 'utf8').includes('ghp_'), false);
  assert.equal(existsSync(`${path}.retention-tmp`), false, 'no temp file left behind');
});

test('scrub is dry-run by default', () => {
  const root = transcriptStore({
    'agent-1/.claude/projects/proj/a.jsonl': { content: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n', ageDays: 1 },
  });
  const config = configFor({ transcriptRoot: root });
  const result = scrub(config, { apply: false, env: {} });
  assert.equal(result.files.length, 1);
  assert.equal(result.applied, false);
  assert.equal(readFileSync(join(root, 'agent-1/.claude/projects/proj/a.jsonl'), 'utf8').includes('ghp_'), true);

  scrub(config, { apply: true, env: {} });
  assert.equal(readFileSync(join(root, 'agent-1/.claude/projects/proj/a.jsonl'), 'utf8').includes('ghp_'), false);
});

test('scrub defers a transcript whose session is still writing', () => {
  const secret = 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const root = transcriptStore({
    'agent-1/.claude/projects/proj/live.jsonl': { content: `${secret}\n` },
    'agent-2/.claude/projects/proj/quiet.jsonl': { content: `${secret}\n`, ageDays: 1 },
  });
  const config = configFor({ transcriptRoot: root });
  const result = scrub(config, { apply: true, env: {} });

  assert.deepEqual(result.skipped.map((p) => p.split('/').pop()), ['live.jsonl'], 'a live session is left alone');
  assert.equal(readFileSync(join(root, 'agent-1/.claude/projects/proj/live.jsonl'), 'utf8').includes(secret), true);
  assert.equal(readFileSync(join(root, 'agent-2/.claude/projects/proj/quiet.jsonl'), 'utf8').includes(secret), false);

  // Once quiet, the deferred file is scrubbed on a later pass.
  age(join(root, 'agent-1/.claude/projects/proj/live.jsonl'), 1);
  const second = scrub(config, { apply: true, env: {} });
  assert.deepEqual(second.skipped, []);
  assert.equal(readFileSync(join(root, 'agent-1/.claude/projects/proj/live.jsonl'), 'utf8').includes(secret), false);
});

test('scrub covers .claude/projects only, never agent memory', () => {
  const root = transcriptStore({
    'agent-1/.claude/projects/proj/a.jsonl': { content: '{}\n' },
    'agent-1/.claude/memory/MEMORY.md': { content: 'remembered\n' },
    'agent-1/life/notes.jsonl': { content: '{}\n' },
  });
  const found = listTranscripts(configFor({ transcriptRoot: root }));
  assert.deepEqual(found.map((p) => p.replace(root, '')), ['/agent-1/.claude/projects/proj/a.jsonl']);
});

// --- store coverage (FOC-73 re-scope) --------------------------------------
//
// The original coverage named only `workspaces/*/.claude/projects`. The
// credentials were actually at rest in `acp-engine/agents/*/sessions`,
// `codex-home/sessions` and `data/run-logs`. These tests pin the wider
// coverage, because a scrubber that runs cleanly over the wrong directories
// reports the same "0 findings" as one with nothing left to find.

// A store laid out the way the real ones are, including the date nesting
// codex-home uses and the company/agent/run nesting under run-logs.
function multiStore() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'retention-stores-')));
  const files = {
    'workspaces/agent-1/.claude/projects/proj/a.jsonl': '{"t":"claude"}\n',
    'workspaces/agent-1/.claude/memory/MEMORY.md': 'not a session record\n',
    'companies/co-1/acp-engine/agents/agent-1/sessions/s1.json': '{"t":"acp"}\n',
    'companies/co-1/acp-engine/agents/agent-2/sessions/s2.json': '{"t":"acp"}\n',
    'companies/co-1/codex-home/sessions/2026/09/04/rollout-1.jsonl': '{"t":"codex"}\n',
    'data/run-logs/co-1/agent-1/run-1.ndjson': '{"t":"runlog"}\n',
  };
  for (const [rel, content] of Object.entries(files)) write(join(root, rel), content);
  return root;
}

function storeDirs(root) {
  return [
    `${root}/workspaces/*/.claude/projects`,
    `${root}/companies/*/acp-engine/agents/*/sessions`,
    `${root}/companies/*/codex-home/sessions`,
    `${root}/data/run-logs`,
  ];
}

test('every store the credentials were found in is in scope, and agent memory still is not', () => {
  const root = multiStore();
  const found = listTranscripts(configFor({ transcriptDirs: storeDirs(root) })).map((p) => p.replace(`${root}/`, ''));
  assert.deepEqual(found.sort(), [
    'companies/co-1/acp-engine/agents/agent-1/sessions/s1.json',
    'companies/co-1/acp-engine/agents/agent-2/sessions/s2.json',
    'companies/co-1/codex-home/sessions/2026/09/04/rollout-1.jsonl',
    'data/run-logs/co-1/agent-1/run-1.ndjson',
    'workspaces/agent-1/.claude/projects/proj/a.jsonl',
  ]);
});

test('the shipped config names all four stores, not just the transcripts', () => {
  const dirs = loadConfig().transcripts.dirs.join('\n');
  for (const store of ['.claude/projects', 'acp-engine/agents/*/sessions', 'codex-home/sessions', 'data/run-logs']) {
    assert.match(dirs, new RegExp(store.replace(/[.*]/g, '\\$&')), `${store} must be covered`);
  }
  assert.ok(loadConfig().transcripts.extensions.includes('.ndjson'), 'run-logs are .ndjson — without it they are skipped');
});

test('a glob matches whole segments only', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'retention-glob-')));
  write(join(root, 'agents/a/sessions/x.json'), '{}\n');
  write(join(root, 'agents/b/sessions/y.json'), '{}\n');
  write(join(root, 'agents/b/other/z.json'), '{}\n');
  assert.deepEqual(expandGlobDirs(`${root}/agents/*/sessions`), [
    join(root, 'agents/a/sessions'),
    join(root, 'agents/b/sessions'),
  ]);
  // A pattern naming a layout that is not present expands to nothing rather
  // than throwing — an absent store must not stop the sweep over the others.
  assert.deepEqual(expandGlobDirs(`${root}/nope/*/sessions`), []);
});

test('a store can carry its own retention clock', () => {
  const root = multiStore();
  const config = configFor({
    transcriptDirs: [
      { path: `${root}/data/run-logs`, retentionDays: 1 },
      `${root}/companies/*/codex-home/sessions`,
    ],
  });
  for (const record of listRecords(config)) age(record.path, 5);
  const verdict = Object.fromEntries(planTranscripts(config).map((e) => [e.path.split('/').pop(), e.verdict]));
  assert.deepEqual(verdict, { 'run-1.ndjson': 'expire', 'rollout-1.jsonl': 'retain' });
});

test('`roots` still means what it meant before the stores were widened', () => {
  const root = transcriptStore({
    'agent-1/.claude/projects/proj/a.jsonl': { content: '{}\n' },
    'agent-1/.claude/memory/MEMORY.md': { content: 'remembered\n' },
  });
  const found = listTranscripts(configFor({ transcriptRoot: root }));
  assert.deepEqual(found.map((p) => p.replace(root, '')), ['/agent-1/.claude/projects/proj/a.jsonl']);
});

test('the three credential classes found at rest are purged from every store', () => {
  const root = multiStore();
  // Assembled from parts so a well-formed token never sits in the source.
  const oauth = `sk-ant-${'oat01'}-${'A'.repeat(40)}`;
  const gh = `gh${'o'}_${'B'.repeat(36)}`;
  const jwt = `eyJ${'C'.repeat(20)}.eyJ${'D'.repeat(20)}.${'E'.repeat(43)}`;
  const bearing = {
    'workspaces/agent-1/.claude/projects/proj/a.jsonl': `{"env":{"CLAUDE_CODE_OAUTH_TOKEN":"${oauth}"}}\n`,
    'companies/co-1/acp-engine/agents/agent-1/sessions/s1.json': `{"env":{"GH_TOKEN":"${gh}"}}\n`,
    'companies/co-1/codex-home/sessions/2026/09/04/rollout-1.jsonl': `{"env":{"PAPERCLIP_API_KEY":"${jwt}"}}\n`,
    'data/run-logs/co-1/agent-1/run-1.ndjson': `{"cmd":"curl -H 'Authorization: Bearer ${jwt}'"}\n`,
  };
  for (const [rel, content] of Object.entries(bearing)) {
    write(join(root, rel), content);
    age(join(root, rel), 1); // past the scrub quiet window
  }

  const config = configFor({ transcriptDirs: storeDirs(root) });
  const result = scrub(config, { apply: true, env: {} });
  assert.equal(result.failed.length, 0, JSON.stringify(result.failed));
  assert.equal(result.files.length, 4, 'every store must be reached, not just the first');

  for (const rel of Object.keys(bearing)) {
    const after = readFileSync(join(root, rel), 'utf8');
    for (const secret of [oauth, gh, jwt]) {
      assert.equal(after.includes(secret), false, `${secret.slice(0, 8)}… survived in ${rel}`);
    }
    assert.match(after, /\[redacted:/);
  }
  // And the purge is complete: a second pass over the same store finds nothing.
  assert.deepEqual(scrub(config, { apply: true, env: {} }).files, []);
});

test('one unreadable record does not abandon the rest of the purge', () => {
  const root = multiStore();
  const secret = `sk-ant-${'oat01'}-${'F'.repeat(40)}`;
  const reachable = join(root, 'data/run-logs/co-1/agent-1/run-1.ndjson');
  const blocked = join(root, 'data/run-logs/co-1/agent-1/locked.ndjson');
  write(reachable, `{"t":"${secret}"}\n`);
  write(blocked, `{"t":"${secret}"}\n`);
  age(reachable, 1);
  age(blocked, 1);
  chmodSync(blocked, 0o000);

  try {
    const result = scrub(configFor({ transcriptDirs: [`${root}/data/run-logs`] }), { apply: true, env: {} });
    assert.equal(result.failed.length, 1, 'the unreadable file is reported, not swallowed');
    assert.equal(result.failed[0].path, blocked);
    assert.equal(readFileSync(reachable, 'utf8').includes(secret), false, 'the reachable file was still purged');
  } finally {
    chmodSync(blocked, 0o600);
  }
});

test('sweep unwinds the date nesting it empties but never the store root', () => {
  const root = multiStore();
  const store = join(root, 'companies/co-1/codex-home/sessions');
  const config = configFor({ transcriptDirs: [store], repoRoot: gitRepo() });
  age(join(store, '2026/09/04/rollout-1.jsonl'), 45);

  const result = sweep(config, { apply: true });
  assert.equal(result.deleted.length, 1);
  assert.equal(existsSync(join(store, '2026')), false, 'the emptied date nesting goes');
  assert.equal(existsSync(store), true, 'the store root stays');
});

// --- transcript expiry -----------------------------------------------------

test('transcripts expire past the retention window and not before', () => {
  const root = transcriptStore({
    'agent-1/.claude/projects/proj/old.jsonl': { ageDays: 45 },
    'agent-1/.claude/projects/proj/edge.jsonl': { ageDays: 29 },
    'agent-2/.claude/projects/proj/fresh.jsonl': { ageDays: 0 },
  });
  const plan = planTranscripts(configFor({ transcriptRoot: root }));
  const verdict = Object.fromEntries(plan.map((entry) => [entry.path.split('/').pop(), entry.verdict]));
  assert.deepEqual(verdict, { 'old.jsonl': 'expire', 'edge.jsonl': 'retain', 'fresh.jsonl': 'retain' });
});

test('a file being written right now is held back by the grace window', () => {
  const root = transcriptStore({ 'agent-1/.claude/projects/proj/live.jsonl': { ageDays: 0 } });
  // Retention of 0 days would otherwise expire everything; the grace window is
  // what stops the sweep from deleting a transcript mid-session.
  const config = configFor({ transcriptRoot: root, transcripts: { retentionDays: 0 } });
  const [entry] = planTranscripts(config);
  assert.equal(entry.verdict, 'retain');
  assert.match(entry.reason, /grace window/);
});

test('sweep deletes expired transcripts, keeps the rest, and logs metadata only', () => {
  const root = transcriptStore({
    'agent-1/.claude/projects/proj/old.jsonl': { content: 'secret content here\n', ageDays: 45 },
    'agent-1/.claude/projects/proj/keep.jsonl': { content: 'recent\n', ageDays: 1 },
  });
  const config = configFor({ transcriptRoot: root, repoRoot: gitRepo() });

  const dry = sweep(config, { apply: false });
  assert.equal(dry.expiring.length, 1);
  assert.equal(dry.deleted.length, 0);
  assert.equal(existsSync(join(root, 'agent-1/.claude/projects/proj/old.jsonl')), true, 'dry run must not delete');

  const applied = sweep(config, { apply: true });
  assert.equal(applied.deleted.length, 1);
  assert.equal(applied.failed.length, 0);
  assert.equal(existsSync(join(root, 'agent-1/.claude/projects/proj/old.jsonl')), false);
  assert.equal(existsSync(join(root, 'agent-1/.claude/projects/proj/keep.jsonl')), true);

  const logged = readFileSync(logPath(config), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(logged.length, 1);
  assert.equal(logged[0].kind, 'transcript');
  assert.equal(logged[0].bytes, 'secret content here\n'.length);
  assert.equal(JSON.stringify(logged[0]).includes('secret content'), false, 'the log records metadata, never content');
});

test('emptied project directories are cleaned up but .claude/projects survives', () => {
  const root = transcriptStore({ 'agent-1/.claude/projects/proj/only.jsonl': { ageDays: 45 } });
  const config = configFor({ transcriptRoot: root, repoRoot: gitRepo() });
  sweep(config, { apply: true });
  assert.equal(existsSync(join(root, 'agent-1/.claude/projects/proj')), false);
  assert.equal(existsSync(join(root, 'agent-1/.claude/projects')), true);
});

// --- worktree expiry -------------------------------------------------------

test('an old, clean, merged worktree is reclaimable', () => {
  const repo = gitRepo();
  addWorktree(repo, 'FOC-1-merged', { ageDays: 30 });
  const config = configFor({ repoRoot: repo, worktrees: { roots: [join(repo, '.paperclip/worktrees')] } });
  const plan = sweep(config, { apply: false }).plan.filter((e) => e.kind === 'worktree');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].verdict, 'expire');
  assert.match(plan[0].reason, /merged into develop/);
});

test('worktrees are held back by unmerged work, dirt, recency, and being in use', () => {
  const repo = gitRepo();
  addWorktree(repo, 'FOC-2-unmerged', { unmerged: true, ageDays: 30 });
  addWorktree(repo, 'FOC-3-dirty', { dirty: true, ageDays: 30 });
  addWorktree(repo, 'FOC-4-recent', { ageDays: 1 });
  const inUse = addWorktree(repo, 'FOC-5-in-use', { ageDays: 30 });
  const nested = join(inUse, 'pipeline', 'runs');
  mkdirSync(nested, { recursive: true });

  const config = configFor({ repoRoot: repo, worktrees: { roots: [join(repo, '.paperclip/worktrees')] } });
  const plan = sweep(config, { apply: false, cwd: nested }).plan.filter((e) => e.kind === 'worktree');
  const byName = Object.fromEntries(plan.map((entry) => [entry.path.split('/').pop(), entry]));

  assert.equal(byName['FOC-2-unmerged'].verdict, 'retain');
  assert.match(byName['FOC-2-unmerged'].reason, /not merged/);
  assert.equal(byName['FOC-3-dirty'].verdict, 'retain');
  assert.match(byName['FOC-3-dirty'].reason, /uncommitted/);
  assert.equal(byName['FOC-4-recent'].verdict, 'retain');
  assert.equal(byName['FOC-5-in-use'].verdict, 'retain');
  assert.match(byName['FOC-5-in-use'].reason, /in use/);
});

test('a sweep never removes the worktree holding the running tool', () => {
  // The tool under test lives in this repository's own worktree, so point a
  // fixture config's worktree root at the real one and check it is held back.
  const config = loadConfig();
  const plan = planWorktrees(config, { cwd: '/elsewhere' });
  const self = plan.find((entry) => new URL('.', import.meta.url).pathname.startsWith(`${entry.path}/`));
  if (!self) return; // running from the primary checkout: nothing to protect
  assert.equal(self.verdict, 'retain', `a sweep would have deleted its own tool: ${self.reason}`);
});

test('the self-protection rule holds even for an old, clean, merged tree', () => {
  const repo = gitRepo();
  const path = addWorktree(repo, 'FOC-9-holds-the-tool', { ageDays: 30 });
  const config = configFor({ repoRoot: repo, worktrees: { roots: [join(repo, '.paperclip/worktrees')] } });
  // Same shape as the tree this file is running from: expirable on every other
  // rule, held back only because the tool itself lives inside it.
  assert.equal(classifyWorktree(config, { path, locked: false, branch: 'x', head: null }, { cwd: '/elsewhere' }).verdict, 'expire');
  const guarded = classifyWorktree(
    { ...config, repoRoot: repo },
    { path: dirname(dirname(new URL('.', import.meta.url).pathname)), locked: false, branch: 'x', head: null },
    { cwd: '/elsewhere' },
  );
  assert.equal(guarded.verdict, 'retain');
});

test('the scheduled script is staged outside every checkout', () => {
  const config = loadConfig();
  const script = scheduledScript(config);
  assert.match(script.path, /tools\/agent-retention\/index\.mjs$/);
  // The whole point of staging: a job pointing into `.paperclip/worktrees` runs
  // from a directory this tool is itself allowed to delete.
  assert.equal(script.path.includes('.paperclip/worktrees'), false);
  assert.equal(script.path.startsWith(stageDir(config)), true);
});

test('staging produces a runnable copy whose config still finds the real checkout', () => {
  const repo = gitRepo();
  const logDir = mkdtempSync(join(tmpdir(), 'retention-stage-'));
  const config = configFor({ repoRoot: repo, logDir, worktrees: { roots: ['.paperclip/worktrees'] } });

  const staged = stage(config);
  assert.equal(existsSync(staged), true);
  assert.equal(readFileSync(staged, 'utf8'), readFileSync(new URL('index.mjs', import.meta.url), 'utf8'));

  // A staged config must not carry repo-relative paths: nothing above the stage
  // directory is a checkout, so `.paperclip/worktrees` would resolve to nowhere
  // and the sweep would report success while reclaiming nothing.
  const written = JSON.parse(readFileSync(join(stageDir(config), 'retention.config.json'), 'utf8'));
  assert.deepEqual(written.worktrees.roots, [join(realpathSync(repo), '.paperclip/worktrees')]);
  assert.equal(written.worktrees.checkout, realpathSync(repo));
  for (const dir of written.transcripts.dirs) assert.equal(dir.startsWith('/') || dir.startsWith('~'), true);
});

test('a staged copy that has fallen behind the repository is reported as stale', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'retention-stale-'));
  const config = configFor({ repoRoot: gitRepo(), logDir });
  assert.match(scheduleState(config), /not installed/);

  stage(config);
  assert.equal(/STALE/.test(scheduleState(config)), false);

  writeFileSync(scheduledScript(config).path, '// an older build\n');
  assert.match(scheduleState(config), /STALE/);
});

test('a worktree touched inside the grace window survives even at zero retention', () => {
  const repo = gitRepo();
  const path = addWorktree(repo, 'FOC-6-live');
  const config = configFor({
    repoRoot: repo,
    worktrees: { roots: [join(repo, '.paperclip/worktrees')], retentionDays: 0 },
  });
  const classified = classifyWorktree(config, { path, locked: false, branch: 'FOC-6-live', head: null }, { cwd: '/elsewhere' });
  assert.equal(classified.verdict, 'retain');
  assert.match(classified.reason, /grace window/);
});

test('sweep --apply removes the reclaimable worktree and deregisters it from git', () => {
  const repo = gitRepo();
  const reclaimable = addWorktree(repo, 'FOC-7-merged', { ageDays: 30 });
  addWorktree(repo, 'FOC-8-unmerged', { unmerged: true, ageDays: 30 });
  const config = configFor({ repoRoot: repo, worktrees: { roots: [join(repo, '.paperclip/worktrees')] } });

  const result = sweep(config, { apply: true, cwd: '/elsewhere' });
  assert.equal(result.failed.length, 0, JSON.stringify(result.failed));
  assert.equal(existsSync(reclaimable), false);
  assert.equal(existsSync(join(repo, '.paperclip/worktrees/FOC-8-unmerged')), true);
  assert.equal(git(repo, ['worktree', 'list']).includes('FOC-7-merged'), false, 'git must no longer track it');

  const logged = readFileSync(logPath(config), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(logged.some((entry) => entry.kind === 'worktree' && entry.path === reclaimable), true);
});

// --- log retention and config ---------------------------------------------

test('the deletion log expires on its own clock', () => {
  const config = configFor({ log: { retentionDays: 400 } });
  const now = Date.now();
  appendDeletionLog(config, [{ kind: 'transcript', path: '/old', bytes: 1, ageDays: 30, reason: 'x' }], {
    now: now - 500 * DAY_MS,
  });
  assert.equal(pruneDeletionLog(config, { now }), 1, 'an entry past the log retention is dropped');
  assert.equal(pruneDeletionLog(config, { now }), 0, 'and pruning is idempotent');

  // Appending also prunes, so the log cannot outlive its own clock just because
  // nobody ran a prune.
  appendDeletionLog(config, [{ kind: 'transcript', path: '/new', bytes: 1, ageDays: 30, reason: 'x' }], { now });
  const remaining = readFileSync(logPath(config), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(remaining.map((entry) => entry.path), ['/new']);
});

test('retention.config.json overrides the built-in defaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'retention-config-'));
  writeFileSync(join(root, 'retention.config.json'), JSON.stringify({ transcripts: { retentionDays: 7 } }));
  const config = loadConfig({ repoRoot: root });
  assert.equal(config.transcripts.retentionDays, 7);
  assert.deepEqual(config.transcripts.dirs, DEFAULT_CONFIG.transcripts.dirs, 'unset keys keep their default');
  assert.equal(config.worktrees.retentionDays, DEFAULT_CONFIG.worktrees.retentionDays);
});

test('the shipped repository config parses and is stricter than nothing', () => {
  const config = loadConfig();
  assert.ok(config.transcripts.retentionDays > 0);
  assert.ok(config.worktrees.retentionDays > 0);
  assert.ok(config.log.retentionDays >= config.transcripts.retentionDays);
});

test('the launchd jobs schedule both halves of the mechanism', () => {
  const scrubJob = plist(
    { label: 'ai.focx.agent-retention.scrub', args: ['scrub', '--apply'], startInterval: 900 },
    { node: '/usr/bin/node', script: '/tmp/index.mjs', logDir: '/tmp/log' },
  );
  assert.match(scrubJob, /<string>ai\.focx\.agent-retention\.scrub<\/string>/);
  assert.match(scrubJob, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
  assert.match(scrubJob, /<string>--apply<\/string>/);

  const sweepJob = plist(
    { label: 'ai.focx.agent-retention.sweep', args: ['sweep', '--apply'], calendar: { Hour: 3, Minute: 15 } },
    { node: '/usr/bin/node', script: '/tmp/index.mjs', logDir: '/tmp/log' },
  );
  assert.match(sweepJob, /<key>StartCalendarInterval<\/key>/);
  assert.match(sweepJob, /<key>Hour<\/key>\s*<integer>3<\/integer>/);
});

test('every secret pattern carries a kind and a global regex', () => {
  for (const pattern of SECRET_PATTERNS) {
    assert.ok(pattern.kind, 'pattern without a kind');
    assert.ok(pattern.re.global, `${pattern.kind} must be global or it redacts only the first hit`);
  }
});
