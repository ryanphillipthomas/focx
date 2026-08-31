#!/usr/bin/env node
// deploy-verify — the deterministic release gate. See docs/roles/deploy.md.
//
// Replaces the per-deploy agent: everything the Deploy role verifies on the
// happy path is mechanical, so it is code — the deploy reached terminal state,
// the expected commit is the one serving, the public URL answers over valid
// TLS with this environment's content marker, custom domains are verified,
// and live Render configuration matches what the repo declares. Judgment
// stays with the role's charter (pipeline/prompts/deploy-agent.md), which
// governs any agent summoned for audits or failure triage; this tool never
// needed one to read API fields.
//
// The role's authority rule is enforced in code the same way it was in prose:
// this tool can move the system backward (roll production back to the deploy
// that was live before a failed one) and can propose forward motion (a draft
// promotion PR), but nothing here merges anything.
//
// Env in: EVENT (staging|production), EXPECTED_SHA, SERVICE_ID, PUBLIC_URL,
// CONTENT_MARKER, RENDER_API_KEY, GH_TOKEN (for gh), GITHUB_REPOSITORY.
// DEPLOY_VERIFY_FIXTURES=<dir> replaces Render API reads with
// <dir>/{deploys,service,custom-domains}.json and disables every side effect
// (rollback POST, gh calls) so the whole decision path tests offline.
//
// Out: pipeline/releases/<deploy-id>.json validated against its contract,
// raw API responses under pipeline/releases/evidence/<deploy-id>/, and
// `outcome=` on GITHUB_OUTPUT. Exit 0 = a valid record was written, whatever
// its outcome says; exit 1 = no record could be produced.

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const env = (name, required = true) => {
  const v = process.env[name];
  if (required && !v) { console.error(`deploy-verify: missing env ${name}`); process.exit(1); }
  return v;
};

const EVENT = env('EVENT');
const EXPECTED_SHA = env('EXPECTED_SHA');
const SERVICE_ID = env('SERVICE_ID');
const PUBLIC_URL = env('PUBLIC_URL');
const CONTENT_MARKER = env('CONTENT_MARKER');
const FIXTURES = process.env.DEPLOY_VERIFY_FIXTURES || '';
if (!FIXTURES) env('RENDER_API_KEY');

const config = JSON.parse(readFileSync(join(ROOT, 'pipeline/deploy.config.json'), 'utf8'));
const target = config.environments[EVENT];
if (!target || target.serviceId !== SERVICE_ID) {
  console.error(`deploy-verify: env "${EVENT}" / service ${SERVICE_ID} not declared in pipeline/deploy.config.json`);
  process.exit(1);
}

// ------------------------------------------------------------- primitives
function api(path) {
  if (FIXTURES) {
    const name = path.includes('custom-domains') ? 'custom-domains' : path.includes('deploys') ? 'deploys' : 'service';
    return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
  }
  const out = execFileSync('node', ['--input-type=module', '-e', `
    const r = await fetch('https://api.render.com/v1' + process.argv[1], {
      method: process.argv[2] || 'GET',
      headers: { authorization: 'Bearer ' + process.env.RENDER_API_KEY, 'content-type': 'application/json' },
      body: process.argv[3] || undefined,
    });
    const text = await r.text();
    if (!r.ok) { console.error('render api ' + r.status + ': ' + text.slice(0, 300)); process.exit(1); }
    console.log(text);
  `, path], { encoding: 'utf8' });
  return JSON.parse(out);
}

function apiPost(path, body) {
  if (FIXTURES) { console.log(`deploy-verify(fixtures): would POST ${path}`); return { fixture: true }; }
  const out = execFileSync('node', ['--input-type=module', '-e', `
    const r = await fetch('https://api.render.com/v1' + process.argv[1], {
      method: 'POST',
      headers: { authorization: 'Bearer ' + process.env.RENDER_API_KEY, 'content-type': 'application/json' },
      body: process.argv[2],
    });
    const text = await r.text();
    if (!r.ok) { console.error('render api ' + r.status + ': ' + text.slice(0, 300)); process.exit(1); }
    console.log(text || '{}');
  `, path, JSON.stringify(body)], { encoding: 'utf8' });
  return JSON.parse(out || '{}');
}

