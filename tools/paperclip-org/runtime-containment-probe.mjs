#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import {
  secretNamesInToolChildEnvironment,
  validateGeneratedToolSettings,
} from './index.mjs'

const settingsArg = process.argv.find((arg) => arg.startsWith('--settings='))
const problems = []

const leakedNames = secretNamesInToolChildEnvironment(process.env)
if (leakedNames.length) problems.push(`tool child contains secret variable name(s): ${leakedNames.join(', ')}`)

if (settingsArg) {
  const path = settingsArg.slice('--settings='.length)
  try {
    const settings = JSON.parse(readFileSync(path, 'utf8'))
    problems.push(...validateGeneratedToolSettings(settings))
  } catch (err) {
    problems.push(`generated settings could not be audited: ${err.message}`)
  }
}

if (problems.length) {
  console.error('runtime containment probe failed')
  for (const problem of problems) console.error(`- ${problem}`)
  process.exitCode = 1
} else {
  console.log('runtime containment probe passed: no secret variable names or forbidden generated grants')
}
