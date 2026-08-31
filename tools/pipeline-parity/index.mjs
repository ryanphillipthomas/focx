#!/usr/bin/env node
// Pipeline parity check.
//
// The pipeline machinery lives in two repos — focx and studio-810 — kept in
// step by hand. Twice now a fix landed in one and not the other: descriptive PR
// titles, then the base-branch-aware preview URL. Nothing noticed, because
// nothing recorded which files were supposed to match.
//
// Compares two checkouts against tools/pipeline-parity/manifest.json:
//
//   identical  byte-for-byte equal.
//   branded    equal once brand tokens are normalized away (focx.ai ↔
//              wearestudio810.com and friends). Brand names differ in length,
//              so prose re-wraps around them: comment blocks are compared as
//              whitespace-collapsed text, while code lines are compared exactly
//              so YAML indentation still counts.
//   structure  JSON shape must match — properties, required, types,
//              conditionals — while $id, descriptions, and enum vocabularies
//              may differ. This is how a contract can name each repo's own apps
//              and components yet still fail when one repo gains a required
//              field the other never got.
//   local      deliberately repo-specific. Recorded, never compared.
//
// Usage:  node tools/pipeline-parity/index.mjs <other-repo-checkout>
// Exit 0 when the shared surface agrees, 1 when it has drifted.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ours = resolve(here, '../..')
const theirs = resolve(process.argv[2] ?? '')

if (!process.argv[2] || !existsSync(theirs)) {
  console.error('usage: node tools/pipeline-parity/index.mjs <other-repo-checkout>')
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))

// Both brands in a pair collapse to the same placeholder, so the comparison is
// symmetric — the check gives the same answer run from either repo. Longest
// tokens first: "focx.ai" and "focx-staging" both contain "focx", and
// substituting the bare name first would strand the remainder.
const tokens = manifest.brandTokens
  .flatMap((pair, i) => pair.map((text) => ({ text, placeholder: `«brand${i}»` })))
  .sort((a, b) => b.text.length - a.text.length)
const neutralize = (text) =>
  tokens.reduce((acc, { text: brand, placeholder }) => acc.split(brand).join(placeholder), text)

const squash = (text) => text.replace(/\s+/g, ' ').trim()
const isComment = (line) => /^\s*(#|\/\/)/.test(line)

// Comment blocks re-wrap when a brand name changes length, so compare each
// block as one squashed string; everything else stays line-exact.
const proseAware = (text, path) => {
  if (path.endsWith('.md')) return squash(text)
  const out = []
  let block = []
  for (const line of text.split('\n')) {
    if (isComment(line)) { block.push(line.replace(/^\s*(#|\/\/)\s?/, '')); continue }
    if (block.length) { out.push(`«comment»${squash(block.join(' '))}`); block = [] }
    out.push(line)
  }
  if (block.length) out.push(`«comment»${squash(block.join(' '))}`)
  return out.join('\n')
}

// Keep the shape, drop the vocabulary.
const shape = (node) => {
  if (Array.isArray(node)) return node.map(shape)
  if (node && typeof node === 'object') {
    const out = {}
    for (const key of Object.keys(node).sort()) {
      if (key === 'description' || key === '$id' || key === 'comment' || key === 'title') continue
      out[key] = key === 'enum' && Array.isArray(node[key]) ? `«enum:${node[key].length}»` : shape(node[key])
    }
    return out
  }
  return node
}

const read = (root, path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null)

const findings = []
let compared = 0

for (const mode of ['identical', 'branded', 'structure']) {
  for (const path of manifest[mode] ?? []) {
    const a = read(ours, path)
    const b = read(theirs, path)

    // Absent from both is a manifest entry that has not landed yet. Absent from
    // one side only is exactly the drift this tool exists to catch.
    if (a === null && b === null) continue
    if (a === null || b === null) {
      findings.push(`${path}: present in ${a === null ? 'the sibling checkout' : 'this repo'} only`)
      continue
    }

    compared++
    let left = a
    let right = b
    try {
      if (mode === 'branded') {
        left = proseAware(neutralize(a), path)
        right = proseAware(neutralize(b), path)
      } else if (mode === 'structure') {
        left = JSON.stringify(shape(JSON.parse(a)), null, 1)
        right = JSON.stringify(shape(JSON.parse(b)), null, 1)
      }
    } catch (err) {
      findings.push(`${path}: could not be compared (${err.message})`)
      continue
    }

    if (left !== right) {
      const l = left.split('\n')
      const r = right.split('\n')
      const at = l.findIndex((line, i) => line !== r[i]) + 1
      const detail = mode === 'structure' ? 'shapes differ' : `${mode} copies differ`
      findings.push(`${path}: ${detail}${at ? ` (first at normalized line ${at})` : ''}`)
    }
  }
}

if (findings.length) {
  console.error(`pipeline parity: DRIFTED — ${findings.length} of ${compared} shared files disagree\n`)
  for (const f of findings) console.error(`  ✗ ${f}`)
  console.error('\nPort the change to the repo that is behind, or reclassify the file in')
  console.error('tools/pipeline-parity/manifest.json if the difference is deliberate.')
  process.exit(1)
}

console.log(`pipeline parity: OK — ${compared} shared files agree across ${manifest.repos.join(' and ')}`)
