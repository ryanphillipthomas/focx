import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConsole, parseObjects, tokenLeaves, tokensCSS, start } from './index.mjs';

const digest = 'a'.repeat(64);
const changes = ['POST', 'PATCH', 'PATCH', 'WRITE_FILE'].map((method, i) => ({ method, path: `/operation/${i}`, body: { text: 'nested } { " quote\n{\n brace', nested: [{ escaped: '\\"' }] } }));
const first = { digest, changes, later: [], secretInputs: [], window: 'paused' };
const second = { digest, changes: changes.slice(0, 3), secretInputs: [], preflight: { catalog: [] } };
const stream = `${JSON.stringify(first, null, 2)}\n${JSON.stringify(second, null, 2)}`;
const plan = app => app.dispatch('POST', '/api/plan', { name: 'console-demo' });
const apply = (app, value = digest) => app.dispatch('POST', '/api/apply', { name: 'console-demo', digest: value });

test('tokens endpoint emits both namespaces with verbatim values and normalized token paths', async () => {
  const sources = await Promise.all(['focx', 'focx-bot'].map(async namespace =>
    JSON.parse(await readFile(new URL(`../../design/tokens/${namespace}/tokens.json`, import.meta.url), 'utf8'))));
  const response = await createConsole().dispatch('GET', '/api/tokens.css');
  assert.equal(response.status, 200);
  assert.equal(response.type, 'text/css');
  assert.equal(response.body.match(/:root \{/g).length, 1);
  const declarations = response.body.split('\n').filter(line => line.startsWith('  --'));
  assert.equal(declarations.length, 169);
  assert.equal(new Set(declarations.map(line => line.split(':')[0])).size, 169);
  assert.equal(tokenLeaves(sources[0]).length, 36);
  assert.equal(tokenLeaves(sources[1]).length, 133);
  assert.ok(declarations.slice(0, 36).every(line => line.startsWith('  --focx-') && !line.startsWith('  --focx-bot-')));
  assert.ok(declarations.slice(36).every(line => line.startsWith('  --focx-bot-')));
  const check = (value, path = []) => {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'value')) {
      const name = '--' + path.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      assert.ok(declarations.includes(`  ${name}: ${value.value};`));
      return;
    }
    for (const [key, child] of Object.entries(value)) if (!key.startsWith('_')) check(child, [...path, key]);
  };
  sources.forEach(source => check(source));
  for (const [name, value] of [
    ['focx-color-action-fill', sources[0].focx.color['action-fill'].value],
    ['focx-text-body', sources[0].focx.text.body.value],
    ['focx-radius-card', sources[0].focx.radius.card.value],
    ['focx-bot-color-bg-app', sources[1]['focx-bot'].color['bg-app'].value],
    ['focx-bot-space-md', sources[1]['focx-bot'].space.md.value],
    ['focx-bot-elevation-card', sources[1]['focx-bot'].elevation.card.value],
    ['focx-bot-style-display-page-title', sources[1]['focx-bot'].style['Display/Page Title'].value]
  ]) assert.ok(declarations.includes(`  --${name}: ${value};`));
  assert.match(sources[1]['focx-bot'].color['bg-app'].figmaName, /\//);
  assert.equal(typeof sources[1]['focx-bot'].motion._note, 'string');
  assert.equal(tokenLeaves(sources[1]['focx-bot'].motion).length, 3);
  assert.ok(!response.body.includes('_note'));
});

test('metadata is skipped even when it contains leaf-shaped objects', () => {
  const leaf = { value: 'published', figmaName: 'ignored/name' };
  const fixture = { _root: { value: 'hidden' }, Focx: { _note: { nested: { value: 'hidden' } },
    ' /Style//Name! ': leaf } };
  assert.deepEqual(tokenLeaves(fixture), [leaf]);
  assert.equal(tokensCSS(fixture), ':root {\n  --focx-style-name: published;\n}\n');
});

