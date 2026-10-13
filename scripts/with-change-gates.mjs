#!/usr/bin/env node
/**
 * Run a command with `CHANGE_GATES` set: `node scripts/with-change-gates.mjs on
 * playwright test`. npm runs scripts through cmd.exe on Windows, where
 * `CHANGE_GATES=on playwright test` is not a command, and this repo has no
 * dependency for something four lines long (a-release-can-be-switched-off, D10).
 */

import { spawn } from 'node:child_process'

const [state, ...command] = process.argv.slice(2)
if ((state !== 'on' && state !== 'off') || command.length === 0) {
  process.stderr.write('Usage: node scripts/with-change-gates.mjs on|off <command> [args...]\n')
  process.exit(2)
}

const child = spawn(command.join(' '), {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CHANGE_GATES: state },
})
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
