// The reporting script is the only way a pilot under `approve-reads` can speak
// back to its task, so its failure modes matter more than its happy path. Every
// test here drives the real script against a stub control plane over HTTP: none
// of them assert on the script's internals, and each one fails if the specific
// guarantee it names is removed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'paperclip-issue-update.sh')
const ISSUE = '18093b6f-d7cc-4f36-a726-9f907c2bfb7f'
const KEY = 'run-jwt-value-that-must-never-be-printed'

// A stub Paperclip. `respond` receives the parsed request and returns
// {code, body}; `sabotage` lets a test destroy the socket to produce a real
// connection-level curl failure rather than a simulated one.
function stubApi({ respond, sabotageFirst = 0 } = {}) {
  const seen = []
  let destroyed = 0
  const server = createServer(async (req, res) => {
    if (destroyed < sabotageFirst) { destroyed++; seen.push({ destroyed: true }); res.socket.destroy(); return }
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    let body = null
    try { body = JSON.parse(raw) } catch { /* recorded as null */ }
    const request = { method: req.method, path: req.url, headers: req.headers, body, raw }
    seen.push(request)
    const { code = 200, body: out = { id: ISSUE, identifier: 'FOC-90', status: body?.status ?? 'backlog' } } =
      (respond ? respond(request) : {})
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(out === null ? '' : typeof out === 'string' ? out : JSON.stringify(out))
  })
  return {
    seen,
    listen: () => new Promise(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))),
    close: () => new Promise(r => server.close(r)),
  }
}

function run(args, { env = {}, stdin = '' } = {}) {
  return new Promise(resolve => {
    const child = execFile(SCRIPT, args, {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }))
    child.stdin.end(stdin)
  })
}

const baseEnv = (url, extra = {}) => ({
  PAPERCLIP_API_URL: url,
  PAPERCLIP_API_KEY: KEY,
  PAPERCLIP_TASK_ID: ISSUE,
  PAPERCLIP_RUN_ID: 'run-abc',
  ...extra,
})

test('a verified update sends the status and comment and reports success', async () => {
  const api = stubApi()
  const url = await api.listen()
  try {
    const r = await run(['--status', 'done'], { env: baseEnv(url), stdin: 'All criteria pass.' })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(api.seen.length, 1)
    assert.equal(api.seen[0].method, 'PATCH')
    assert.equal(api.seen[0].path, `/api/issues/${ISSUE}`)
    assert.deepEqual(api.seen[0].body, { status: 'done', comment: 'All criteria pass.' })
    assert.match(r.stdout, /FOC-90 updated/)
  } finally { await api.close() }
})

test('a multi-paragraph comment keeps its blank lines and list markers', async () => {
  const api = stubApi()
  const url = await api.listen()
  const report = '## Verdict\n\n- criterion one: pass\n- criterion two: fail\n\nEvidence in run.diff.'
  try {
    const r = await run(['--status', 'in_review'], { env: baseEnv(url), stdin: report })
    assert.equal(r.code, 0, r.stderr)
    // The smooshed-comment failure this guards against is a single-line body.
    assert.equal(api.seen[0].body.comment, report)
  } finally { await api.close() }
})

