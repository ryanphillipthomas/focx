#!/usr/bin/env node
// drift-check — the design-drift gate. See docs/drift-gate.md.
//
// Checks, in order:
//   1. Token integrity: every token file under design/tokens/ parses. PARENT
//      names the parent layer; every other directory there is a child layer
//      whose namespace is its directory name. A child token must be either a
//      <namespace>.* addition or an explicit override ("override": true) of
//      an existing parent path. Silent parent redefinition = drift. Zero
//      child layers is valid.
//   2. Raw-value scan: app/package source may not contain literal colors or
//      hard-coded typography/spacing pixel values that don't correspond to a
//      published token value.
//
// Exit 0 = clean. Exit 1 = drift, with a file/line report.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const violations = [];

function fail(where, message) {
  violations.push({ where, message });
}

// ---------------------------------------------------------------- 1. tokens
function loadTokens(path) {
  try {
    return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
  } catch (err) {
    fail(path, `unreadable or invalid JSON: ${err.message}`);
    return null;
  }
}

function flatten(obj, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('_')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !('value' in value)) {
      flatten(value, path, out);
    } else if (value && typeof value === 'object') {
      out.set(path, value);
    }
  }
  return out;
}

const PARENT = 'focx';

const parentTokens = loadTokens(`design/tokens/${PARENT}/tokens.json`);
const parentFlat = parentTokens ? flatten(parentTokens) : new Map();

// Every directory under design/tokens/ other than the parent is a child layer,
// namespaced by its directory name. The rule holds whether there are zero
// children or many.
function childLayers() {
  const dir = join(ROOT, 'design/tokens');
  try {
    return readdirSync(dir)
      .filter((entry) => entry !== PARENT && statSync(join(dir, entry)).isDirectory())
      .sort();
  } catch (err) {
    fail('design/tokens/', `unreadable: ${err.message}`);
    return [];
  }
}

const childFlats = [];
for (const namespace of childLayers()) {
  const rel = `design/tokens/${namespace}/tokens.json`;
  if (!existsSync(join(ROOT, rel))) {
    fail(`design/tokens/${namespace}/`, 'child token layer has no tokens.json');
    continue;
  }
  const tokens = loadTokens(rel);
  if (!tokens) continue;
  const flat = flatten(tokens);
  childFlats.push(flat);

  for (const [path, token] of flat) {
    const isNamespaced = path.startsWith(`${namespace}.`);
    const isOverride = token.override === true;
    if (!isNamespaced && !isOverride) {
      fail(rel, `"${path}" is neither ${namespace}.* nor an explicit override — silent parent redefinition is drift`);
    }
    if (isOverride) {
      const target = token.overrides;
      if (!target || !parentFlat.has(target)) {
        fail(rel, `override "${path}" must name an existing ${PARENT} path in "overrides" (got: ${target ?? 'nothing'})`);
      }
    }
  }
}

// ---------------------------------------------------------- 2. raw values
const publishedValues = new Set(
  [parentFlat, ...childFlats]
    .flatMap((flat) => [...flat.values()])
    .map((t) => String(t.value).toLowerCase())
);

const SCAN_DIRS = ['apps', 'packages'];
const SCAN_EXT = /\.(js|jsx|ts|tsx|css|scss|svelte|vue|html)$/;
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_RE = /\brgba?\([^)]+\)/g;
const PX_RE = /\b(?:font-size|line-height|margin|padding|gap|border-radius)\s*:\s*(\d+px)/g;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (SCAN_EXT.test(entry)) yield full;
  }
}

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes('drift-allow')) return; // explicit, greppable escape hatch — reviewers see it
      for (const re of [HEX_RE, RGB_RE, PX_RE]) {
        for (const match of line.matchAll(re)) {
          const literal = (match[1] ?? match[0]).toLowerCase();
          if (!publishedValues.has(literal)) {
            fail(`${rel}:${i + 1}`, `raw value "${match[0].trim()}" does not resolve to a published token`);
          }
        }
      }
    });
  }
}

// ------------------------------------------------------------------ report
if (violations.length === 0) {
  console.log('drift-check: clean — no design drift detected.');
  process.exit(0);
}

console.error(`drift-check: ${violations.length} violation(s)\n`);
for (const v of violations) {
  console.error(`  ${v.where}\n    ${v.message}\n`);
}
console.error('The fix is never to weaken this gate. See docs/drift-gate.md.');
process.exit(1);
