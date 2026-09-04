#!/usr/bin/env node
// drift-check — dependency-free design-drift detection for any repository.
// Exit 0 = clean. Exit 1 = configuration error or drift.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

const DEFAULTS = Object.freeze({
  parentNamespace: 'focx',
  tokenPathPattern: 'design/tokens/{namespace}/tokens.json',
  tokenFiles: [],
  validateParentChild: false,
  scanDirs: ['apps', 'src', 'packages'],
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

function booleanInput(value) {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(CONFIG_FILE, `boolean input must be "true" or "false" (got: ${value})`);
  return false;
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
  tokenFiles: commaList(input('TOKEN-FILES')) ?? fileConfig.tokenFiles ?? DEFAULTS.tokenFiles,
  validateParentChild: booleanInput(input('VALIDATE-PARENT-CHILD')) ?? fileConfig.validateParentChild ?? DEFAULTS.validateParentChild,
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

function validateList(name, value, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    fail(CONFIG_FILE, `"${name}" must be ${allowEmpty ? 'an' : 'a non-empty'} array of non-empty strings`);
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
if (!validateList('tokenFiles', config.tokenFiles, true)) config.tokenFiles = [];
if (!validateList('scanDirs', config.scanDirs)) config.scanDirs = [];
if (!validateList('scanExtensions', config.scanExtensions)) config.scanExtensions = [];
if (typeof config.validateParentChild !== 'boolean') {
  fail(CONFIG_FILE, '"validateParentChild" must be a boolean');
  config.validateParentChild = false;
}

for (const [name, paths] of [['token file', config.tokenFiles], ['scan directory', config.scanDirs]]) {
  for (const path of paths) {
    if (!staysInRepository(path)) fail(CONFIG_FILE, `${name} "${path}" must stay within the repository`);
  }
}
config.tokenFiles = config.tokenFiles.filter(staysInRepository);
config.scanDirs = config.scanDirs.filter(staysInRepository);
config.scanExtensions = config.scanExtensions.map((extension) => extension.startsWith('.') ? extension : `.${extension}`);

const scanExtensions = new Set(config.scanExtensions);
const tokenExtensions = new Set([...scanExtensions, '.json']);
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_RE = /\brgba?\([^)]+\)/g;
const PX_RE = /\b(?:font-size|line-height|margin|padding|gap|border-radius)\s*:\s*(\d+px)/g;

const GENERATED_DIR = /^(node_modules|dist|build|out|coverage|test-results|playwright-report|storybook-static|\.next|\.nuxt|\.turbo|\.cache|__snapshots__|vendor|public)$/;
const GENERATED_FILE = /\.(min|bundle|generated|gen)\.[a-z]+$/i;
const TOKEN_DIR = /^(tokens?|design-tokens|theme|themes|palette|palettes)$/i;
const TOKEN_FILE = /(^|[.\-_/])(tokens?|design-tokens|palette|colou?rs?|theme)([.\-_]|$)/i;
const TEST_DIR = /^(__tests__|__mocks__|__fixtures__|tests?|e2e|cypress|playwright|fixtures|mocks|\.storybook)$/i;
const TEST_FILE = /\.(test|spec|stories|story|bench|cy)\.[a-z]+$/i;
const ART_DIR = /^(icons?|flags?|logos?|assets|images?|img|illustrations?|graphics|svgs?|emojis?)$/i;
const ART_FILE = /(icon|flag|logo|illustration|emoji|avatar-image)/i;
const SVG_PAINT = /\b(?:fill|stroke|stop-color|flood-color|lighting-color)\s*[=:]/;

function* walk(dir, rel = '') {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.storybook') continue;
    if (GENERATED_DIR.test(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    const path = rel ? `${rel}/${entry}` : entry;
    if (stats.isDirectory()) yield* walk(full, path);
    else yield { full, path, name: entry };
  }
}

function isTokenLayer(path) {
  const parts = path.split('/');
  if (parts.slice(0, -1).some((part) => TOKEN_DIR.test(part))) return true;
  return TOKEN_FILE.test(parts.at(-1));
}

function isTestFixture(path, name) {
  const parts = path.split('/');
  return parts.slice(0, -1).some((part) => TEST_DIR.test(part)) || TEST_FILE.test(name);
}

function isArt(path, name, text) {
  const parts = path.split('/');
  if (parts.slice(0, -1).some((part) => ART_DIR.test(part))) return true;
  if (ART_FILE.test(name)) return true;
  return SVG_PAINT.test(text) && /<(svg|path|circle|rect|polygon|g)\b/i.test(text);
}

function tokenPath(namespace) {
  return config.tokenPathPattern.replace('{namespace}', namespace);
}

function loadJsonTokens(path) {
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
    if (value && typeof value === 'object' && !('value' in value)) flatten(value, path, out);
    else if (value && typeof value === 'object') out.set(path, value);
  }
  return out;
}

function validateParentChildLayers() {
  const parentPath = tokenPath(config.parentNamespace);
  const parentTokens = loadJsonTokens(parentPath);
  const parentFlat = parentTokens ? flatten(parentTokens) : new Map();
  const patternSegments = config.tokenPathPattern.split('/');
  const namespaceIndex = patternSegments.indexOf('{namespace}');
  const tokenRoot = join(ROOT, ...patternSegments.slice(0, namespaceIndex));
  let children = [];
  try {
    children = readdirSync(tokenRoot)
      .filter((entry) => entry !== config.parentNamespace && statSync(join(tokenRoot, entry)).isDirectory())
      .sort();
  } catch (error) {
    fail(relative(ROOT, tokenRoot) || '.', `unreadable token directory: ${error.message}`);
  }
  for (const namespace of children) {
    const path = tokenPath(namespace);
    if (!existsSync(join(ROOT, path))) {
      fail(dirname(path), `child token layer has no file matching ${config.tokenPathPattern}`);
      continue;
    }
    const tokens = loadJsonTokens(path);
    if (!tokens) continue;
    for (const [name, token] of flatten(tokens)) {
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
}

if (config.validateParentChild) validateParentChildLayers();

const publishedValues = new Set();
const explicitTokenFiles = new Set(config.tokenFiles.map((path) => path.replaceAll('\\', '/')));

function harvest(text) {
  for (const regex of [HEX_RE, RGB_RE]) {
    for (const match of text.matchAll(regex)) publishedValues.add(match[0].trim().toLowerCase());
  }
  for (const match of text.matchAll(/\b(\d+px)\b/g)) publishedValues.add(match[1].toLowerCase());
}

const discoveredTokenFiles = new Map();
for (const { full, path } of walk(ROOT)) {
  if (!tokenExtensions.has(extname(path))) continue;
  if (isTokenLayer(path) || explicitTokenFiles.has(path)) discoveredTokenFiles.set(path, full);
}
for (const path of explicitTokenFiles) {
  if (!discoveredTokenFiles.has(path)) {
    const full = join(ROOT, path);
    if (!existsSync(full)) fail(path, 'configured token file does not exist');
    else discoveredTokenFiles.set(path, full);
  }
}
for (const [path, full] of discoveredTokenFiles) {
  try {
    harvest(readFileSync(full, 'utf8'));
  } catch (error) {
    fail(path, `unreadable token file: ${error.message}`);
  }
}

for (const dir of config.scanDirs) {
  for (const { full, path, name } of walk(join(ROOT, dir), dir)) {
    if (!scanExtensions.has(extname(name))) continue;
    if (isTokenLayer(path) || explicitTokenFiles.has(path) || isTestFixture(path, name) || GENERATED_FILE.test(name)) continue;
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (isArt(path, name, text)) continue;
    text.split('\n').forEach((line, index) => {
      if (line.includes('drift-allow')) return;
      for (const regex of [HEX_RE, RGB_RE, PX_RE]) {
        for (const match of line.matchAll(regex)) {
          const literal = (match[1] ?? match[0]).trim().toLowerCase();
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
  console.log(`drift-check: clean — no design drift detected (${publishedValues.size} published values from ${discoveredTokenFiles.size} token files).`);
  process.exit(0);
}

console.error(`drift-check: ${violations.length} violation(s) (${publishedValues.size} published values from ${discoveredTokenFiles.size} token files)\n`);
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
