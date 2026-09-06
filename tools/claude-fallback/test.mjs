import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { forwardWithBackpressure, ignoreBrokenPipe, isRateLimited } from './index.mjs';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const WRAPPER = join(DIR, 'index.mjs');
const STUB = join(DIR, 'stub.mjs');
const CONTROL_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_BIN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_FALLBACK_API_KEY',
  'CLAUDE_FALLBACK_ACTIVE',
  'CLAUDE_STUB_DELAY_MS',
  'CLAUDE_STUB_EXIT_CODE',
  'CLAUDE_STUB_EXPECT_API_KEY',
  'CLAUDE_STUB_EXPECT_OAUTH',
  'CLAUDE_STUB_LOG',
  'CLAUDE_STUB_METERED_EXIT_CODE',
  'CLAUDE_STUB_MODE',
  'CLAUDE_STUB_NO_STDERR_NEWLINE',
  'CLAUDE_STUB_STDERR',
  'CLAUDE_STUB_STDERR_PADDING_BYTES',
  'CLAUDE_STUB_SUBSCRIPTION_EXIT_CODE',
];

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of CONTROL_KEYS) delete env[key];
  return {
    ...env,
    CLAUDE_BIN: STUB,
    CLAUDE_CODE_OAUTH_TOKEN: 'test-subscription-token',
    CLAUDE_STUB_EXPECT_OAUTH: 'test-subscription-token',
    CLAUDE_STUB_EXPECT_API_KEY: 'test-metered-key',
    ...overrides,
  };
}

function run(mode, options = {}) {
  return spawnSync(process.execPath, [WRAPPER, ...(options.args ?? ['--print', 'prompt'])], {
    encoding: 'utf8',
    env: cleanEnv({ CLAUDE_STUB_MODE: mode, ...(options.env ?? {}) }),
    input: options.input ?? 'piped prompt',
  });
}

function markerLines(stderr) {
  return stderr.split('\n').filter((line) => line.startsWith('[claude-fallback]'));
}

