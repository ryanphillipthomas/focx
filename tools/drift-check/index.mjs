#!/usr/bin/env node
// drift-check — dependency-free design-drift detection for any repository.
// Exit 0 = clean. Exit 1 = configuration error or drift.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

const DEFAULTS = Object.freeze({
  parentNamespace: 'focx',
  tokenPathPattern: 'design/tokens/{namespace}/tokens.json',
  scanDirs: ['apps', 'packages'],
  scanExtensions: ['.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.svelte', '.vue', '.html'],
});

const ROOT = resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const CONFIG_FILE = 'drift-check.config.json';
const violations = [];

function fail(where, message, line) {
  violations.push({ where, message, line });
}

function input(name) {
  return process.env[`INPUT_${name.toUpperCase()}`]?.trim() || undefined;
}

function commaList(value) {
  return value?.split(',').map((item) => item.trim()).filter(Boolean);
}

function loadConfig() {
  const path = join(ROOT, CONFIG_FILE);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('the top-level value must be an object');
    }
    return parsed;
  } catch (error) {
    fail(CONFIG_FILE, `unreadable or invalid JSON: ${error.message}`);
    return {};
  }
}

const fileConfig = loadConfig();
const config = {
  parentNamespace: input('PARENT-NAMESPACE') ?? fileConfig.parentNamespace ?? DEFAULTS.parentNamespace,
  tokenPathPattern: input('TOKEN-PATH-PATTERN') ?? fileConfig.tokenPathPattern ?? DEFAULTS.tokenPathPattern,
  scanDirs: commaList(input('SCAN-DIRS')) ?? fileConfig.scanDirs ?? DEFAULTS.scanDirs,
  scanExtensions: commaList(input('SCAN-EXTENSIONS')) ?? fileConfig.scanExtensions ?? DEFAULTS.scanExtensions,
};

function validateString(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(CONFIG_FILE, `"${name}" must be a non-empty string`);
    return false;
  }
  return true;
}

function validateList(name, value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    fail(CONFIG_FILE, `"${name}" must be a non-empty array of non-empty strings`);
    return false;
  }
  return true;
}

function staysInRepository(path) {
  const segments = path.replaceAll('\\', '/').split('/');
  return !isAbsolute(path) && !segments.includes('..');
}

if (!validateString('parentNamespace', config.parentNamespace)) {
  config.parentNamespace = DEFAULTS.parentNamespace;
} else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(config.parentNamespace)) {
  fail(CONFIG_FILE, '"parentNamespace" must be a single safe path segment');
  config.parentNamespace = DEFAULTS.parentNamespace;
}
let tokenPatternValid = validateString('tokenPathPattern', config.tokenPathPattern);
if (tokenPatternValid) {
  const namespaceSegments = config.tokenPathPattern.split('/').filter((part) => part === '{namespace}');
  if (namespaceSegments.length !== 1) {
    fail(CONFIG_FILE, '"tokenPathPattern" must contain one {namespace} path segment');
    tokenPatternValid = false;
  }
  if (!staysInRepository(config.tokenPathPattern)) {
    fail(CONFIG_FILE, '"tokenPathPattern" must stay within the repository');
    tokenPatternValid = false;
  }
}
if (!tokenPatternValid) config.tokenPathPattern = DEFAULTS.tokenPathPattern;
if (!validateList('scanDirs', config.scanDirs)) config.scanDirs = [];
if (!validateList('scanExtensions', config.scanExtensions)) config.scanExtensions = [];

if (Array.isArray(config.scanDirs)) {
  for (const path of config.scanDirs) {
    if (!staysInRepository(path)) {
      fail(CONFIG_FILE, `scan directory "${path}" must stay within the repository`);
    }
  }
}

if (Array.isArray(config.scanExtensions)) {
  config.scanExtensions = config.scanExtensions.map((extension) => extension.startsWith('.') ? extension : `.${extension}`);
}

