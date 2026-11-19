// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  backUpCreds,
  forgetLogin,
  hasSavedLink,
  restoreCredsIfBroken,
  writeCredsAtomically,
} from './creds-file.ts'
import { acquireSingleInstance } from './single-instance.ts'

let folder: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'campaign-sender-login-'))
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

describe('the login file', () => {
  const creds = () => readFileSync(join(folder, 'creds.json'), 'utf8')

  it('saves by replacing the file whole, leaving no temporary file', () => {
    writeCredsAtomically(folder, '{"a":1}')
    writeCredsAtomically(folder, '{"a":2}')
    expect(creds()).toBe('{"a":2}')
    expect(existsSync(join(folder, 'creds.json.tmp'))).toBe(false)
  })

  it('creates the folder on the first save', () => {
    const fresh = join(folder, 'auth')
    writeCredsAtomically(fresh, '{}')
    expect(existsSync(join(fresh, 'creds.json'))).toBe(true)
  })

  it('restores a login cut short by a kill from the last one that worked', () => {
    writeCredsAtomically(folder, '{"account":"good"}')
    expect(backUpCreds(folder)).toBe(true)
    writeFileSync(join(folder, 'creds.json'), '', 'utf8')
    expect(restoreCredsIfBroken(folder)).toBe('restored')
    expect(creds()).toBe('{"account":"good"}')
  })

  it('restores a login that has gone missing', () => {
    writeCredsAtomically(folder, '{"account":"good"}')
    backUpCreds(folder)
    rmSync(join(folder, 'creds.json'))
    expect(restoreCredsIfBroken(folder)).toBe('restored')
    expect(creds()).toBe('{"account":"good"}')
  })

  it('leaves a readable login alone, whatever the backup holds', () => {
    writeCredsAtomically(folder, '{"account":"old"}')
    backUpCreds(folder)
    writeCredsAtomically(folder, '{"account":"new"}')
    expect(restoreCredsIfBroken(folder)).toBe('not_needed')
    expect(creds()).toBe('{"account":"new"}')
  })

  it('never backs up a broken login over a good backup', () => {
    writeCredsAtomically(folder, '{"account":"good"}')
    backUpCreds(folder)
    writeFileSync(join(folder, 'creds.json'), '{"acc', 'utf8')
    expect(backUpCreds(folder)).toBe(false)
    expect(readFileSync(join(folder, 'creds.json.bak'), 'utf8')).toBe('{"account":"good"}')
  })

  it('says so when a broken login has nothing to restore from', () => {
    writeFileSync(join(folder, 'creds.json'), '', 'utf8')
    expect(restoreCredsIfBroken(folder)).toBe('nothing_to_restore')
  })

  it('needs nothing on a laptop that was never linked', () => {
    expect(restoreCredsIfBroken(join(folder, 'never'))).toBe('not_needed')
  })

  it('forgets the login and its backup together', () => {
    writeCredsAtomically(folder, '{"account":"good"}')
    backUpCreds(folder)
    forgetLogin(folder)
    expect(existsSync(folder)).toBe(false)
    expect(restoreCredsIfBroken(folder)).toBe('not_needed')
  })
})

describe('asking whether a link is saved', () => {
  it('is no for a laptop never linked and for a pairing still waiting on its code', () => {
    expect(hasSavedLink(join(folder, 'never'))).toBe(false)
    writeCredsAtomically(folder, '{"me":{"id":"x"},"registered":true}')
    expect(hasSavedLink(folder)).toBe(false)
  })

  it('is yes once a pairing has completed', () => {
    writeCredsAtomically(folder, '{"account":{}}')
    expect(hasSavedLink(folder)).toBe(true)
  })

  it('reads the backup while the login is mid-save, and changes nothing', () => {
    writeCredsAtomically(folder, '{"account":{}}')
    backUpCreds(folder)
    writeFileSync(join(folder, 'creds.json'), '{"acc', 'utf8')
    expect(hasSavedLink(folder)).toBe(true)
    expect(readFileSync(join(folder, 'creds.json'), 'utf8')).toBe('{"acc')
  })
})

describe('one sender per laptop', () => {
  it('refuses a second copy while the first is running', () => {
    expect(acquireSingleInstance(folder, 111, () => true).ok).toBe(true)
    expect(acquireSingleInstance(folder, 222, () => true)).toEqual({ ok: false, heldByPid: 111 })
  })

  it('takes over from a copy that died without cleaning up', () => {
    acquireSingleInstance(folder, 111, () => true)
    expect(acquireSingleInstance(folder, 222, () => false).ok).toBe(true)
  })

  it('lets the same process ask twice, and frees the lock on release', () => {
    const first = acquireSingleInstance(folder, 111, () => true)
    expect(acquireSingleInstance(folder, 111, () => true).ok).toBe(true)
    if (first.ok) first.release()
    expect(acquireSingleInstance(folder, 222, () => true).ok).toBe(true)
  })

  it('does not free a lock another copy has since taken', () => {
    const first = acquireSingleInstance(folder, 111, () => true)
    acquireSingleInstance(folder, 222, () => false)
    if (first.ok) first.release()
    expect(acquireSingleInstance(folder, 333, () => true)).toEqual({ ok: false, heldByPid: 222 })
  })

  it('ignores a lock file that holds nonsense', () => {
    writeFileSync(join(folder, 'sender.lock'), 'not a pid', 'utf8')
    expect(acquireSingleInstance(folder, 111, () => true).ok).toBe(true)
  })
})