test('normalized property collisions refuse generation', () => {
  for (const fixture of [
    { focx: { 'A/B': { value: 1 }, 'a b': { value: 2 } } },
    { focx: { a: { b: { value: 1 } }, 'a-b': { value: 2 } } },
    { focx: { bot: { value: 1 } }, 'focx-bot': { value: 2 } }
  ]) assert.throws(() => tokensCSS(fixture), /Duplicate token property: --focx-/);
});

function identitySetup({ fail = false, token = 'fake-board-secret', name = 'Developer', extraAgents = [] } = {}) {
  const calls = [];
  const app = createConsole({ companyId: 'company-1', user: 'test-user',
    run: async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: token };
    }, fetchAPI: async (url, options) => {
      calls.push({ url, options });
      if (fail) throw new Error(token);
      return { ok: true, json: async () => url.endsWith('/agents')
        ? [{ id: 'dev-id', urlKey: 'implementation-engineer', name, status: 'paused', adapterType: 'codex_local', adapterConfig: { model: 'model-from-api', env: { SECRET: token } }, credential: token }, ...extraAgents]
        : { name: 'Company from API', issuePrefix: 'FOCAAA', credential: token } };
    }
  });
  return { app, calls };
}

test('developer identity is whitelisted and company prefix FOCAAA is preserved', async () => {
  const { app, calls } = identitySetup();
  const response = await app.dispatch('GET', '/api/agents');
  // One row per declared pilot role; roles with no live match are reported
  // unresolved rather than omitted, so a newly added agent is visible as missing.
  const engineer = response.body.agents.find(a => a.roleKey === 'implementation-engineer');
  const { procedures, provisioned, claudePlugins, codexPlugins, ...identity } = engineer;
  assert.deepEqual(identity, { roleKey: 'implementation-engineer', id: 'dev-id', name: 'Developer', status: 'paused', adapterType: 'codex_local', model: 'model-from-api', companyName: 'Company from API', issuePrefix: 'FOCAAA' });
  // Procedures come from the manifest; plugin grants from the provisioning
  // contract, which is why the Codex list is non-empty for this role.
  assert.deepEqual(procedures, ['focx-implement-task']);
  assert.equal(provisioned, true);
  assert(codexPlugins.length > 0 && claudePlugins.length === 0);
  assert(response.body.agents.length >= 1);
  assert.deepEqual(calls[0].args, ['find-generic-password', '-a', 'test-user', '-s', 'paperclip-board-token', '-w']);
  for (const call of calls.slice(1)) {
    assert.match(call.url, /^http:\/\/127\.0\.0\.1:3100\/api\/companies\/company-1/);
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.headers.Authorization, 'Bearer fake-board-secret');
    assert.equal(call.options.redirect, 'error');
    assert.ok(call.options.signal);
  }
});

// A role the manifest declares but the provisioning contract does not carry has
// UNKNOWN grants, not zero. Rendering 0 there would read as "this agent has no
// plugins" when the truth is "this agent is not provisioned by the contract".
test('a manifest-only role reports that it is not in the contract, never zero grants', async () => {
  const { app } = identitySetup({ extraAgents: [{ id: 'steward-id', urlKey: 'architecture-documentation-steward',
    name: 'Steward', status: 'paused', adapterType: 'claude_local', adapterConfig: { model: 'claude-opus-5' } }] });
  const { body } = await app.dispatch('GET', '/api/agents');
  const steward = body.agents.find(a => a.roleKey === 'architecture-documentation-steward');
  assert.equal(steward.unresolved, undefined);
  assert.equal(steward.provisioned, false);
  assert.equal(steward.claudePlugins, undefined);
  assert.equal(steward.codexPlugins, undefined);
  assert.deepEqual(steward.procedures, ['focx-reconcile-truth']);
});

