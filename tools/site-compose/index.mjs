#!/usr/bin/env node
// site-compose — assembles the focx.ai umbrella site into dist/.
//
// Once sources are resolved, this script only COPIES files into the URL layout
// from site-map.json — it never rewrites HTML/CSS/JS. Local mounts are
// repo-relative directories. Remote mounts are fetched (GitHub tarball) at
// build time, then copied the same way.
//
//   apps/site/*  →  dist/                 (umbrella root)
//   <mounts>     →  dist/<path>/          (each sub-app at its focx.ai path)

import {
  cpSync,
  rmSync,
  mkdirSync,
  readFileSync,
  existsSync,
  mkdtempSync,
  createWriteStream,
  readdirSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const map = JSON.parse(readFileSync(new URL('./site-map.json', import.meta.url), 'utf8'));

async function fetchRemoteMount(mount) {
  const { repo, ref = 'main', root = '.' } = mount;
  if (!repo || typeof repo !== 'string' || !repo.includes('/')) {
    throw new Error(`site-compose: remote mount needs "repo" as owner/name, got ${JSON.stringify(mount)}`);
  }
  const url = `https://codeload.github.com/${repo}/tar.gz/${encodeURIComponent(ref)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`site-compose: failed to fetch ${url} (${res.status} ${res.statusText})`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'site-compose-'));
  const tgz = join(dir, 'src.tgz');
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tgz));
  execFileSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'pipe' });
  const entries = readdirSync(dir).filter((n) => n !== 'src.tgz');
  if (entries.length !== 1) {
    throw new Error(`site-compose: unexpected tarball layout in ${dir}: ${entries.join(', ')}`);
  }
  const extracted = root === '.' ? join(dir, entries[0]) : join(dir, entries[0], root);
  if (!existsSync(extracted)) {
    throw new Error(`site-compose: remote root "${root}" missing in ${repo}@${ref}`);
  }
  return extracted;
}

function copyTree(from, to, exclude = []) {
  const excluded = new Set(['README.md', '.git', ...exclude]);
  cpSync(from, to, {
    recursive: true,
    filter: (p) => !excluded.has(basename(p)),
  });
}

async function main() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const site = join(ROOT, 'apps/site');
  if (!existsSync(site)) {
    throw new Error('site-compose: apps/site does not exist');
  }
  copyTree(site, DIST);
  console.log('site-compose: apps/site → dist/');

  for (const [path, src] of Object.entries(map.mounts || {})) {
    let from;
    let label;
    let exclude = [];
    if (typeof src === 'string') {
      from = join(ROOT, src);
      if (!existsSync(from)) throw new Error(`site-compose: source "${src}" does not exist`);
      label = src;
    } else {
      from = await fetchRemoteMount(src);
      exclude = Array.isArray(src.exclude) ? src.exclude : [];
      label = `${src.repo}@${src.ref || 'main'}${src.root && src.root !== '.' ? ':' + src.root : ''}`;
    }
    copyTree(from, join(DIST, path), exclude);
    console.log(`site-compose: ${label} → dist/${path}/`);
  }
  console.log('site-compose: done');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
