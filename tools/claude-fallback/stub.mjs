#!/usr/bin/env node
// Dependency-free Claude stand-in for verifying claude-fallback without using
// a real subscription or API key.

import { appendFileSync } from 'node:fs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));

const stdin = Buffer.concat(chunks).toString('utf8');
const oauthPresent = Object.hasOwn(process.env, 'CLAUDE_CODE_OAUTH_TOKEN');
const apiKeyPresent = Object.hasOwn(process.env, 'ANTHROPIC_API_KEY');
const authTokenPresent = Object.hasOwn(process.env, 'ANTHROPIC_AUTH_TOKEN');
const attempt = oauthPresent ? 'subscription' : apiKeyPresent ? 'metered' : 'unauthenticated';
const report = {
  attempt,
  argv: process.argv.slice(2),
  stdin,
  oauthPresent,
  apiKeyPresent,
  authTokenPresent,
  fallbackKeyPresent: Object.hasOwn(process.env, 'CLAUDE_FALLBACK_API_KEY'),
  oauthMatchesExpected: process.env.CLAUDE_CODE_OAUTH_TOKEN === process.env.CLAUDE_STUB_EXPECT_OAUTH,
  apiKeyMatchesExpected: process.env.ANTHROPIC_API_KEY === process.env.CLAUDE_STUB_EXPECT_API_KEY,
};

if (process.env.CLAUDE_STUB_LOG) {
  appendFileSync(process.env.CLAUDE_STUB_LOG, `${JSON.stringify(report)}\n`);
}

const writeReport = () => process.stdout.write(`${JSON.stringify(report)}\n`);
const writeStderr = (message) => {
  const suffix = process.env.CLAUDE_STUB_NO_STDERR_NEWLINE === '1' ? '' : '\n';
  process.stderr.write(`${message}${suffix}`);
};
const mode = process.env.CLAUDE_STUB_MODE ?? 'success';

switch (mode) {
  case 'success':
    writeStderr(`stub ${attempt} stderr`);
    writeReport();
    process.exit(Number(process.env.CLAUDE_STUB_EXIT_CODE ?? 0));
    break;
  case 'rate-limit':
    if (attempt === 'subscription') {
      writeStderr('Usage limit reached');
      process.exit(Number(process.env.CLAUDE_STUB_SUBSCRIPTION_EXIT_CODE ?? 23));
    }
    writeStderr('stub metered stderr');
    writeReport();
    process.exit(Number(process.env.CLAUDE_STUB_METERED_EXIT_CODE ?? 0));
    break;
  case 'stdout-rate-limit':
    process.stdout.write('partial protocol bytes\n');
    process.stderr.write('Usage limit reached\n');
    process.exit(23);
    break;
  case 'zero-exit-rate-limit':
    process.stderr.write('Usage limit reached\n');
    process.exit(0);
    break;
  case 'normal-error':
    process.stderr.write('Task failed: invalid command usage\n');
    process.exit(23);
    break;
  case 'custom-error':
    if (attempt === 'subscription') {
      process.stderr.write(process.env.CLAUDE_STUB_STDERR ?? 'custom error');
      process.exit(23);
    }
    writeReport();
    process.exit(0);
    break;
  case 'large-stderr':
    if (attempt === 'subscription') {
      const paddingBytes = Number(process.env.CLAUDE_STUB_STDERR_PADDING_BYTES ?? 200 * 1024);
      process.stderr.write(`Usage limit reached\n${'x'.repeat(paddingBytes)}`);
      process.exitCode = 23;
      break;
    }
    writeReport();
    process.exit(0);
    break;
  case 'chunked-rate-limit':
    if (attempt === 'subscription') {
      process.stderr.write('rate_');
      setTimeout(() => {
        process.stderr.write('limit_error');
        process.exitCode = 23;
      }, 20);
      break;
    }
    writeReport();
    process.exit(0);
    break;
  case 'stream':
    process.stderr.write('stub stream stderr\n');
    process.stdout.write('first');
    setTimeout(() => {
      process.stdout.write('second');
      process.exit(Number(process.env.CLAUDE_STUB_EXIT_CODE ?? 0));
    }, Number(process.env.CLAUDE_STUB_DELAY_MS ?? 400));
    break;
  default:
    process.stderr.write(`Unknown CLAUDE_STUB_MODE: ${mode}\n`);
    process.exit(64);
}
