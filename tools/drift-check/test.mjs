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

test('auto-detects TypeScript token layers and scans src by default', () => {
  const root = mkdtempSync(join(tmpdir(), 'drift-check-typescript-tokens-'));
  write(root, 'themes/light.ts', "export const colors = { primary: '#123456' };\n");
  write(root, 'src/card.tsx', "export const card = '<div style={{ color: \\\"#123456\\\" }} />';\n");
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 published values from 1 token files/);
});

test('accepts explicitly configured token files with arbitrary names', () => {
  const root = mkdtempSync(join(tmpdir(), 'drift-check-explicit-tokens-'));
  write(root, 'foundations/values.scss', '$brand-primary: #123456;\n');
  write(root, 'src/card.css', '.card { color: #123456; }\n');
  write(root, 'drift-check.config.json', JSON.stringify({ tokenFiles: ['foundations/values.scss'] }));
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test('excludes generated output, token definitions, SVG art, and test/story fixtures', () => {
  const root = mkdtempSync(join(tmpdir(), 'drift-check-exclusions-'));
  write(root, 'themes/light.ts', "export const primary = '#123456';\n");
  write(root, 'src/generated/report.generated.ts', "export const generated = '#aaaaaa';\n");
  write(root, 'src/tokens/local.ts', "export const local = '#bbbbbb';\n");
  write(root, 'src/components/Assets/Flags/Australia.tsx', "export const flag = '<svg><path fill=\\\"#012169\\\" /></svg>';\n");
  write(root, 'src/card.test.ts', "assert.equal(color, '#cccccc');\n");
  write(root, 'src/Card.stories.tsx', "export const story = { color: '#dddddd' };\n");
  write(root, 'coverage/report.ts', "export const report = '#eeeeee';\n");
  write(root, 'src/card.css', '.card { color: #123456; }\n');
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
});

test('parent/child integrity is opt-in', () => {
  const root = mkdtempSync(join(tmpdir(), 'drift-check-parent-child-'));
  write(root, 'design/tokens/focx/tokens.json', JSON.stringify({ color: { primary: { value: '#123456' } } }));
  write(root, 'design/tokens/acme/tokens.json', JSON.stringify({ color: { secondary: { value: '#654321' } } }));
  write(root, 'apps/site.css', '.card { color: #123456; }\n');

  const defaultResult = run(root);
  assert.equal(defaultResult.status, 0, defaultResult.stderr);

  write(root, 'drift-check.config.json', JSON.stringify({ validateParentChild: true }));
  const optedInResult = run(root);
  assert.equal(optedInResult.status, 1);
  assert.match(optedInResult.stderr, /silent parent redefinition is drift/);
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