test('unreachable API, absent token and failed keychain produce unavailable, without invented identity', async () => {
  for (const app of [identitySetup({ fail: true }).app, identitySetup({ token: '' }).app,
    createConsole({ run: async () => { throw new Error('keychain failure'); } })]) {
    const { body } = await app.dispatch('GET', '/api/agents');
    assert.equal(body.unavailable, true);
    assert.deepEqual(Object.keys(body).sort(), ['reason', 'unavailable']);
  }
});

const retainedCompanyId = '5f772ef2-25ce-466f-9392-027be5055470';
const declaredDeveloperId = '34f730a9-0fa0-426b-a8b6-5cb7c163311b';
const liveDeveloper = { id: declaredDeveloperId, urlKey: 'implementation-engineer-on-demand',
  role: 'engineer', name: 'Developer', status: 'paused', adapterType: 'codex_local',
  adapterConfig: { model: 'model-from-api' } };

function ticketSetup({ fail = false, issues, token = 'fake-board-secret' } = {}) {
  const rows = issues ?? [
    { identifier: 'FOC-2', title: 'Older', status: 'done', priority: 'low',
      assigneeAgentId: 'dev-id', updatedAt: '2026-09-01T00:00:00.000Z', description: 'x'.repeat(1200), companyId: 'c', labels: [] },
    { identifier: 'FOC-9', title: 'Newer', status: 'blocked', priority: 'high',
      assigneeAgentId: 'unknown-agent', updatedAt: '2026-09-05T00:00:00.000Z', description: 'y', companyId: 'c', labels: [] }
  ];
  return createConsole({ companyId: 'company-1', user: 'test-user',
    run: async () => ({ stdout: token }),
    fetchAPI: async url => {
      if (fail) throw new Error(token);
      if (url.endsWith('/issues')) return { ok: true, json: async () => rows };
      if (url.endsWith('/agents')) return { ok: true, json: async () => [{ id: 'dev-id', name: 'Developer', credential: token }] };
      return { ok: true, json: async () => ({ name: 'Company', issuePrefix: 'FOCAAA' }) };
    }
  });
}

test('tickets are trimmed to the rendered fields, newest first, with assignees resolved to names', async () => {
  const { body } = await ticketSetup().dispatch('GET', '/api/tickets');
  assert.equal(body.total, 2);
  assert.deepEqual(body.counts, { done: 1, blocked: 1 });
  // Most recently updated first.
  assert.deepEqual(body.tickets.map(t => t.identifier), ['FOC-9', 'FOC-2']);
  // Only what the view renders crosses to the browser: the control plane returns
  // ~60 fields per issue, and the descriptions alone are 1200 chars each.
  assert.deepEqual(Object.keys(body.tickets[0]).sort(),
    ['assignee', 'identifier', 'priority', 'status', 'title', 'updatedAt']);
  assert.equal(body.tickets[1].assignee, 'Developer');
  // An assignee the agents call does not know stays null rather than leaking a uuid.
  assert.equal(body.tickets[0].assignee, null);
  assert(!JSON.stringify(body).includes('description'));
});

test('tickets fail closed: no credential, unreachable control plane, and an empty list', async () => {
  assert.equal((await ticketSetup({ fail: true }).dispatch('GET', '/api/tickets')).body.unavailable, true);
  const empty = await ticketSetup({ issues: [] }).dispatch('GET', '/api/tickets');
  assert.equal(empty.body.unavailable, true);
  assert.match(empty.body.reason, /No tickets/);
  // A malformed row is dropped rather than rendered half-empty.
  const { body } = await ticketSetup({ issues: [{ title: 'no identifier' }, { identifier: 'FOC-1', title: 'ok', status: 'done', updatedAt: '2026-09-01T00:00:00.000Z' }] })
    .dispatch('GET', '/api/tickets');
  assert.equal(body.total, 1);
  assert.equal(body.tickets[0].identifier, 'FOC-1');
});

