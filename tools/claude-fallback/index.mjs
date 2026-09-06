#!/usr/bin/env node
// claude-fallback — runs Claude Code with subscription auth first, then an
// explicitly permitted metered credential when the subscription is capped.

import { spawn } from 'node:child_process';
import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const SCRIPT_REALPATH = realpathSync(fileURLToPath(import.meta.url));
const ACTIVE_SENTINEL = 'CLAUDE_FALLBACK_ACTIVE';
const SIGNATURE_OVERLAP_CHARS = 512;
let unexpectedStreamError = false;

// Claude Code 2.1.251 does not document a stable machine-readable error for
// subscription exhaustion. Its bundled strings include several of the phrases
// below, but an actual exhausted subscription was deliberately not consumed to
// confirm which text reaches stderr in print mode. Keep this best-effort list in
// one place until Anthropic publishes or we observe the exact failure shape.
export const RATE_LIMIT_SIGNATURES = Object.freeze([
  { reason: 'usage-limit-reached', pattern: /\busage limit (?:has been )?(?:reached|exceeded)\b/i },
  { reason: 'weekly-usage-limit', pattern: /\byou have reached your weekly usage limit\b/i },
  { reason: 'plan-limit-reached', pattern: /\byou(?:'|’)ve reached your [^\r\n]{0,80}\blimit\b/i },
  { reason: 'monthly-spend-limit', pattern: /\byou(?:'|’)ve hit your monthly spend limit\b/i },
  { reason: 'usage-credits-exhausted', pattern: /\byou(?:'|’)re out of (?:extra )?usage credits?\b/i },
  { reason: 'organization-usage-exhausted', pattern: /\byour org is out of usage\b/i },
  { reason: 'usage-credit-limit', pattern: /\busage credits? limit reached\b/i },
  // Anthropic's canonical machine-readable API error type. Unlike the generic
  // English phrase "rate limited", this token is specific enough to stand alone.
  { reason: 'rate-limit-error-type', pattern: /\brate_limit_error\b/i },
  {
    reason: 'rate-limit-error',
    pattern: /(?:\b(?:anthropic|claude|usage|subscription)\b[^\r\n]{0,80}\brate[_ -]?limit(?:ed|_error)?\b|\brate[_ -]?limit(?:ed|_error)?\b[^\r\n]{0,80}\b(?:anthropic|claude|usage|subscription)\b)/i,
  },
  { reason: 'http-429', pattern: /\b(?:http(?: error)?[ /]|status(?: code)?[=: ]+)429\b/i },
  {
    reason: 'quota-exceeded',
    pattern: /(?:\b(?:anthropic|claude|usage|subscription)\b[^\r\n]{0,80}\bquota(?: has been)?[ _-]exceeded\b|\bquota(?: has been)?[ _-]exceeded\b[^\r\n]{0,80}\b(?:anthropic|claude|usage|subscription)\b)/i,
  },
]);

// The generic HTTP 429 signature is useful for Claude API failures, but Git's
// curl transport emits this same status for unrelated remote-server failures.
const NON_CLAUDE_ERROR_SIGNATURES = Object.freeze([
  /\bRPC failed;\s*HTTP 429\b[^\r\n]*\bcurl\b/i,
]);

function byteLength(value) {
  if (typeof value === 'number') return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  return Buffer.byteLength(String(value ?? ''));
}

// Returns the stable reason id for a matching signature, or null. `stdout` may
// be the streamed byte count so callers never need to retain protocol output.
// This intentionally fails closed with --output-format stream-json: if Claude
// reports a subscription cap only through stdout, stdout is non-empty and
// stderr has no signature, so no fallback occurs. That prevents surprise spend
// but may mean fallback never activates until the real CLI failure is observed.
export function isRateLimited({ stderr, matchedReason, stdout, exitCode }) {
  if (!Number.isInteger(exitCode) || exitCode === 0 || byteLength(stdout) !== 0) return null;

  return matchedReason ?? matchRateLimitSignature(stderr);
}

export function matchRateLimitSignature(stderr) {
  const text = Buffer.isBuffer(stderr) || stderr instanceof Uint8Array
    ? Buffer.from(stderr).toString('utf8')
    : String(stderr ?? '');

  if (NON_CLAUDE_ERROR_SIGNATURES.some((pattern) => pattern.test(text))) return null;

  return RATE_LIMIT_SIGNATURES.find(({ pattern }) => pattern.test(text))?.reason ?? null;
}

class IncrementalRateLimitDetector {
  constructor() {
    this.decoder = new StringDecoder('utf8');
    this.tail = '';
    this.reason = null;
    this.disqualified = false;
  }

  push(value) {
    this.inspect(this.decoder.write(value));
  }

  inspect(text) {
    const window = this.tail + text;
    if (NON_CLAUDE_ERROR_SIGNATURES.some((pattern) => pattern.test(window))) {
      this.disqualified = true;
      this.reason = null;
    } else if (!this.reason && !this.disqualified) {
      this.reason = RATE_LIMIT_SIGNATURES.find(({ pattern }) => pattern.test(window))?.reason ?? null;
    }
    this.tail = window.slice(-SIGNATURE_OVERLAP_CHARS);
  }

  finish() {
    this.inspect(this.decoder.end());
    return this.reason;
  }
}

class ReplayableStdin {
  constructor(input) {
    this.input = input;
    this.chunks = [];
    this.destination = null;
    this.ended = input.readableEnded;
    this.capture = (chunk) => this.chunks.push(Buffer.from(chunk));
    this.markEnded = () => {
      this.ended = true;
    };

    input.on('data', this.capture);
    input.once('end', this.markEnded);
  }

  connectInitial(destination) {
    this.destination = destination;
    ignoreBrokenPipe(destination);

    if (this.ended || this.input.readableEnded) {
      destination.end(Buffer.concat(this.chunks));
      return;
    }

    this.input.pipe(destination);
  }

  detachAndPause() {
    if (this.destination) this.input.unpipe(this.destination);
    this.destination = null;
    if (!this.ended && !this.input.readableEnded) this.input.pause();
  }

  connectReplay(destination) {
    this.destination = destination;
    ignoreBrokenPipe(destination);
    const replay = Buffer.concat(this.chunks);

    if (this.ended || this.input.readableEnded) {
      destination.end(replay);
      return;
    }

    destination.write(replay);
    this.input.pipe(destination);
    this.input.resume();
  }

  dispose() {
    this.detachAndPause();
    this.input.off('data', this.capture);
    this.input.off('end', this.markEnded);
  }
}

export function ignoreBrokenPipe(stream, onUnexpected = () => {
  unexpectedStreamError = true;
}) {
  stream.on('error', (error) => {
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') return;
    onUnexpected(error);
  });
}

function trackStderr(value, state) {
  const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (chunk.byteLength > 0) state.endsWithNewline = chunk[chunk.byteLength - 1] === 0x0a;
}

function forwardStderr(value, state) {
  const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
  trackStderr(chunk, state);
  process.stderr.write(chunk);
}

export function forwardWithBackpressure(source, destination, onChunk = () => {}) {
  let destinationFailed = false;
  const onData = (chunk) => {
    onChunk(chunk);
    if (!destinationFailed && !destination.write(chunk)) source.pause();
  };
  const onDrain = () => source.resume();
  const onError = () => {
    destinationFailed = true;
    source.resume();
  };

  source.on('data', onData);
  destination.on('drain', onDrain);
  destination.on('error', onError);

  return () => {
    source.off('data', onData);
    destination.off('drain', onDrain);
    destination.off('error', onError);
  };
}

function writeMarker(marker, state) {
  const prefix = state.endsWithNewline ? '' : '\n';
  process.stderr.write(`${prefix}${marker}\n`);
  state.endsWithNewline = true;
}

function buildChildEnv(path, fallbackApiKey) {
  const env = { ...process.env };

  // Credential controls must not leak into Claude or tools Claude launches.
  // The non-secret sentinel is intentionally inherited to stop nested wrappers.
  delete env.CLAUDE_BIN;
  delete env.CLAUDE_FALLBACK_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env[ACTIVE_SENTINEL] = SCRIPT_REALPATH;

  if (path === 'subscription') {
    // This deletion is the core subscription-first guarantee. Claude Code gives
    // ANTHROPIC_API_KEY precedence over CLAUDE_CODE_OAUTH_TOKEN.
    delete env.ANTHROPIC_API_KEY;
  } else {
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    env.ANTHROPIC_API_KEY = fallbackApiKey;
  }

  return env;
}

function runAttempt({ binary, args, env, connectStdin, stderrState, detectRateLimit = false }) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const detector = detectRateLimit ? new IncrementalRateLimitDetector() : null;
    let stdoutBytes = 0;
    let spawnError = null;

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.byteLength;
    });
    child.stdout.pipe(process.stdout, { end: false });

    const stopStderrForwarding = forwardWithBackpressure(child.stderr, process.stderr, (chunk) => {
      detector?.push(chunk);
      trackStderr(chunk, stderrState);
    });

    child.once('error', (error) => {
      spawnError = error;
      forwardStderr(`${error.message}\n`, stderrState);
    });
    child.once('close', (exitCode, signal) => {
      stopStderrForwarding();
      resolve({
        exitCode,
        signal,
        spawnError,
        matchedReason: detector?.finish() ?? null,
        stdoutBytes,
      });
    });

    connectStdin(child.stdin);
  });
}

function setFinalStatus({ exitCode, signal }) {
  if (unexpectedStreamError) {
    process.exitCode = 1;
    return;
  }
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = Number.isInteger(exitCode) && exitCode >= 0 ? exitCode : 1;
}

function resolveExecutableRealpath(binary) {
  const candidates = binary.includes('/') || binary.includes('\\')
    ? [resolve(binary)]
    : (process.env.PATH ?? '').split(delimiter).map((directory) => resolve(directory || '.', binary));

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Try the next PATH entry; spawn reports a missing binary normally.
    }
  }
  return null;
}

