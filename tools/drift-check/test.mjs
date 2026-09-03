import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./index.mjs', import.meta.url));

function fixture({ config, files = {}, parent = 'brand', tokenPattern = 'tokens/{namespace}/tokens.json' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'drift-check-'));
  const parentPath = tokenPattern.replace('{namespace}', parent);
  write(root, parentPath, JSON.stringify({ color: { primary: { value: '#123456' } } }));
  if (config) write(root, 'drift-check.config.json', JSON.stringify(config));
  for (const [path, content] of Object.entries(files)) write(root, path, content);
  return root;
}

function write(root, path, content) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function run(root, env = {}, useWorkspace = true) {
  const processEnv = { ...process.env, ...env };
  if (useWorkspace) processEnv.GITHUB_WORKSPACE = root;
  else delete processEnv.GITHUB_WORKSPACE;
  return spawnSync(process.execPath, [script], {
    cwd: useWorkspace ? dirname(script) : root,
    env: processEnv,
    encoding: 'utf8',
  });
}

test('resolves the consumer root from GITHUB_WORKSPACE and reads config', () => {
  const root = fixture({
    config: {
      parentNamespace: 'brand',
      tokenPathPattern: 'tokens/{namespace}/tokens.json',
      scanDirs: ['src'],
      scanExtensions: ['.css'],
    },
    files: { 'src/clean.css': 'color: #123456;' },
  });
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /clean/);
});

test('falls back to the current working directory outside GitHub Actions', () => {
  const root = fixture({
    config: {
      parentNamespace: 'brand',
      tokenPathPattern: 'tokens/{namespace}/tokens.json',
      scanDirs: ['src'],
      scanExtensions: ['.css'],
    },
    files: { 'src/clean.css': 'color: #123456;' },
  });
  const result = run(root, {}, false);
  assert.equal(result.status, 0, result.stderr);
});

test('action inputs override config and emit file/line annotations', () => {
  const root = fixture({
    config: {
      parentNamespace: 'brand',
      tokenPathPattern: 'tokens/{namespace}/tokens.json',
      scanDirs: ['ignored'],
      scanExtensions: ['.txt'],
    },
    files: { 'src/bad.css': 'a {}\n.card { padding: 13px; }' },
  });
  const result = run(root, {
    GITHUB_ACTIONS: 'true',
    'INPUT_SCAN-DIRS': 'src',
    'INPUT_SCAN-EXTENSIONS': '.css',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/bad\.css:2/);
  assert.match(result.stdout, /::error file=src\/bad\.css,line=2,title=Design drift::/);
});

test('defaults preserve the original focx layout', () => {
  const root = mkdtempSync(join(tmpdir(), 'drift-check-defaults-'));
  write(root, 'design/tokens/focx/tokens.json', JSON.stringify({ space: { md: { value: '16px' } } }));
  write(root, 'apps/site/style.css', '.card { padding: 16px; }');
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test('invalid configuration fails without scanning outside the repository', () => {
  const root = fixture({
    config: {
      parentNamespace: 'brand',
      tokenPathPattern: '../{namespace}/tokens.json',
      scanDirs: ['../outside'],
      scanExtensions: ['.css'],
    },
  });
  const result = run(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must stay within the repository/);
});

test('the repository itself remains clean', () => {
  const repository = fileURLToPath(new URL('../..', import.meta.url));
  const output = execFileSync(process.execPath, [script], { cwd: repository, encoding: 'utf8' });
  assert.match(output, /clean/);
});
