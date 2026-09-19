import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const schemaFile = new URL('../../pipeline/contracts/run.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
const branchPattern = new RegExp(schema.properties.branch.pattern);

for (const branch of [
  'run/run-20260905-114928-manual',
  'FOC-36-nightly-research-scan',
  'FOCAAA-1-qa-lane-smoke-test',
  'FOCA-1-x',
]) {
  test(`branch pattern accepts ${branch}`, () => {
    assert.equal(branchPattern.test(branch), true);
  });
}

for (const branch of [
  'foca-1-x',
  'RANDOM-branch',
  'main',
  'feature/run/thing',
  '-1-x',
]) {
  test(`branch pattern rejects ${branch}`, () => {
    assert.equal(branchPattern.test(branch), false);
  });
}

test('validator accepts a company issue branch and rejects an invalid branch', () => {
  const root = mkdtempSync(join(tmpdir(), 'contracts-'));
  try {
    // check() is private and paths are relative to the validator module, so run
    // an unchanged copy with the real schema in an isolated repository layout.
    const scripts = join(root, 'tools/contracts');
    const contracts = join(root, 'pipeline/contracts');
    const runId = 'run-20260905-114928-manual';
    const run = join(root, 'pipeline/runs', runId);
    for (const dir of [scripts, contracts, run]) mkdirSync(dir, { recursive: true });
    const script = join(scripts, 'validate.mjs');
    copyFileSync(new URL('./validate.mjs', import.meta.url), script);
    copyFileSync(schemaFile, join(contracts, 'run.schema.json'));
    const artifact = {
      runId,
      trigger: { source: 'manual' },
      prompt: 'Validate the company issue branch convention.',
      createdAt: '2026-09-05T11:49:28Z',
      branch: 'FOCAAA-1-qa-lane-smoke-test',
    };
    const validate = () => {
      writeFileSync(join(run, '00-run.json'), JSON.stringify(artifact));
      return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    };
    const accepted = validate();
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /contracts: 1 artifact\(s\) valid/);
    assert.equal(accepted.stderr, '');

    artifact.branch = 'foca-1-x';
    const rejected = validate();
    assert.equal(rejected.error, undefined);
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(rejected.stderr, /\$\.branch: does not match pattern/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
