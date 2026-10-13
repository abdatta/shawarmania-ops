import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **The outbox is never behind a change gate** (a-release-can-be-switched-off,
 * D7). A tablet whose gate turns off must still deliver every write it queued
 * while the gate was on, so nothing that stores, drains or dispatches a command
 * may ask which gates are on. The simplest proof is that no file here can: if
 * one ever imports the gate store, a command's delivery has started to depend on
 * a switch the owner can flip while it is still queued.
 */
describe('the outbox and change gates', () => {
  it('never reads a change gate', () => {
    const dir = resolve(process.cwd(), 'src/outbox')
    const sources = readdirSync(dir).filter(
      (file) => /\.tsx?$/.test(file) && !/\.test\./.test(file),
    )
    expect(sources.length).toBeGreaterThan(0)
    for (const file of sources) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text, file).not.toMatch(/from ['"][^'"]*change-gates|useChangeGate|ChangeGatesContext/)
    }
  })
})