function tokenPath(namespace) {
  return config.tokenPathPattern.replace('{namespace}', namespace);
}

function loadTokens(path) {
  try {
    const parsed = JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('the top-level value must be an object');
    }
    return parsed;
  } catch (error) {
    fail(path, `unreadable or invalid JSON: ${error.message}`);
    return null;
  }
}

function flatten(object, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(object)) {
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

const parentPath = tokenPath(config.parentNamespace);
const parentTokens = loadTokens(parentPath);
const parentFlat = parentTokens ? flatten(parentTokens) : new Map();

function childLayers() {
  const patternSegments = config.tokenPathPattern.split('/');
  const namespaceIndex = patternSegments.indexOf('{namespace}');
  const tokenRoot = join(ROOT, ...patternSegments.slice(0, namespaceIndex));
  try {
    return readdirSync(tokenRoot)
      .filter((entry) => entry !== config.parentNamespace && statSync(join(tokenRoot, entry)).isDirectory())
      .sort();
  } catch (error) {
    fail(relative(ROOT, tokenRoot) || '.', `unreadable token directory: ${error.message}`);
    return [];
  }
}

const childFlats = [];
for (const namespace of childLayers()) {
  const path = tokenPath(namespace);
  if (!existsSync(join(ROOT, path))) {
    fail(dirname(path), `child token layer has no file matching ${config.tokenPathPattern}`);
    continue;
  }
  const tokens = loadTokens(path);
  if (!tokens) continue;
  const flat = flatten(tokens);
  childFlats.push(flat);

  for (const [name, token] of flat) {
    const isNamespaced = name.startsWith(`${namespace}.`);
    const isOverride = token.override === true;
    if (!isNamespaced && !isOverride) {
      fail(path, `"${name}" is neither ${namespace}.* nor an explicit override — silent parent redefinition is drift`);
    }
    if (isOverride) {
      const target = token.overrides;
      if (!target || !parentFlat.has(target)) {
        fail(path, `override "${name}" must name an existing ${config.parentNamespace} path in "overrides" (got: ${target ?? 'nothing'})`);
      }
    }
  }
}

const publishedValues = new Set(
  [parentFlat, ...childFlats]
    .flatMap((flat) => [...flat.values()])
    .map((token) => String(token.value).toLowerCase())
);

const scanExtensions = new Set(config.scanExtensions);
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
    else if (scanExtensions.has(extname(entry))) yield full;
  }
}

for (const dir of config.scanDirs) {
  for (const file of walk(join(ROOT, dir))) {
    const path = relative(ROOT, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.includes('drift-allow')) return;
      for (const regex of [HEX_RE, RGB_RE, PX_RE]) {
        for (const match of line.matchAll(regex)) {
          const literal = (match[1] ?? match[0]).toLowerCase();
          if (!publishedValues.has(literal)) {
            fail(path, `raw value "${match[0].trim()}" does not resolve to a published token`, index + 1);
          }
        }
      }
    });
  }
}

function escapeCommand(value, property = false) {
  let escaped = String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  if (property) escaped = escaped.replaceAll(':', '%3A').replaceAll(',', '%2C');
  return escaped;
}

if (violations.length === 0) {
  console.log('drift-check: clean — no design drift detected.');
  process.exit(0);
}

console.error(`drift-check: ${violations.length} violation(s)\n`);
for (const violation of violations) {
  const location = violation.line ? `${violation.where}:${violation.line}` : violation.where;
  console.error(`  ${location}\n    ${violation.message}\n`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    const properties = [`file=${escapeCommand(violation.where, true)}`];
    if (violation.line) properties.push(`line=${violation.line}`);
    console.log(`::error ${properties.join(',')},title=Design drift::${escapeCommand(violation.message)}`);
  }
}
console.error('Replace raw values with published design tokens, or explicitly mark reviewed exceptions with drift-allow.');
process.exit(1);