function resolutionSetup({ companyId = retainedCompanyId, agents = [liveDeveloper],
  failure, token = 'fake-board-secret' } = {}) {
  return createConsole({ companyId, run: async () => {
    if (failure === 'keychain') throw new Error(token);
    return { stdout: failure === 'empty-token' ? '' : token };
  }, fetchAPI: async url => {
    if (failure === 'unreachable') throw new Error(token);
    return { ok: failure !== 'refused', json: async () => {
      assert.notEqual(failure, 'refused', 'never read a refused upstream body');
      return url.endsWith('/agents') ? agents : { id: companyId, name: 'Company', issuePrefix: 'FOCAAA' };
    } };
  } });
}

test('retained company resolves Developer by declared id with live on-demand slug and engineer role', async () => {
  const { body } = await resolutionSetup().dispatch('GET', '/api/agents');
  const { procedures, provisioned, claudePlugins, codexPlugins, ...identity } = body.agents.find(a => a.roleKey === 'implementation-engineer');
  assert.deepEqual(identity,
    { roleKey: 'implementation-engineer', id: declaredDeveloperId, name: 'Developer', status: 'paused',
      adapterType: 'codex_local', model: 'model-from-api', companyName: 'Company', issuePrefix: 'FOCAAA' });
  assert.deepEqual(procedures, ['focx-implement-task']);
  assert.equal(provisioned, true);
});

test('different company resolves Developer by provisioned urlKey', async () => {
  const { body } = await resolutionSetup({ companyId: 'provisioned-company',
    agents: [{ ...liveDeveloper, id: 'provisioned-id', urlKey: 'implementation-engineer' }] }).dispatch('GET', '/api/agents');
  assert.equal(body.agents.find(a => a.roleKey === 'implementation-engineer').id, 'provisioned-id');
});

test('five engineer roles cannot substitute for a declared id or provisioned slug', async () => {
  const agents = Array.from({ length: 5 }, (_, i) => ({ ...liveDeveloper, id: `other-${i}`, urlKey: `engineer-${i}` }));
  for (const companyId of [retainedCompanyId, 'provisioned-company']) {
    const { body } = await resolutionSetup({ companyId, agents }).dispatch('GET', '/api/agents');
    assert.equal(body.unavailable, true);
  }
});

test('retained identity never falls back to slug and ambiguous matches are unavailable', async () => {
  for (const options of [
    { agents: [{ ...liveDeveloper, id: 'wrong-id', urlKey: 'implementation-engineer' }] },
    { agents: [liveDeveloper, liveDeveloper] },
    { companyId: 'provisioned-company', agents: [liveDeveloper] },
    { companyId: 'provisioned-company', agents: Array(2).fill({ ...liveDeveloper, urlKey: 'implementation-engineer' }) }
  ]) assert.equal((await resolutionSetup(options).dispatch('GET', '/api/agents')).body.unavailable, true);
});

test('credential, control-plane and resolution failures have distinct non-sensitive reasons', async () => {
  const reasons = {};
  for (const failure of ['keychain', 'empty-token', 'unreachable', 'refused', 'unresolved']) {
    const { body } = await resolutionSetup({ failure, agents: [] }).dispatch('GET', '/api/agents');
    assert.equal(body.unavailable, true);
    assert.deepEqual(Object.keys(body).sort(), ['reason', 'unavailable']);
    assert.ok(!JSON.stringify(body).includes('fake-board-secret'));
    reasons[failure] = body.reason;
  }
  assert.equal(reasons.keychain, reasons['empty-token']);
  assert.equal(reasons.unreachable, reasons.refused);
  assert.equal(new Set([reasons.keychain, reasons.unreachable, reasons.unresolved]).size, 3);
  assert.match(reasons.keychain, /No board credential available/);
  assert.match(reasons.unreachable, /Control plane unreachable or refused/);
  assert.match(reasons.unresolved, /Agents could not be resolved in the configured company/);
});