function recursionError(binary) {
  const resolvedBinary = resolveExecutableRealpath(binary);
  const claudeBinExplicit = Object.hasOwn(process.env, 'CLAUDE_BIN');

  if (resolvedBinary === SCRIPT_REALPATH) {
    return `${JSON.stringify(binary)} resolves to this wrapper; set CLAUDE_BIN to the real Claude Code binary or move the wrapper behind it on PATH`;
  }

  if (process.env[ACTIVE_SENTINEL] && !claudeBinExplicit) {
    return `nested wrapper invocation detected with no explicit CLAUDE_BIN; set CLAUDE_BIN to the real Claude Code binary (current value: ${JSON.stringify(binary)})`;
  }

  return null;
}

export async function main() {
  unexpectedStreamError = false;
  ignoreBrokenPipe(process.stdout);
  ignoreBrokenPipe(process.stderr);

  const binary = process.env.CLAUDE_BIN ?? 'claude';
  const args = process.argv.slice(2);
  const fallbackApiKey = process.env.CLAUDE_FALLBACK_API_KEY;
  const fallbackAllowed = typeof fallbackApiKey === 'string' && fallbackApiKey.trim() !== '';
  const stderrState = { endsWithNewline: true };

  const recursion = recursionError(binary);
  if (recursion) {
    forwardStderr(`claude-fallback: refusing to recurse: ${recursion}\n`, stderrState);
    writeMarker('[claude-fallback] path=none reason=recursion-guard', stderrState);
    process.exitCode = 1;
    return;
  }

  const stdin = new ReplayableStdin(process.stdin);

  const subscription = await runAttempt({
    binary,
    args,
    env: buildChildEnv('subscription'),
    connectStdin: (destination) => stdin.connectInitial(destination),
    stderrState,
    detectRateLimit: true,
  });
  stdin.detachAndPause();

  const reason = isRateLimited({
    matchedReason: subscription.matchedReason,
    stdout: subscription.stdoutBytes,
    exitCode: subscription.exitCode,
  });

  if (reason && fallbackAllowed) {
    writeMarker(`[claude-fallback] path=metered reason=${reason}`, stderrState);
    const metered = await runAttempt({
      binary,
      args,
      env: buildChildEnv('metered', fallbackApiKey),
      connectStdin: (destination) => stdin.connectReplay(destination),
      stderrState,
    });
    stdin.dispose();
    setFinalStatus(metered);
    return;
  }

  stdin.dispose();
  writeMarker('[claude-fallback] path=subscription', stderrState);
  setFinalStatus(subscription);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) await main();
