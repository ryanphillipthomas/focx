// Tests for agent-retention. The point of this suite is that expiry is
// *demonstrated*, not configured: every retention rule below is proved by
// building a store, ageing it, running the sweep, and checking what survived.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_CONFIG,
  SECRET_PATTERNS,
  appendDeletionLog,
  classifyWorktree,
  envSecretPatterns,
  listTranscripts,
  loadConfig,
  logPath,
  planTranscripts,
  planWorktrees,
  plist,
  scheduledScript,
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

function configFor({ transcriptRoot, repoRoot, logDir, ...rest } = {}) {
  const root = repoRoot ?? mkdtempSync(join(tmpdir(), 'retention-root-'));
  return {
    repoRoot: root,
    configPath: null,
    transcripts: { ...DEFAULT_CONFIG.transcripts, roots: transcriptRoot ? [transcriptRoot] : [], ...(rest.transcripts ?? {}) },
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

test('the scheduled script points somewhere durable, or says so', () => {
  const config = loadConfig();
  const script = scheduledScript(config);
  assert.match(script.path, /tools\/agent-retention\/index\.mjs$/);
  assert.equal(typeof script.durable, 'boolean');
  if (script.durable) assert.equal(script.path.includes('.paperclip/worktrees'), false);
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
  assert.deepEqual(config.transcripts.roots, DEFAULT_CONFIG.transcripts.roots, 'unset keys keep their default');
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