test('balanced stream parsing preserves nested and escaped content and rejects malformed tails', () => {
  assert.deepEqual(parseObjects(stream), [first, second]);
  assert.deepEqual(parseObjects(JSON.stringify(first) + JSON.stringify(second)), [first, second]);
  for (const value of ['', '[]', stream + 'garbage', stream + '{', '{"bad":}', stream + '"']) assert.throws(() => parseObjects(value));
});

test('plan retains fuller preview without reconstructing operations and reports the observed list difference', async () => {
  const app = createConsole({ run: async () => ({ stdout: stream }) });
  const { status, body } = await plan(app);
  assert.equal(status, 200);
  assert.deepEqual(body.preview, first);
  assert.deepEqual(body.preflight, second.preflight);
  assert.equal(body.digest, digest);
  assert.equal(body.digestCoversUnlistedOperations, true);
  assert.equal(body.reason, 'The emitted preview lists 4 operations; the returned result lists 3. The lists first differ at operation 4.');
});

test('agreeing operation lists omit the coverage warning regardless of object key order', async () => {
  const returned = { ...second, changes: changes.map(({ method, path, body }) => ({ body, path, method })) };
  const app = createConsole({ run: async () => ({ stdout: JSON.stringify(first) + JSON.stringify(returned) }) });
  const { status, body } = await plan(app);
  assert.equal(status, 200);
  assert.equal(body.digestCoversUnlistedOperations, false);
  assert.equal(Object.hasOwn(body, 'reason'), false);
});

test('equal-length lists with different operation bodies still report a discrepancy', async () => {
  const returned = structuredClone({ ...second, changes });
  returned.changes[0].body.text = 'different';
  const app = createConsole({ run: async () => ({ stdout: JSON.stringify(first) + JSON.stringify(returned) }) });
  const { status, body } = await plan(app);
  assert.equal(status, 200);
  assert.equal(body.digestCoversUnlistedOperations, true);
  assert.equal(body.reason, 'The emitted preview lists 4 operations; the returned result lists 4. The lists first differ at operation 1.');
});

test('single object, conflicting digest, missing digest or preflight are refused', async () => {
  for (const stdout of [JSON.stringify(first), JSON.stringify(first) + JSON.stringify({ ...second, digest: 'b'.repeat(64) }),
    JSON.stringify(first) + '{}', JSON.stringify(first) + JSON.stringify({ digest })]) {
    const app = createConsole({ run: async () => ({ stdout }) });
    assert.equal((await plan(app)).status, 400);
    assert.equal((await apply(app)).status, 400);
  }
});

test('offline plan, human digest confirmation, apply and returned readback result use fake argv only', async () => {
  const calls = [];
  const result = { digest, complete: false, state: { phase: 'awaiting-secret-entry' } };
  const app = createConsole({ run: async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: args.includes('--apply') ? `${stream}\n${JSON.stringify({ write: { method: 'UNLOCK' } })}\n${JSON.stringify(result)}` : stream };
  } });
  assert.equal((await plan(app)).status, 200);
  assert.deepEqual((await apply(app)).body, { result });
  assert.equal((await apply(app)).status, 400, 'digest is consumed');
  for (const call of calls) {
    assert.equal(call.file, process.execPath);
    assert.ok(Array.isArray(call.args));
    assert.ok(call.args.includes('--fake'));
    assert.ok(!call.args.includes('--base-url'));
    assert.equal(call.options.shell, undefined);
    assert.equal(call.options.timeout, 30000);
    assert.ok(call.options.maxBuffer > 0);
    assert.deepEqual(Object.keys(call.options.env), ['PATH']);
  }
  assert.deepEqual(calls[0].args.slice(1), ['fresh', '--fake', '--new-company-name', 'console-demo']);
  assert.deepEqual(calls[1].args.slice(-3), ['--apply', '--approved-digest', digest]);
});

