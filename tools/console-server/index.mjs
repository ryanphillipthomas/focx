import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);
const timeout = 30000;
const unavailable = reason => ({ unavailable: true, reason });
const noCredential = 'No board credential available.';
const controlPlaneUnavailable = 'Control plane unreachable or refused.';
const unresolvedDeveloper = 'Developer could not be resolved in the configured company.';
const invalid = () => { throw new Error('Request refused'); };

// Strings, escaped quotes and nested objects are tracked independently of whitespace.
export function parseObjects(source) {
  const objects = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (start < 0) {
      if (/\s/.test(c)) continue;
      if (c !== '{') invalid();
      start = i;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      objects.push(JSON.parse(source.slice(start, i + 1)));
      start = -1;
    }
  }
  if (start !== -1 || !objects.length) invalid();
  return objects;
}

function tokenEntries(value, path = []) {
  if (!value || typeof value !== 'object') return [];
  if (Object.hasOwn(value, 'value')) return [{ path, token: value }];
  return Object.entries(value).filter(([key]) => !key.startsWith('_'))
    .flatMap(([key, child]) => tokenEntries(child, [...path, key]));
}

export function tokenLeaves(value) {
  return tokenEntries(value).map(({ token }) => token);
}

export function tokensCSS(tokens) {
  const names = new Set();
  const declarations = tokenEntries(tokens).map(({ path, token }) => {
    const name = `--${path.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
    if (names.has(name)) throw new Error(`Duplicate token property: ${name}`);
    names.add(name);
    return `  ${name}: ${token.value};`;
  });
  return `:root {\n${declarations.join('\n')}\n}\n`;
}

function validate(body, apply) {
  if (!body || Array.isArray(body) || typeof body !== 'object') invalid();
  const keys = apply ? ['name', 'digest'] : ['name'];
  if (Object.keys(body).some(key => !keys.includes(key))) invalid();
  if (typeof body.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(body.name)) invalid();
  if (apply && (typeof body.digest !== 'string' || !/^[a-f0-9]{64}$/.test(body.digest))) invalid();
}

export function createConsole({ run = execute, fetchAPI = fetch, read = readFile,
  companyId, user = process.env.USER } = {}) {
  let busy = false, pending = null;
  const credentials = new Set();
  const clean = value => {
    let serialized = JSON.stringify(value);
    for (const token of credentials) {
      serialized = serialized.split(JSON.stringify(token).slice(1, -1)).join('[withheld]');
    }
    return JSON.parse(serialized);
  };
  async function exclusive(work) {
    if (busy) invalid();
    busy = true;
    try { return await work(); } finally { busy = false; }
  }
  async function developer() {
    try {
      return await exclusive(async () => {
        let token;
        try {
          const { stdout } = await run('security', ['find-generic-password', '-a', user || '', '-s', 'paperclip-board-token', '-w'],
            { timeout, maxBuffer: 65536, encoding: 'utf8' });
          token = stdout.trim();
        } catch { return unavailable(noCredential); }
        if (!token) return unavailable(noCredential);
        credentials.add(token);
        const manifest = JSON.parse(await read(resolve(root, '.focx/agents.json'), 'utf8'));
        const id = companyId ?? manifest.companyId;
        if (typeof id !== 'string' || !/^[A-Za-z0-9-]+$/.test(id)) return unavailable(unresolvedDeveloper);
        const get = async path => {
          const response = await fetchAPI(`http://127.0.0.1:3100${path}`, {
            method: 'GET', headers: { Authorization: `Bearer ${token}` },
            redirect: 'error', signal: AbortSignal.timeout(5000)
          });
          if (!response.ok) throw new Error('Unavailable');
          return response.json();
        };
        let company, rows;
        try {
          company = await get(`/api/companies/${id}`);
          rows = await get(`/api/companies/${id}/agents`);
        } catch { return unavailable(controlPlaneUnavailable); }
        const agents = Array.isArray(rows) ? rows : rows?.agents;
        if (!Array.isArray(agents)) return unavailable(unresolvedDeveloper);
        let matches;
        if (id === manifest.companyId) {
          const declared = manifest.agents?.filter(a => a.roleKey === 'implementation-engineer');
          if (declared?.length !== 1 || typeof declared[0].id !== 'string' || !declared[0].id) return unavailable(unresolvedDeveloper);
          matches = agents.filter(a => a?.id === declared[0].id);
        } else {
          matches = agents.filter(a => a?.urlKey === 'implementation-engineer');
        }
        if (matches.length !== 1) return unavailable(unresolvedDeveloper);
        const agent = matches[0];
        const fields = { id: agent.id, name: agent.name, status: agent.status, adapterType: agent.adapterType,
          model: agent.adapterConfig?.model, companyName: company.name, issuePrefix: company.issuePrefix };
        if (Object.values(fields).some(v => typeof v !== 'string' || !v)) return unavailable(unresolvedDeveloper);
        return clean(fields);
      });
    } catch { return unavailable(unresolvedDeveloper); }
  }
  async function operation(body, apply) {
    return exclusive(async () => {
      // A failed attempt also invalidates the previously reviewed plan.
      const previous = pending;
      pending = null;
      validate(body, apply);
      if (apply && (!previous || previous.digest !== body.digest || previous.name !== body.name)) invalid();
      const args = [resolve(root, 'packages/focx-bot/src/index.mjs'), 'fresh', '--fake', '--new-company-name', body.name];
      if (apply) args.push('--apply', '--approved-digest', body.digest);
      // The child never inherits board/API credentials from the console environment.
      const { stdout } = await run(process.execPath, args, { cwd: root, timeout, maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
      const objects = parseObjects(stdout);
      if (apply) {
        const result = objects.at(-1);
        if (result.digest !== body.digest || typeof result.complete !== 'boolean' || !result.state) invalid();
        return clean({ result });
      }
      if (objects.length < 2 || objects.some(o => typeof o.digest !== 'string' || !/^[a-f0-9]{64}$/.test(o.digest) || o.digest !== objects[0].digest)) invalid();
      if (!Array.isArray(objects[0].changes) || !objects[1].preflight) invalid();
      const response = { preview: objects[0], preflight: objects[1].preflight, digest: objects[0].digest,
        digestCoversUnlistedOperations: true,
        reason: 'The digest binds at least one operation this list does not show: a write to instance-local state.' };
      pending = { name: body.name, digest: response.digest };
      return clean(response);
    });
  }
  // Transport-independent routing permits offline tests without opening a socket.
  async function dispatch(method, path, body) {
    try {
      if (method === 'GET' && path === '/api/tokens.css') {
        const namespaces = ['focx', 'focx-bot'];
        const tokens = await Promise.all(namespaces.map(async namespace => {
          const source = JSON.parse(await read(resolve(root, `design/tokens/${namespace}/tokens.json`), 'utf8'));
          return [namespace, source[namespace]];
        }));
        return { status: 200, type: 'text/css', body: tokensCSS(Object.fromEntries(tokens)) };
      }
      if (method === 'GET' && path === '/api/developer') return { status: 200, body: await developer() };
      if (method === 'POST' && ['/api/plan', '/api/apply'].includes(path)) return { status: 200, body: await operation(body, path === '/api/apply') };
      const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/main.js': ['main.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
      if (method === 'GET' && files[path]) {
        const [file, type] = files[path];
        return { status: 200, type, body: await read(resolve(root, 'apps/console', file), 'utf8') };
      }
      return { status: 404, body: { error: 'Not found' } };
    } catch { return { status: 400, body: { error: 'Request refused or operation failed. Plan again before applying.' } }; }
  }
  async function handler(req, res) {
    const send = result => {
      res.writeHead(result.status, { 'Content-Type': `${result.type ?? 'application/json'}; charset=utf-8`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(result.type ? result.body : JSON.stringify(result.body));
    };
    const expected = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== expected || (req.headers.origin && req.headers.origin !== `http://${expected}`)) {
      send({ status: 403, body: { error: 'Local same-origin requests only' } }); return;
    }
    try {
      let body;
      if (req.method === 'POST') {
        if (req.headers['content-type'] !== 'application/json') invalid();
        let bytes = 0, chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) invalid(); chunks.push(chunk); }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      send(await dispatch(req.method, req.url, body));
    } catch { send({ status: 400, body: { error: 'Request refused' } }); }
  }
  return { dispatch, handler };
}

export function start({ port = Number(process.env.PORT ?? 4174), listen = createServer } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalid();
  const server = listen(createConsole().handler);
  server.requestTimeout = timeout;
  server.listen(port, '127.0.0.1');
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) start();
