#!/usr/bin/env node
// drift-check — the design-drift gate. See docs/drift-gate.md.
//
// Checks, in order:
//   1. Token integrity: both token files parse; connect tokens are either
//      connect.* additions or explicit overrides ("override": true) of an
//      existing focx path. Silent parent redefinition = drift.
//   2. Raw-value scan: app/package source may not contain literal colors or
//      hard-coded typography/spacing pixel values that don't correspond to a
//      published token value.
//
// Exit 0 = clean. Exit 1 = drift, with a file/line report.

import { readFileSync, readdirSync, statSync } from 'node:fs';
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

const focxTokens = loadTokens('design/tokens/focx/tokens.json');
const connectTokens = loadTokens('design/tokens/connect/tokens.json');

const focxFlat = focxTokens ? flatten(focxTokens) : new Map();
const connectFlat = connectTokens ? flatten(connectTokens) : new Map();

for (const [path, token] of connectFlat) {
  const isNamespaced = path.startsWith('connect.');
  const isOverride = token.override === true;
  if (!isNamespaced && !isOverride) {
    fail('design/tokens/connect/tokens.json', `"${path}" is neither connect.* nor an explicit override — silent parent redefinition is drift`);
  }
  if (isOverride) {
    const target = token.overrides;
    if (!target || !focxFlat.has(target)) {
      fail('design/tokens/connect/tokens.json', `override "${path}" must name an existing focx path in "overrides" (got: ${target ?? 'nothing'})`);
    }
  }
}

// ---------------------------------------------------------- 2. raw values
const publishedValues = new Set(
  [...focxFlat.values(), ...connectFlat.values()]
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
