import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const exec = promisify(execFile)
const root = new URL('.', import.meta.url).pathname

test('compiled broker policy rejects cross-scope and transport bypasses', async () => {
  const buildDir = await mkdtemp(join(tmpdir(), 'focx-broker-test-'))
  try {
    const env = {
      ...process.env,
      FOCX_BROKER_BUILD_DIR: buildDir,
      CLANG_MODULE_CACHE_PATH: join(buildDir, 'clang-cache'),
    }
    const { stdout: buildOutput } = await exec('/bin/sh', [join(root, 'build.sh')], { env })
    const binary = buildOutput.trim()
    const { stdout } = await exec(binary, ['--self-test'], { env })
    assert.match(stdout, /18 passed, 0 failed/)
  } finally {
    await rm(buildDir, { recursive: true, force: true })
  }
})
