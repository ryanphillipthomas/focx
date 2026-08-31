#!/usr/bin/env node
// contracts/validate — validates every run artifact in pipeline/runs/**
// against its JSON Schema in pipeline/contracts/. Dependency-free subset
// validator covering exactly what the contracts use: type, required,
// properties, additionalProperties:false, enum, const, pattern, minLength,
// minItems, maxItems, items, allOf + if/then.
//
// Exit 0 = every artifact valid. Exit 1 = violations, with a report.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const CONTRACTS = join(ROOT, 'pipeline/contracts');
const RUNS = join(ROOT, 'pipeline/runs');

const SCHEMA_FOR = {
  '00-run.json': 'run.schema.json',
  '10-brief.json': 'brief.schema.json',
  '20-product-spec.json': 'product-spec.schema.json',
  '30-research.json': 'research-report.schema.json',
  '40-design-spec.json': 'design-spec.schema.json',
  '50-build-report.json': 'build-report.schema.json',
  '60-qa-verdict.json': 'qa-verdict.schema.json',
};

function check(schema, data, path, errors) {
  if (schema.const !== undefined && data !== schema.const) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${path}: must be one of ${JSON.stringify(schema.enum)}`);
    return;
  }
  const type = schema.type;
  if (type === 'object' || (!type && schema.properties)) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      errors.push(`${path}: expected object`);
      return;
    }
    for (const req of schema.required ?? []) {
      if (!(req in data)) errors.push(`${path}: missing required "${req}"`);
    }
    for (const [key, value] of Object.entries(data)) {
      const sub = schema.properties?.[key];
      if (sub) check(sub, value, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  } else if (type === 'array') {
    if (!Array.isArray(data)) {
      errors.push(`${path}: expected array`);
      return;
    }
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push(`${path}: needs at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push(`${path}: allows at most ${schema.maxItems} item(s)`);
    }
    if (schema.items) data.forEach((item, i) => check(schema.items, item, `${path}[${i}]`, errors));
  } else if (type === 'string') {
    if (typeof data !== 'string') {
      errors.push(`${path}: expected string`);
      return;
    }
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
  } else if (type === 'integer') {
    if (!Number.isInteger(data)) errors.push(`${path}: expected integer`);
  } else if (type === 'number') {
    if (typeof data !== 'number') errors.push(`${path}: expected number`);
  } else if (type === 'boolean') {
    if (typeof data !== 'boolean') errors.push(`${path}: expected boolean`);
  }
  for (const sub of schema.allOf ?? []) {
    if (sub.if) {
      const condErrors = [];
      check(sub.if, data, path, condErrors);
      if (condErrors.length === 0 && sub.then) check(sub.then, data, path, errors);
    } else {
      check(sub, data, path, errors);
    }
  }
}

const failures = [];
let validated = 0;

if (existsSync(RUNS)) {
  for (const runDir of readdirSync(RUNS)) {
    const dir = join(RUNS, runDir);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      const schemaFile = SCHEMA_FOR[file];
      if (!schemaFile) continue;
      const rel = `pipeline/runs/${runDir}/${file}`;
      let schema, data;
      try {
        schema = JSON.parse(readFileSync(join(CONTRACTS, schemaFile), 'utf8'));
        data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      } catch (err) {
        failures.push({ rel, errors: [`unreadable: ${err.message}`] });
        continue;
      }
      const errors = [];
      check(schema, data, '$', errors);
      validated += 1;
      if (errors.length) failures.push({ rel, errors });
    }
  }
}

if (failures.length === 0) {
  console.log(`contracts: ${validated} artifact(s) valid — every handoff conforms.`);
  process.exit(0);
}
console.error(`contracts: ${failures.length} invalid artifact(s)\n`);
for (const f of failures) {
  console.error(`  ${f.rel}`);
  for (const e of f.errors) console.error(`    ${e}`);
  console.error('');
}
console.error('An artifact that fails its contract is an incomplete handoff (docs/pipeline.md).');
process.exit(1);
