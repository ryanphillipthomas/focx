#!/usr/bin/env node
// site-compose — assembles the focx.ai umbrella site into dist/.
//
// COPY-ONLY by design: this script moves committed files into the URL layout
// defined by site-map.json; it never generates or rewrites content. What was
// reviewed is what deploys (see render.yaml).
//
//   apps/site/*  →  dist/                 (umbrella root)
//   <mounts>     →  dist/<path>/          (each sub-app at its focx.ai path)

import { cpSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const map = JSON.parse(readFileSync(new URL('./site-map.json', import.meta.url), 'utf8'));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const copies = [['apps/site', '.'], ...Object.entries(map.mounts).map(([path, src]) => [src, path])];

for (const [src, dest] of copies) {
  const from = join(ROOT, src);
  if (!existsSync(from)) {
    console.error(`site-compose: source "${src}" does not exist`);
    process.exit(1);
  }
  cpSync(from, join(DIST, dest), { recursive: true, filter: (f) => !f.endsWith('README.md') });
  console.log(`site-compose: ${src} → dist/${dest === '.' ? '' : dest + '/'}`);
}
console.log('site-compose: done');