function readLog(path) {
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('isRateLimited centralizes positive signatures and side-effect guards', () => {
  assert.equal(isRateLimited({ stderr: 'Usage limit reached', stdout: 0, exitCode: 1 }), 'usage-limit-reached');
  assert.equal(isRateLimited({ stderr: 'Anthropic API: rate limited', stdout: 0, exitCode: 1 }), 'rate-limit-error');
  assert.equal(isRateLimited({ stderr: 'HTTP 429', stdout: Buffer.alloc(0), exitCode: 1 }), 'http-429');
  assert.equal(isRateLimited({ stderr: 'Claude subscription quota exceeded', stdout: 0, exitCode: 1 }), 'quota-exceeded');
  assert.equal(isRateLimited({ stderr: 'Usage limit reached', stdout: 0, exitCode: 0 }), null);
  assert.equal(isRateLimited({ stderr: 'Usage limit reached', stdout: 1, exitCode: 1 }), null);
  assert.equal(isRateLimited({ stderr: 'ECONNRESET: network failure', stdout: 0, exitCode: 1 }), null);
  assert.equal(isRateLimited({ stderr: 'Task failed: bad usage', stdout: 0, exitCode: 1 }), null);
});

test('N1: canonical Anthropic rate_limit_error shapes are detected', () => {
  const genuineErrors = [
    '{"type":"error","error":{"type":"rate_limit_error","message":"Rate limit exceeded"}}',
    'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
    'Error: rate_limit_error',
    'rate_limit_error: retry after 60s',
    'AnthropicError: rate_limit_error (429)',
    'Request failed with error type rate_limit_error',
  ];

  for (const stderr of genuineErrors) {
    assert.equal(isRateLimited({ stderr, stdout: 0, exitCode: 1 }), 'rate-limit-error-type', stderr);
  }

  const temp = mkdtempSync(join(tmpdir(), 'claude-fallback-'));
  const log = join(temp, 'attempts.jsonl');
  try {
    const result = run('custom-error', {
      env: {
        CLAUDE_FALLBACK_API_KEY: 'test-metered-key',
        CLAUDE_STUB_LOG: log,
        CLAUDE_STUB_STDERR: genuineErrors[0],
      },
    });
    assert.equal(result.status, 0);
    assert.equal(readLog(log).length, 2);
    assert.deepEqual(markerLines(result.stderr), [
      '[claude-fallback] path=metered reason=rate-limit-error-type',
    ]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('D3: unrelated quota and rate-limit errors never authorize metered fallback', () => {
  const unrelatedErrors = [
    'Error: EDQUOT: disk quota exceeded, write',
    'gh: API rate limit exceeded for user',
    'Docker: You have reached your pull rate limit.',
    'eslint: rule "rate-limit" is not defined',
    'S3 quota exceeded for bucket uploads',
    'Postgres: disk quota exceeded on tablespace',
    'error: RPC failed; HTTP 429 curl 22',
  ];

  for (const stderr of unrelatedErrors) {
    assert.equal(isRateLimited({ stderr, stdout: 0, exitCode: 1 }), null, stderr);
  }

  const temp = mkdtempSync(join(tmpdir(), 'claude-fallback-'));
  const log = join(temp, 'attempts.jsonl');
  try {
    const result = run('custom-error', {
      env: {
        CLAUDE_FALLBACK_API_KEY: 'test-metered-key',
        CLAUDE_STUB_LOG: log,
        CLAUDE_STUB_STDERR: unrelatedErrors[0],
      },
    });
    assert.equal(result.status, 23);
    assert.equal(readLog(log).length, 1);
    assert.deepEqual(markerLines(result.stderr), ['[claude-fallback] path=subscription']);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('subscription path forwards argv/stdin/stderr and removes the parent API key', () => {
  const result = run('success', {
    args: ['--output-format', 'stream-json', '--flag=value'],
    input: 'prompt from stdin',
    env: {
      ANTHROPIC_API_KEY: 'must-not-reach-subscription-attempt',
      ANTHROPIC_AUTH_TOKEN: 'must-not-reach-either-attempt',
      CLAUDE_FALLBACK_API_KEY: 'test-metered-key',
    },
  });

  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.argv, ['--output-format', 'stream-json', '--flag=value']);
  assert.equal(report.stdin, 'prompt from stdin');
  assert.equal(report.attempt, 'subscription');
  assert.equal(report.oauthPresent, true);
  assert.equal(report.oauthMatchesExpected, true);
  assert.equal(report.apiKeyPresent, false);
  assert.equal(report.authTokenPresent, false);
  assert.equal(report.fallbackKeyPresent, false);
  assert.match(result.stderr, /stub subscription stderr\n/);
  assert.deepEqual(markerLines(result.stderr), ['[claude-fallback] path=subscription']);
});

test('metered fallback path replays stdin, swaps credentials, and preserves fallback exit code', () => {
  const temp = mkdtempSync(join(tmpdir(), 'claude-fallback-'));
  const log = join(temp, 'attempts.jsonl');
  try {
    const result = run('rate-limit', {
      args: ['--print', '--output-format', 'stream-json'],
      input: 'replay this prompt',
      env: {
        ANTHROPIC_API_KEY: 'must-not-reach-subscription-attempt',
        ANTHROPIC_AUTH_TOKEN: 'must-not-reach-either-attempt',
        CLAUDE_FALLBACK_API_KEY: 'test-metered-key',
        CLAUDE_STUB_LOG: log,
        CLAUDE_STUB_METERED_EXIT_CODE: '7',
      },
    });

    assert.equal(result.status, 7);
    const attempts = readLog(log);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts.map(({ attempt }) => attempt), ['subscription', 'metered']);
    assert.deepEqual(attempts.map(({ stdin }) => stdin), ['replay this prompt', 'replay this prompt']);
    assert.deepEqual(attempts.map(({ argv }) => argv), [
      ['--print', '--output-format', 'stream-json'],
      ['--print', '--output-format', 'stream-json'],
    ]);
    assert.equal(attempts[0].oauthMatchesExpected, true);
    assert.equal(attempts[0].apiKeyPresent, false);
    assert.equal(attempts[0].authTokenPresent, false);
    assert.equal(attempts[0].fallbackKeyPresent, false);
    assert.equal(attempts[1].oauthPresent, false);
    assert.equal(attempts[1].apiKeyPresent, true);
    assert.equal(attempts[1].apiKeyMatchesExpected, true);
    assert.equal(attempts[1].authTokenPresent, false);
    assert.equal(attempts[1].fallbackKeyPresent, false);
    assert.equal(JSON.parse(result.stdout).attempt, 'metered');
    assert.match(result.stderr, /^Usage limit reached\n/);
    assert.match(result.stderr, /stub metered stderr\n/);
    assert.deepEqual(markerLines(result.stderr), [
      '[claude-fallback] path=metered reason=usage-limit-reached',
    ]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('D2: markers start on their own line after newline-less child stderr', () => {
  const subscription = run('success', {
    env: { CLAUDE_STUB_NO_STDERR_NEWLINE: '1' },
  });
  assert.equal(subscription.status, 0);
  assert.match(subscription.stderr, /^stub subscription stderr\n\[claude-fallback\] path=subscription\n$/);
  assert.deepEqual(markerLines(subscription.stderr), ['[claude-fallback] path=subscription']);

  const fallback = run('rate-limit', {
    env: {
      CLAUDE_FALLBACK_API_KEY: 'test-metered-key',
      CLAUDE_STUB_NO_STDERR_NEWLINE: '1',
    },
  });
  assert.equal(fallback.status, 0);
  assert.match(fallback.stderr, /^Usage limit reached\n\[claude-fallback\] path=metered reason=usage-limit-reached\nstub metered stderr$/);
  assert.deepEqual(markerLines(fallback.stderr), [
    '[claude-fallback] path=metered reason=usage-limit-reached',
  ]);
});

test('fallback requires every eligibility condition', () => {
  const cases = [
    { name: 'non-zero exit', mode: 'zero-exit-rate-limit', fallbackKey: 'test-metered-key', status: 0 },
    { name: 'zero stdout bytes', mode: 'stdout-rate-limit', fallbackKey: 'test-metered-key', status: 23 },
    { name: 'rate-limit signature', mode: 'normal-error', fallbackKey: 'test-metered-key', status: 23 },
    { name: 'fallback key present', mode: 'rate-limit', fallbackKey: undefined, status: 23 },
    { name: 'empty fallback key revoked', mode: 'rate-limit', fallbackKey: '', status: 23 },
    { name: 'whitespace fallback key revoked', mode: 'rate-limit', fallbackKey: ' \t ', status: 23 },
  ];

  for (const scenario of cases) {
    const temp = mkdtempSync(join(tmpdir(), 'claude-fallback-'));
    const log = join(temp, 'attempts.jsonl');
    try {
      const env = { CLAUDE_STUB_LOG: log };
      if (scenario.fallbackKey !== undefined) env.CLAUDE_FALLBACK_API_KEY = scenario.fallbackKey;
      const result = run(scenario.mode, { env });

      assert.equal(result.status, scenario.status, scenario.name);
      assert.equal(readLog(log).length, 1, scenario.name);
      assert.deepEqual(markerLines(result.stderr), ['[claude-fallback] path=subscription'], scenario.name);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
});

test('D1: closed stdout and stderr pipes do not crash the wrapper with EPIPE', async () => {
  const child = spawn(process.execPath, [WRAPPER, '--output-format', 'stream-json'], {
    env: cleanEnv({ CLAUDE_STUB_MODE: 'stream', CLAUDE_STUB_DELAY_MS: '200' }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end('stream prompt');
  child.stdout.once('data', () => child.stdout.destroy());
  child.stderr.once('data', () => child.stderr.destroy());

  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  assert.deepEqual(status, { code: 0, signal: null });
});

test('unexpected stream errors are reported without throwing from the listener', () => {
  const listeners = new Map();
  const stream = {
    on(event, listener) {
      listeners.set(event, listener);
    },
  };
  let unexpected = null;
  ignoreBrokenPipe(stream, (error) => {
    unexpected = error;
  });

  assert.doesNotThrow(() => listeners.get('error')(Object.assign(new Error('stream failed'), { code: 'EIO' })));
  assert.equal(unexpected?.code, 'EIO');
  unexpected = null;
  assert.doesNotThrow(() => listeners.get('error')(Object.assign(new Error('closed pipe'), { code: 'EPIPE' })));
  assert.equal(unexpected, null);
});

test('N5: stderr forwarding pauses for backpressure and resumes on drain', () => {
  class Source extends EventEmitter {
    pauses = 0;
    resumes = 0;

    pause() {
      this.pauses += 1;
    }

    resume() {
      this.resumes += 1;
    }
  }

  class Destination extends EventEmitter {
    writes = [];

    write(chunk) {
      this.writes.push(Buffer.from(chunk));
      return false;
    }
  }

  const source = new Source();
  const destination = new Destination();
  const observed = [];
  const cleanup = forwardWithBackpressure(source, destination, (chunk) => observed.push(Buffer.from(chunk)));

  source.emit('data', Buffer.from('first'));
  assert.equal(source.pauses, 1);
  assert.equal(Buffer.concat(observed).toString('utf8'), 'first');
  destination.emit('drain');
  assert.equal(source.resumes, 1);

  destination.emit('error', Object.assign(new Error('closed'), { code: 'EPIPE' }));
  source.emit('data', Buffer.from('second'));
  assert.equal(source.resumes, 2);
  assert.equal(destination.writes.length, 1);
  assert.equal(Buffer.concat(observed).toString('utf8'), 'firstsecond');

  cleanup();
  source.emit('data', Buffer.from('ignored'));
  assert.equal(Buffer.concat(observed).toString('utf8'), 'firstsecond');
});

test('stdout is forwarded incrementally and byte-faithfully', async () => {
  const startedAt = Date.now();
  const child = spawn(process.execPath, [WRAPPER, '--output-format', 'stream-json'], {
    env: cleanEnv({ CLAUDE_STUB_MODE: 'stream', CLAUDE_STUB_DELAY_MS: '400' }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end('stream prompt');

  const stdout = [];
  const stderr = [];
  let firstByteAt = null;
  child.stdout.on('data', (chunk) => {
    firstByteAt ??= Date.now();
    stdout.push(Buffer.from(chunk));
  });
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));

  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, closedAt: Date.now() }));
  });

  assert.equal(status.code, 0);
  assert.equal(Buffer.concat(stdout).toString('utf8'), 'firstsecond');
  assert.ok(firstByteAt !== null && firstByteAt - startedAt < 300, 'first bytes arrived before stub exit');
  assert.ok(status.closedAt - firstByteAt >= 150, 'first bytes were not buffered until process close');
  const stderrText = Buffer.concat(stderr).toString('utf8');
  assert.match(stderrText, /^stub stream stderr\n/);
  assert.deepEqual(markerLines(stderrText), ['[claude-fallback] path=subscription']);
});

test('D5: a PATH symlink named claude that resolves to the wrapper fails instead of recursing', () => {
  const temp = mkdtempSync(join(tmpdir(), 'claude-fallback-'));
  try {
    symlinkSync(WRAPPER, join(temp, 'claude'));
    const env = cleanEnv({ PATH: temp, CLAUDE_FALLBACK_API_KEY: 'test-metered-key' });
    delete env.CLAUDE_BIN;
    const result = spawnSync(process.execPath, [WRAPPER, '--version'], {
      encoding: 'utf8',
      env,
      input: '',
      timeout: 2_000,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to recurse/);
    assert.match(result.stderr, /set CLAUDE_BIN to the real Claude Code binary/);
    assert.deepEqual(markerLines(result.stderr), ['[claude-fallback] path=none reason=recursion-guard']);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('N3: an explicit real CLAUDE_BIN overrides an inherited child sentinel', () => {
  const result = run('success', {
    env: { CLAUDE_FALLBACK_ACTIVE: WRAPPER },
  });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).attempt, 'subscription');
  assert.deepEqual(markerLines(result.stderr), ['[claude-fallback] path=subscription']);
});

test('N3/N4: a sentinel with no explicit CLAUDE_BIN refuses with an accurate marker', () => {
  const temp = mkdtempSync(join(tmpdir(), 'claude-fallback-'));
  try {
    symlinkSync(STUB, join(temp, 'claude'));
    const env = cleanEnv({ PATH: temp, CLAUDE_FALLBACK_ACTIVE: WRAPPER });
    delete env.CLAUDE_BIN;
    const result = spawnSync(process.execPath, [WRAPPER, '--version'], {
      encoding: 'utf8',
      env,
      input: '',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /nested wrapper invocation detected with no explicit CLAUDE_BIN/);
    assert.deepEqual(markerLines(result.stderr), ['[claude-fallback] path=none reason=recursion-guard']);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('N2: an early cap signature survives 200 KiB of later stderr', () => {
  const temp = mkdtempSync(join(tmpdir(), 'claude-fallback-'));
  const log = join(temp, 'attempts.jsonl');
  try {
    const result = run('large-stderr', {
      env: {
        CLAUDE_FALLBACK_API_KEY: 'test-metered-key',
        CLAUDE_STUB_LOG: log,
        CLAUDE_STUB_STDERR_PADDING_BYTES: String(200 * 1024),
      },
    });
    assert.equal(result.status, 0);
    assert.equal(readLog(log).length, 2);
    assert.deepEqual(markerLines(result.stderr), [
      '[claude-fallback] path=metered reason=usage-limit-reached',
    ]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('N2: incremental detection matches a signature split across stderr chunks', () => {
  const temp = mkdtempSync(join(tmpdir(), 'claude-fallback-'));
  const log = join(temp, 'attempts.jsonl');
  try {
    const result = run('chunked-rate-limit', {
      env: {
        CLAUDE_FALLBACK_API_KEY: 'test-metered-key',
        CLAUDE_STUB_LOG: log,
      },
    });
    assert.equal(result.status, 0);
    assert.equal(readLog(log).length, 2);
    assert.deepEqual(markerLines(result.stderr), [
      '[claude-fallback] path=metered reason=rate-limit-error-type',
    ]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('a missing Claude binary reports a clean error and exits 1', () => {
  const result = run('success', {
    env: { CLAUDE_BIN: join(tmpdir(), 'claude-fallback-does-not-exist') },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
  assert.deepEqual(markerLines(result.stderr), ['[claude-fallback] path=subscription']);
});

test('tool package exposes its dependency-free test script', () => {
  const packageJson = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.test, 'node --test test.mjs');
});