test('live targets, extra arguments and unsafe names are refused before subprocess execution', async () => {
  let calls = 0;
  const app = createConsole({ run: async () => { calls++; return { stdout: stream }; } });
  for (const body of [null, [], { name: 'demo', '--base-url': 'http://live' }, { name: 'demo', baseUrl: 'http://live' },
    { name: 'demo', args: ['--apply'] }, { name: 'demo', fake: false },
    ...['demo;whoami', 'demo company', '-demo', 'demo\n', '$(id)', 'a'.repeat(65)].map(name => ({ name }))]) {
    for (const path of ['/api/plan', '/api/apply']) assert.equal((await app.dispatch('POST', path, body)).status, 400);
  }
  assert.equal(calls, 0);
});

test('unplanned, mismatched, superseded and different-process digests are refused', async () => {
  const app = createConsole({ run: async () => ({ stdout: stream }) });
  assert.equal((await apply(app)).status, 400);
  await plan(app);
  assert.equal((await apply(app, 'b'.repeat(64))).status, 400);
  assert.equal((await apply(app)).status, 400);
  await plan(app);
  assert.equal((await app.dispatch('POST', '/api/apply', { name: 'other', digest })).status, 400);
  await plan(app);
  await app.dispatch('POST', '/api/plan', { name: 'bad name' });
  assert.equal((await apply(app)).status, 400);
  await plan(app);
  assert.equal((await apply(createConsole({ run: async () => ({ stdout: stream }) }))).status, 400);
});

test('subprocess timeout errors are withheld and single subprocess lock covers identity and bot', async () => {
  let release, calls = 0;
  const app = createConsole({ run: async (_file, _args, options) => {
    calls++; assert.equal(options.timeout, 30000);
    return new Promise(resolve => { release = resolve; });
  } });
  const active = plan(app);
  assert.equal((await plan(app)).status, 400);
  assert.equal((await apply(app)).status, 400);
  assert.equal((await app.dispatch('GET', '/api/agents')).body.unavailable, true);
  assert.equal(calls, 1);
  release({ stdout: stream }); await active;
  const failing = createConsole({ run: async () => { throw Object.assign(new Error('sensitive stderr'), { killed: true }); } });
  assert.equal((await plan(failing)).status, 400);
  assert.equal((await apply(failing)).status, 400);
});

test('token never occurs in responses or log lines, even in fields or upstream exceptions', async () => {
  const token = 'fake-board-secret';
  const logs = [], originals = [console.log, console.error, console.warn];
  console.log = console.error = console.warn = (...args) => logs.push(args.join(' '));
  try {
    const responses = [];
    for (const options of [{}, { fail: true }, { name: token }]) {
      const { app } = identitySetup(options);
      responses.push(await app.dispatch('GET', '/api/agents'));
      responses.push(await plan(app));
      responses.push(await apply(app));
    }
    assert.ok(!JSON.stringify(responses).includes(token));
    assert.ok(!logs.join('\n').includes(token));
  } finally { [console.log, console.error, console.warn] = originals; }
});

test('binds only IPv4 loopback and transport blocks foreign hosts/origins without a socket', async () => {
  let binding;
  start({ port: 4174, listen: () => ({ listen: (...args) => { binding = args; } }) });
  assert.deepEqual(binding, [4174, '127.0.0.1']);
  for (const port of [0, NaN, 65536]) assert.throws(() => start({ port }));
  const app = createConsole();
  for (const headers of [{ host: 'evil.example:4174' }, { host: '127.0.0.1:4174', origin: 'http://evil.example' }]) {
    let status, body;
    await app.handler({ headers, socket: { localPort: 4174 } }, { writeHead: s => { status = s; }, end: b => { body = b; } });
    assert.equal(status, 403); assert.match(body, /same-origin/);
  }
  assert.equal((await app.dispatch('GET', '/../package.json')).status, 404);
  assert.equal((await app.dispatch('GET', '/')).type, 'text/html');
});
