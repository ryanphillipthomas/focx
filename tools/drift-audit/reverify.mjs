#!/usr/bin/env node
// FOC-50 re-verification harness.
//
// Recomputes the FOC-41 "defensible" violation count against a repo's current HEAD,
// using FOC-41's documented rules: check #2 only (raw literal that does not resolve to
// a value published in that repo's own token layer), with the three precision fixes
// (generated output excluded, token directories treated as the token layer, icon/flag/
// logo SVG art excluded).
//
// Usage: node reverify.mjs <repo-dir> [--json]

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, basename } from 'node:path';

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('usage: node reverify.mjs <repo-dir> [--json]');
  process.exit(2);
}
const AS_JSON = process.argv.includes('--json');

const SCAN_DIRS = ['apps', 'src', 'packages'];
const SCAN_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.svelte', '.vue', '.html']);

// Same regexes as tools/drift-check/index.mjs check #2.
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_RE = /\brgba?\([^)]+\)/g;
const PX_RE = /\b(?:font-size|line-height|margin|padding|gap|border-radius)\s*:\s*(\d+px)/g;

// --- Precision fix 1: generated output is not design drift. --------------------------
const GENERATED_DIR = /^(node_modules|dist|build|out|coverage|test-results|playwright-report|storybook-static|\.next|\.nuxt|\.turbo|\.cache|__snapshots__|vendor|public)$/;
const GENERATED_FILE = /\.(min|bundle|generated|gen)\.[a-z]+$/i;

// --- Precision fix 2: a token directory is the token layer, whatever it is named. -----
const TOKEN_DIR = /^(tokens?|design-tokens|theme|themes|palette|palettes)$/i;
const TOKEN_FILE = /(^|[.\-_/])(tokens?|design-tokens|palette|colou?rs?|theme)([.\-_]|$)/i;

// --- Precision fix 4: test/story fixtures are not design drift. ----------------------
// A literal asserted in a unit test is a fixture, not a styling decision. Gestalt's
// `multiColumnLayout.test.ts` alone carries 247 px values that are layout assertions.
const TEST_DIR = /^(__tests__|__mocks__|__fixtures__|tests?|e2e|cypress|playwright|fixtures|mocks|\.storybook)$/i;
const TEST_FILE = /\.(test|spec|stories|story|bench|cy)\.[a-z]+$/i;

// --- Precision fix 3: inlined SVG art is not design drift. ---------------------------
const ART_DIR = /^(icons?|flags?|logos?|assets|images?|img|illustrations?|graphics|svgs?|emojis?)$/i;
const ART_FILE = /(icon|flag|logo|illustration|emoji|avatar-image)/i;
const SVG_PAINT = /\b(?:fill|stroke|stop-color|flood-color|lighting-color)\s*[=:]/;

function* walk(dir, rel = '') {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.storybook') continue;
    if (GENERATED_DIR.test(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    const r = rel ? `${rel}/${entry}` : entry;
    if (st.isDirectory()) yield* walk(full, r);
    else yield { full, rel: r, name: entry };
  }
}

// A file is part of the token layer if it sits in a token-named directory anywhere in
// its path, or its own filename reads as a token/palette definition.
function isTokenLayer(relPath) {
  const parts = relPath.split('/');
  if (parts.slice(0, -1).some((p) => TOKEN_DIR.test(p))) return true;
  return TOKEN_FILE.test(parts[parts.length - 1]);
}

function isArt(relPath, name, text) {
  const parts = relPath.split('/');
  if (parts.slice(0, -1).some((p) => ART_DIR.test(p))) return true;
  if (ART_FILE.test(name)) return true;
  // Content check: a file whose hex values sit next to SVG paint attributes is art.
  return SVG_PAINT.test(text) && /<(svg|path|circle|rect|polygon|g)\b/i.test(text);
}

// ---- Pass 1: collect every value this repo publishes in its own token layer. --------
const published = new Set();
let tokenFileCount = 0;

function harvest(text) {
  for (const re of [HEX_RE, RGB_RE]) {
    for (const m of text.matchAll(re)) published.add(m[0].trim().toLowerCase());
  }
  for (const m of text.matchAll(/\b(\d+px)\b/g)) published.add(m[1].toLowerCase());
}

for (const { full, rel } of walk(ROOT)) {
  const ext = extname(rel);
  if (!SCAN_EXT.has(ext) && ext !== '.json') continue;
  if (!isTokenLayer(rel)) continue;
  let text;
  try { text = readFileSync(full, 'utf8'); } catch { continue; }
  tokenFileCount += 1;
  harvest(text);
}

const publishesHex = [...published].some((v) => v.startsWith('#'));

// ---- Pass 2: scan source for literals that do not resolve to a published value. -----
function isTestFixture(relPath, name) {
  const parts = relPath.split('/');
  if (parts.slice(0, -1).some((p) => TEST_DIR.test(p))) return true;
  return TEST_FILE.test(name);
}

const perFile = new Map();
let total = 0;
let scanned = 0;
const skipped = { tokenLayer: 0, art: 0, test: 0 };

for (const dir of SCAN_DIRS) {
  for (const { full, rel, name } of walk(join(ROOT, dir), dir)) {
    if (!SCAN_EXT.has(extname(name))) continue;
    if (isTokenLayer(rel)) { skipped.tokenLayer += 1; continue; }
    if (isTestFixture(rel, name)) { skipped.test += 1; continue; }
    if (GENERATED_FILE.test(name)) continue;
    let text;
    try { text = readFileSync(full, 'utf8'); } catch { continue; }
    if (isArt(rel, name, text)) { skipped.art += 1; continue; }
    scanned += 1;

    let count = 0;
    text.split('\n').forEach((line) => {
      if (line.includes('drift-allow')) return;
      for (const re of [HEX_RE, RGB_RE, PX_RE]) {
        for (const m of line.matchAll(re)) {
          const literal = (m[1] ?? m[0]).trim().toLowerCase();
          if (!published.has(literal)) count += 1;
        }
      }
    });
    if (count > 0) { perFile.set(rel, count); total += count; }
  }
}

const hottest = [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
const result = {
  repo: basename(ROOT),
  qualified: publishesHex && total > 0,
  publishedValues: published.size,
  tokenFiles: tokenFileCount,
  filesScanned: scanned,
  filesSkippedTokenLayer: skipped.tokenLayer,
  filesSkippedArt: skipped.art,
  filesSkippedTest: skipped.test,
  violations: total,
  filesWithViolations: perFile.size,
  hottest: hottest.map(([file, n]) => ({ file, n })),
};

if (AS_JSON) {
  console.log(JSON.stringify(result));
} else {
  console.log(`${result.repo}: ${total} violations across ${perFile.size} files ` +
    `(${published.size} published values from ${tokenFileCount} token files, ` +
    `${scanned} source files scanned, ${skipped.art} art files skipped)`);
  for (const [file, n] of hottest) console.log(`    ${file} (${n})`);
}