function gh(args) {
  if (FIXTURES) { console.log(`deploy-verify(fixtures): would run gh ${args.join(' ')}`); return ''; }
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

// One TLS-verified request; reports rather than throws so a dead site is a
// finding, not a crash. certOk=false covers refusals, wrong hostnames, and
// expiries alike — the record's tlsValid is "a browser would accept this".
function probe(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      const cert = res.socket.getPeerCertificate();
      let body = '';
      res.on('data', (c) => { if (body.length < 262144) body += c; });
      res.on('end', () => resolve({
        ok: true, status: res.statusCode, body,
        certSubject: cert && cert.subject ? `CN=${cert.subject.CN}` : '',
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------- verify
const TERMINAL = new Set(['live', 'build_failed', 'update_failed', 'canceled', 'deactivated']);
const unverified = [];

// 1. The deploy finished. Never read a site mid-build.
let deploy = null;
for (let i = 0; i < 20; i++) {
  const list = api(`/services/${SERVICE_ID}/deploys?limit=1`);
  deploy = (list[0] && (list[0].deploy || list[0])) || null;
  if (deploy && TERMINAL.has(deploy.status)) break;
  if (FIXTURES) break;
  await sleep(15000);
}
const deployStatus = deploy && TERMINAL.has(deploy.status)
  ? (deploy.status === 'deactivated' ? 'canceled' : deploy.status)
  : 'timed_out';
const servingSha = deploy?.commit?.id ?? 'unknown';
const deployId = deploy?.id ?? `unknown-${EXPECTED_SHA.slice(0, 7)}`;

// 2 + 3. The right commit, actually serving, on the real URL.
const health = await probe(PUBLIC_URL);
const markerFound = health.ok && health.body.includes(CONTENT_MARKER);
if (health.ok && !markerFound) unverified.push(`content marker not found in ${PUBLIC_URL} response`);
if (!health.ok) unverified.push(`health probe failed: ${health.error}`);

// 4. Custom domains attached and verified. certificateIssued is judged by the
// handshake itself: if a TLS connection to that hostname is accepted, the
// certificate exists and matches — the only sense of "issued" that matters.
const service = api(`/services/${SERVICE_ID}`);
const domainRows = api(`/services/${SERVICE_ID}/custom-domains?limit=20`);
const customDomains = [];
for (const row of Array.isArray(domainRows) ? domainRows : []) {
  const d = row.customDomain || row;
  if (!d?.name) continue;
  const tls = await probe(`https://${d.name}/`);
  customDomains.push({
    name: d.name,
    verified: d.verificationStatus === 'verified',
    certificateIssued: tls.ok === true,
  });
}

// 5. Live configuration vs what the repo declares. deploy.config.json carries
// the expected identity; render.yaml carries the build. Dashboard-only prose
// claims (docs/sources-of-truth.md) are deliberately out of scope here —
// reading prose against reality is the audit agent's job, not a field compare.
const infraDrift = [];
const declare = (setting, declared, actual) => {
  if (String(declared) !== String(actual)) infraDrift.push({ setting, declared: String(declared), actual: String(actual), authority: 'repo' });
};
if (target.serviceName) declare('name', target.serviceName, service.name);
declare('branch', target.branch, service.branch);
declare('autoDeploy', 'yes', service.autoDeploy);
const yaml = readFileSync(join(ROOT, 'render.yaml'), 'utf8');
const yamlValue = (key) => (yaml.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm')) || [])[1]?.trim();
declare('buildCommand', yamlValue('buildCommand'), service.serviceDetails?.buildCommand);
declare('publishPath', yamlValue('staticPublishPath'), service.serviceDetails?.publishPath);

// ---------------------------------------------------------------- outcome
const shaMatches = servingSha === EXPECTED_SHA;
const healthy = health.ok && health.status === 200 && markerFound;
const domainsClean = customDomains.every((d) => d.verified && d.certificateIssued);

let outcome;
if (deployStatus !== 'live' || !shaMatches || !healthy) outcome = 'failed';
else if (infraDrift.length || !domainsClean || unverified.length) outcome = 'degraded';
else outcome = 'live';
if (deployStatus === 'live' && !shaMatches) {
  // A live deploy of a different commit usually means a newer push already
  // superseded this one. Rolling back would fight that deploy, so this stays
  // a reported failure and never a rollback.
  unverified.push(`serving ${servingSha.slice(0, 12)} instead of expected ${EXPECTED_SHA.slice(0, 12)} — likely superseded; verify the newer deploy's own record`);
}

const record = {
  deployId,
  environment: EVENT,
  service: { id: SERVICE_ID, name: service.name ?? 'unknown', publicUrl: PUBLIC_URL },
  expectedSha: EXPECTED_SHA,
  deploy: { status: deployStatus, servingSha, finishedAt: deploy?.finishedAt ?? new Date().toISOString() },
  health: {
    httpStatus: health.ok ? health.status : 0,
    tlsValid: health.ok === true,
    certificateSubject: health.ok ? health.certSubject : '',
    checkedUrl: PUBLIC_URL,
    contentMarker: markerFound ? CONTENT_MARKER : '',
  },
  customDomains,
  infraDrift,
  outcome,
};
if (unverified.length) record.unverified = unverified;

// --------------------------------------- backward authority: rollback
// Production only, and only when the deploy itself failed — the previous live
// deploy is still what a human last approved, and restoring it is the one
// write this tool owns.
if (EVENT === 'production' && outcome === 'failed' && deployStatus !== 'live' && deployStatus !== 'timed_out') {
  const history = api(`/services/${SERVICE_ID}/deploys?limit=20`);
  const previous = (Array.isArray(history) ? history : [])
    .map((r) => r.deploy || r)
    .find((d) => d.status === 'live' && d.id !== deployId);
  if (!previous) {
    unverified.push('rollback skipped: no previous live deploy found');
    record.unverified = unverified;
  } else {
    try {
      apiPost(`/services/${SERVICE_ID}/rollback`, { deployId: previous.id });
      if (!FIXTURES) await sleep(30000);
      const after = await probe(PUBLIC_URL);
      const issueUrl = FIXTURES ? 'https://example.invalid/fixture' : gh(['issue', 'create',
        '--title', `production deploy ${deployId} failed — rolled back to ${previous.id}`,
        '--body', [
          `Deploy \`${deployId}\` of \`${EXPECTED_SHA}\` ended \`${deployStatus}\`; rolled back to \`${previous.id}\` (\`${previous.commit?.id ?? 'unknown'}\`).`,
          '',
          `Post-rollback probe of ${PUBLIC_URL}: HTTP ${after.ok ? after.status : `failed (${after.error})`}.`,
          '',
          `Release record: \`pipeline/releases/${deployId}.json\`. Revert the bad commit on main before the next deploy re-ships it.`,
        ].join('\n')]);
      record.rollback = {
        rolledBackTo: previous.id,
        issueUrl,
        healthyAfter: after.ok && after.status === 200 && after.body.includes(CONTENT_MARKER),
      };
    } catch (err) {
      unverified.push(`rollback attempt failed: ${String(err.message || err).slice(0, 200)}`);
      record.unverified = unverified;
    }
  }
}

// ------------------------------------ forward proposal: promotion PR
// Staging only, healthy only, and always a draft — a human merges it.
if (EVENT === 'staging' && outcome === 'live' && !FIXTURES) {
  const repo = process.env.GITHUB_REPOSITORY;
  try {
    const cmp = JSON.parse(gh(['api', `repos/${repo}/compare/main...staging`]));
    if (cmp.ahead_by > 0) {
      let prUrl = '';
      const existing = gh(['pr', 'list', '--base', 'main', '--head', 'staging', '--state', 'open', '--json', 'url', '--jq', '.[0].url // empty']);
      if (existing) {
        prUrl = existing;
        gh(['pr', 'comment', prUrl, '--body',
          `Staging verified \`live\` again at \`${servingSha.slice(0, 7)}\` (deploy \`${deployId}\`, ${cmp.ahead_by} commit(s) ahead of main). Record: \`pipeline/releases/${deployId}.json\`.`]);
      } else {
        prUrl = gh(['pr', 'create', '--draft', '--base', 'main', '--head', 'staging',
          '--title', 'Promote staging to production',
          '--body', [
            `Staging is verified \`live\` at \`${servingSha}\` — deploy \`${deployId}\`, HTTP ${health.status} over valid TLS at ${PUBLIC_URL}, content marker matched, ${customDomains.length} domain(s) verified, zero infrastructure drift.`,
            '',
            `Promotes ${cmp.ahead_by} commit(s): \`${cmp.base_commit?.sha?.slice(0, 7)}..${servingSha.slice(0, 7)}\`.`,
            '',
            `Release record: \`pipeline/releases/${deployId}.json\`. Bots never merge — this PR waits for a human.`,
          ].join('\n')]);
      }
      record.promotion = { prUrl, commitRange: `${cmp.base_commit?.sha?.slice(0, 7) ?? 'main'}..${servingSha.slice(0, 7)}`, merged: false };
    } else {
      console.log('deploy-verify: staging is not ahead of main — nothing to promote.');
    }
  } catch (err) {
    unverified.push(`promotion step failed: ${String(err.message || err).slice(0, 200)}`);
    record.unverified = unverified;
    if (record.outcome === 'live') record.outcome = 'degraded';
  }
}

// ------------------------------------------------------------------ record
const outDir = join(ROOT, 'pipeline/releases');
const evidenceDir = join(outDir, 'evidence', deployId);
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(join(evidenceDir, 'deploy.json'), JSON.stringify(deploy, null, 2) + '\n');
writeFileSync(join(evidenceDir, 'service.json'), JSON.stringify(service, null, 2) + '\n');
writeFileSync(join(evidenceDir, 'custom-domains.json'), JSON.stringify(domainRows, null, 2) + '\n');
writeFileSync(join(evidenceDir, 'health.json'), JSON.stringify({ url: PUBLIC_URL, status: health.ok ? health.status : null, error: health.ok ? null : health.error, certSubject: health.ok ? health.certSubject : null, markerFound }, null, 2) + '\n');
writeFileSync(join(outDir, `${deployId}.json`), JSON.stringify(record, null, 2) + '\n');

execFileSync('node', [join(ROOT, 'tools/contracts/validate.mjs')], { stdio: 'inherit' });

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${record.outcome}\nrecord=pipeline/releases/${deployId}.json\n`);
}
console.log(`deploy-verify: ${EVENT} ${deployId} → ${record.outcome} (serving ${servingSha.slice(0, 7)}, expected ${EXPECTED_SHA.slice(0, 7)})`);