test('the run id and bearer token travel as headers', async () => {
  const api = stubApi()
  const url = await api.listen()
  try {
    await run(['--status', 'done'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(api.seen[0].headers.authorization, `Bearer ${KEY}`)
    assert.equal(api.seen[0].headers['x-paperclip-run-id'], 'run-abc')
  } finally { await api.close() }
})

test('the task id comes from the environment, so the call site needs no expansion', async () => {
  const api = stubApi()
  const url = await api.listen()
  try {
    const r = await run(['--status', 'done'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(api.seen[0].path, `/api/issues/${ISSUE}`)
  } finally { await api.close() }
})

test('an explicit --issue-id overrides the environment', async () => {
  const other = '00000000-1111-2222-3333-444444444444'
  const api = stubApi({ respond: () => ({ body: { id: other, identifier: 'FOC-91', status: 'done' } }) })
  const url = await api.listen()
  try {
    const r = await run(['--status', 'done', '--issue-id', other], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(api.seen[0].path, `/api/issues/${other}`)
  } finally { await api.close() }
})

test('a comment can be posted without touching the disposition', async () => {
  const api = stubApi()
  const url = await api.listen()
  try {
    const r = await run([], { env: baseEnv(url), stdin: 'progress note' })
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(api.seen[0].body, { comment: 'progress note' })
    assert.match(r.stdout, /status unchanged/)
  } finally { await api.close() }
})

test('a comment file is an alternative to stdin', async () => {
  const api = stubApi()
  const url = await api.listen()
  const dir = mkdtempSync(join(tmpdir(), 'pcu-'))
  const file = join(dir, 'report.md')
  writeFileSync(file, 'from a file\n\nwith a break')
  try {
    const r = await run(['--status', 'done', '--comment-file', file], { env: baseEnv(url) })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(api.seen[0].body.comment, 'from a file\n\nwith a break')
  } finally { await api.close() }
})

test('an invalid status is rejected before the control plane is contacted', async () => {
  const api = stubApi()
  const url = await api.listen()
  try {
    const r = await run(['--status', 'finished'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /invalid status/)
    assert.equal(api.seen.length, 0, 'a typo must not reach the API')
  } finally { await api.close() }
})

test('an HTTP error is reported as NOT applied', async () => {
  const api = stubApi({ respond: () => ({ code: 500, body: { message: 'boom' } }) })
  const url = await api.listen()
  try {
    const r = await run(['--status', 'done'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /FAILED/)
    assert.match(r.stderr, /NOT applied/)
  } finally { await api.close() }
})

test('an empty body with HTTP 200 is a failed write, not a success', async () => {
  // Paperclip's own rule: a real update always echoes the issue, so this is the
  // shape in which a lost write looks exactly like a successful one.
  const api = stubApi({ respond: () => ({ code: 200, body: null }) })
  const url = await api.listen()
  try {
    const r = await run(['--status', 'done'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /empty body/)
  } finally { await api.close() }
})

test('an unparseable body is a failed write', async () => {
  const api = stubApi({ respond: () => ({ code: 200, body: '<html>gateway</html>' }) })
  const url = await api.listen()
  try {
    const r = await run(['--status', 'done'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /unparseable/)
  } finally { await api.close() }
})

test('a response describing a different issue is a failed write', async () => {
  const api = stubApi({ respond: () => ({ body: { id: 'someone-elses-issue', status: 'done' } }) })
  const url = await api.listen()
  try {
    const r = await run(['--status', 'done'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /not '18093b6f/)
  } finally { await api.close() }
})

test('a status the server did not actually apply is a failed write', async () => {
  const api = stubApi({ respond: () => ({ body: { id: ISSUE, identifier: 'FOC-90', status: 'backlog' } }) })
  const url = await api.listen()
  try {
    const r = await run(['--status', 'done'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /asked for status 'done'/)
  } finally { await api.close() }
})

test('one connection-level failure is retried, and the retry is believed', async () => {
  const api = stubApi({ sabotageFirst: 1 })
  const url = await api.listen()
  try {
    const r = await run(['--status', 'done'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(api.seen.length, 2)
    assert.equal(api.seen[0].destroyed, true)
  } finally { await api.close() }
})

test('two consecutive connection failures end the write instead of hammering', async () => {
  const api = stubApi({ sabotageFirst: 5 })
  const url = await api.listen()
  try {
    const r = await run(['--status', 'done'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(r.code, 2)
    assert.equal(api.seen.length, 2, 'bounded retry: exactly two attempts')
    assert.match(r.stderr, /NOT applied/)
  } finally { await api.close() }
})

test('an HTTP error is never retried, because the write may already have applied', async () => {
  const api = stubApi({ respond: () => ({ code: 502, body: { message: 'bad gateway' } }) })
  const url = await api.listen()
  try {
    await run(['--status', 'done'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(api.seen.length, 1)
  } finally { await api.close() }
})

test('the API key is never printed, on success or on failure', async () => {
  const ok = stubApi()
  const okUrl = await ok.listen()
  const bad = stubApi({ respond: () => ({ code: 500, body: { message: 'boom' } }) })
  const badUrl = await bad.listen()
  try {
    for (const url of [okUrl, badUrl]) {
      const r = await run(['--status', 'done'], { env: baseEnv(url), stdin: 'ok' })
      assert.ok(!r.stdout.includes(KEY), 'stdout leaked the run token')
      assert.ok(!r.stderr.includes(KEY), 'stderr leaked the run token')
    }
  } finally { await ok.close(); await bad.close() }
})

test('a missing credential stops the script before any request', async () => {
  const api = stubApi()
  const url = await api.listen()
  try {
    const env = baseEnv(url)
    delete env.PAPERCLIP_API_KEY
    const r = await run(['--status', 'done'], { env, stdin: 'ok' })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /PAPERCLIP_API_KEY/)
    assert.equal(api.seen.length, 0)
  } finally { await api.close() }
})

test('no issue id anywhere is a usage error, not a guess', async () => {
  const api = stubApi()
  const url = await api.listen()
  try {
    const env = baseEnv(url)
    delete env.PAPERCLIP_TASK_ID
    const r = await run(['--status', 'done'], { env, stdin: 'ok' })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /no issue id/)
    assert.equal(api.seen.length, 0)
  } finally { await api.close() }
})

test('a call with neither a comment nor a status does nothing', async () => {
  const api = stubApi()
  const url = await api.listen()
  try {
    const r = await run([], { env: baseEnv(url), stdin: '' })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /nothing to do/)
    assert.equal(api.seen.length, 0)
  } finally { await api.close() }
})

test('an API url that already ends in /api is not doubled', async () => {
  const api = stubApi()
  const url = await api.listen()
  try {
    const r = await run(['--status', 'done'], { env: baseEnv(`${url}/api`), stdin: 'ok' })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(api.seen[0].path, `/api/issues/${ISSUE}`)
  } finally { await api.close() }
})

test('an unknown argument is refused rather than ignored', async () => {
  const api = stubApi()
  const url = await api.listen()
  try {
    const r = await run(['--stats', 'done'], { env: baseEnv(url), stdin: 'ok' })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /unknown argument/)
    assert.equal(api.seen.length, 0)
  } finally { await api.close() }
})
