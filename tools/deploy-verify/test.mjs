import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
const validator = readFileSync(new URL('../contracts/validate.mjs', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../pipeline/contracts/release-record.schema.json', import.meta.url), 'utf8');
const sha = 'abcdef0123456789abcdef0123456789abcdef0123';
const base = '123456789abcdef0123456789abcdef0123456789a';
const url = 'https://staging.example.invalid';
const prUrl = 'https://github.com/example/fixture/pull/42';
const projection = '{base_commit: {sha: .base_commit.sha}, ahead_by: .ahead_by, behind_by: .behind_by}';
const largeCompare = {
  base_commit: { sha: base, commit: { message: 'discarded metadata' } },
  ahead_by: 133, behind_by: 7,
  commits: Array.from({ length: 133 }, (_, i) => ({ sha: String(i), commit: { message: 'commit' } })),
  files: [{ filename: 'large.patch', patch: 'x'.repeat(32 * 1024 * 1024) }],
};

// A Node-only stand-in for gh at the subprocess boundary. It understands only
// the exact API/CLI contract below; unsupported calls fail instead of reaching
// a service. The raw comparison is deliberately larger than BOTH buffer caps.
const fixtureGh = String.raw`
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = new URL('.', import.meta.url).pathname;
const args = process.argv.slice(2);
const options = JSON.parse(readFileSync(join(dir, 'gh-options.json'), 'utf8'));
appendFileSync(join(dir, 'gh-calls.jsonl'), JSON.stringify(args) + '\n');
const operation = args.slice(0, 2).join(' ');
if (operation === options.fail) {
  process.stderr.write('GraphQL: Resource not accessible by integration (HTTP 403)\n');
  process.exitCode = 1;
} else if (args[0] === 'api') {
  const endpoint = new URL(args[1], 'https://api.example.invalid/');
  assert.equal(endpoint.pathname, '/repos/example/fixture/compare/main...staging');
  assert.equal(endpoint.searchParams.get('per_page'), '1');
  assert.equal(endpoint.searchParams.get('page'), '1');
  const comparison = JSON.parse(readFileSync(join(dir, 'compare.json'), 'utf8'));
  let response = comparison;
  if (args.includes('--jq')) {
    assert.equal(args[args.indexOf('--jq') + 1], options.projection);
    response = { base_commit: { sha: comparison.base_commit.sha }, ahead_by: comparison.ahead_by, behind_by: comparison.behind_by };
  }
  writeFileSync(join(dir, 'compare-output.json'), JSON.stringify(response));
  // Legal JSON whitespace exercises the real pipe with >1 MiB of stdout even
  // after projection. This independently detects losing the explicit budget.
  process.stdout.write(' '.repeat(options.padding || 0) + JSON.stringify(response));
  process.stderr.write('w'.repeat(options.stderrBytes || 0));
} else if (operation === 'pr list') {
  assert.deepEqual(args.slice(2), ['--base', 'main', '--head', 'staging', '--state', 'open', '--json', 'url', '--jq', '.[0].url // empty']);
  process.stdout.write(options.existing || '');
} else if (operation === 'pr create' || operation === 'pr comment') {
  process.stdout.write(options.prUrl + '\n');
} else {
  throw new Error('unexpected fixture gh call: ' + operation);
}
`;

// Fail closed if an edit accidentally reintroduces a network or non-Node CLI
// path. This bootstrap affects only the temporary copy used by these tests.
const offlineBootstrap = String.raw`
import childProcess from 'node:child_process';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const exec = childProcess.execFileSync;
childProcess.execFileSync = (command, args, options) => {
  if (command !== process.execPath && command !== 'node') throw new Error('non-Node CLI forbidden in fixture test');
  return exec(command, args, options);
};
https.get = () => { throw new Error('network forbidden in fixture test'); };
globalThis.fetch = () => { throw new Error('network forbidden in fixture test'); };
syncBuiltinESMExports();
await import('./tools/deploy-verify/index.mjs');
`;

function run(t, { code = source, comparison = largeCompare, gh = {}, health = {}, service = {}, servingSha = sha, domainVerified = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deploy-verify-f22-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('tools/deploy-verify/index.mjs', code);
  write('tools/contracts/validate.mjs', validator);
  write('pipeline/contracts/release-record.schema.json', schema);
  write('pipeline/deploy.config.json', { environments: { staging: { serviceId: 'srv-fixture', serviceName: 'fixture-staging', branch: 'staging' } } });
  write('render.yaml', 'buildCommand: node build.mjs\nstaticPublishPath: dist\n');
  write('fixtures/deploys.json', [{ deploy: { id: 'dep-fixture', status: 'live', commit: { id: servingSha }, finishedAt: '2026-09-06T17:00:00Z' } }]);
  write('fixtures/service.json', { name: 'fixture-staging', branch: 'staging', autoDeploy: 'yes', serviceDetails: { buildCommand: 'node build.mjs', publishPath: 'dist' }, ...service });
  write('fixtures/custom-domains.json', [{ name: 'staging.example.invalid', verificationStatus: domainVerified ? 'verified' : 'pending' }]);
  const probe = { ok: true, status: 200, body: '<title>Focx</title>', certSubject: 'CN=staging.example.invalid', ...health };
  write('fixtures/probes.json', { [url]: probe, [url + '/']: probe });
  write('fixtures/compare.json', comparison);
  write('fixtures/gh-options.json', { projection, prUrl, ...gh });
  write('fixtures/gh.mjs', fixtureGh);
  write('offline.mjs', offlineBootstrap);
  const stdout = execFileSync(process.execPath, [join(root, 'offline.mjs')], {
    cwd: root,
    // Deliberately do not inherit credentials, NODE_OPTIONS, or GitHub state.
    env: { PATH: dirname(process.execPath), EVENT: 'staging', EXPECTED_SHA: sha, SERVICE_ID: 'srv-fixture', PUBLIC_URL: url, CONTENT_MARKER: '<title>Focx</title>', DEPLOY_VERIFY_FIXTURES: join(root, 'fixtures'), GITHUB_REPOSITORY: 'example/fixture', GITHUB_OUTPUT: join(root, 'github-output') },
    encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const read = (path) => readFileSync(join(root, path), 'utf8');
  let calls = [];
  try { calls = read('fixtures/gh-calls.jsonl').trim().split('\n').map(JSON.parse); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  assert.match(stdout, /contracts: 1 artifact\(s\) valid/);
  const record = JSON.parse(read('pipeline/releases/dep-fixture.json'));
  assert.match(read('github-output'), new RegExp('outcome=' + record.outcome));
  return { record, calls, read };
}

function assertPromotion(result) {
  assert.equal(result.record.outcome, 'live');
  assert.equal(result.record.unverified, undefined);
  assert.deepEqual(result.record.promotion, { prUrl, commitRange: '1234567..abcdef0', merged: false });
}

function assertEvidence(result) {
  const create = result.calls.find((args) => args[0] === 'pr' && args[1] === 'create');
  assert.ok(create, 'must open a promotion');
  assert.deepEqual(create.slice(2, 9), ['--draft', '--base', 'main', '--head', 'staging', '--title', 'Promote staging to production']);
  assert.equal(create[create.indexOf('--body') + 1], [
    'Staging is verified \u0060live\u0060 at \u0060' + sha + '\u0060 — deploy \u0060dep-fixture\u0060, HTTP 200 over valid TLS at ' + url + ', content marker matched, 1 domain(s) verified, zero infrastructure drift.',
    '',
    'Promotes 133 commit(s): \u00601234567..abcdef0\u0060.',
    '',
    'Release record: \u0060pipeline/releases/dep-fixture.json\u0060. Bots never merge — this PR waits for a human.',
  ].join('\n'));
}

function assertCause(result) {
  assert.equal(result.record.outcome, 'degraded');
  assert.equal(result.record.promotion, undefined);
  assert.equal(result.record.unverified.length, 1);
  assert.match(result.record.unverified[0], /^promotion step failed: gh pr create failed \(exit 1\): GraphQL: Resource not accessible by integration \(HTTP 403\)/);
}

test('32 MiB compare response is projected and promotion retains every evidence field', (t) => {
  assert.ok(Buffer.byteLength(JSON.stringify(largeCompare)) > 32 * 1024 * 1024);
  const result = run(t);
  assertPromotion(result);
  assertEvidence(result);
  assert.deepEqual(JSON.parse(result.read('fixtures/compare-output.json')), { base_commit: { sha: base }, ahead_by: 133, behind_by: 7 });
});

test('explicit budget handles stdout and stderr each larger than the old 1 MiB default', (t) => {
  assertPromotion(run(t, { gh: { padding: 2 * 1024 * 1024, stderrBytes: 2 * 1024 * 1024 } }));
});

test('a genuinely failing PR command records stderr cause before the long command body', (t) => {
  assertCause(run(t, { gh: { fail: 'pr create' } }));
});

test('a remaining buffer failure records ENOBUFS and the actual limit', (t) => {
  const result = run(t, { gh: { padding: 20 * 1024 * 1024 } });
  assert.equal(result.record.outcome, 'degraded');
  assert.match(result.record.unverified[0], /promotion step failed: gh api .* failed \(ENOBUFS\): output exceeded 16777216-byte maxBuffer/);
  assert.equal(result.record.promotion, undefined);
});

test('existing promotion gets its original verification comment', (t) => {
  const result = run(t, { gh: { existing: prUrl } });
  assertPromotion(result);
  assert.equal(result.calls.some((args) => args[1] === 'create'), false);
  const comment = result.calls.find((args) => args[1] === 'comment');
  assert.deepEqual(comment, ['pr', 'comment', prUrl, '--body', 'Staging verified \u0060live\u0060 again at \u0060abcdef0\u0060 (deploy \u0060dep-fixture\u0060, 133 commit(s) ahead of main). Record: \u0060pipeline/releases/dep-fixture.json\u0060.']);
});

test('no commits ahead means no promotion, even with commits behind', (t) => {
  const result = run(t, { comparison: { base_commit: { sha: base }, ahead_by: 0, behind_by: 7 } });
  assert.equal(result.record.outcome, 'live');
  assert.equal(result.record.promotion, undefined);
  assert.equal(result.calls.length, 1);
});

for (const [name, input, outcome] of [
  ['HTTP failure', { health: { status: 503 } }, 'failed'],
  ['TLS failure', { health: { ok: false, error: 'certificate expired' } }, 'failed'],
  ['missing content marker', { health: { body: 'wrong site' } }, 'failed'],
  ['wrong serving commit', { servingSha: base }, 'failed'],
  ['infrastructure drift', { service: { branch: 'wrong' } }, 'degraded'],
  ['unverified domain', { domainVerified: false }, 'degraded'],
]) {
  test(name + ' still prevents promotion', (t) => {
    const result = run(t, { comparison: {}, ...input });
    assert.equal(result.record.outcome, outcome);
    assert.equal(result.record.promotion, undefined);
    assert.deepEqual(result.calls, []);
  });
}

// Run the same positive assertions against temporary source knock-outs. Each
// must fail, proving the fixtures detect the guard rather than assume success.
for (const [name, before, after, options, verify] of [
  ['projection', "'--jq', '" + projection + "'", '', {}, assertPromotion],
  ['request pagination', '?per_page=1&page=1', '', {}, assertPromotion],
  ['buffer budget', 'maxBuffer: GH_MAX_BUFFER, ', '', { gh: { padding: 2 * 1024 * 1024 } }, assertPromotion],
  ['cause preservation', source.split('\n').find((line) => line.includes('throw new Error') && line.includes('status')), '    throw err;', { gh: { fail: 'pr create' } }, assertCause],
  ['promotion evidence', 'content marker matched, ', '', {}, assertEvidence],
  ['unverified recording', source.split('\n').find((line) => line.includes('unverified.push') && line.includes('promotion step failed')), '', { gh: { fail: 'pr create' } }, assertCause],
  ['buffer cause', "err.code === 'ENOBUFS'", 'false', { gh: { padding: 20 * 1024 * 1024 } }, (result) => assert.match(result.record.unverified[0], /output exceeded 16777216-byte maxBuffer/)],
]) {
  test('knock-out is detected: ' + name, (t) => {
    assert.equal(source.split(before).length, 2, 'knock-out must match exactly once');
    const result = run(t, { ...options, code: source.replace(before, after) });
    assert.throws(() => verify(result), { name: 'AssertionError' });
  });
}
