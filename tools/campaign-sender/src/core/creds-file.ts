/**
 * Keeping the WhatsApp login file whole (design D4).
 *
 * Baileys writes `creds.json` in place. A process killed mid-write — a closed
 * lid at the wrong instant, Ctrl+C, a Windows update — leaves it empty or cut
 * short, and the device then has to be linked again. For this sender that
 * means disturbing the person who holds the business phone in another country,
 * so it is the failure most worth designing out. The owner's WAP Brain project
 * met exactly this on a real device (its `make-live-sync-trustworthy` design)
 * and the two measures here are the ones it settled on, plus one:
 *
 *  1. every save writes a temporary file and renames it over the real one, so
 *     the real one is always either the old login or the new one, never half;
 *  2. each time the connection opens, the login that just worked is copied to
 *     `creds.json.bak`;
 *  3. on start, a login file that is missing or unreadable is restored from
 *     that copy.
 *
 * This module handles text and files only. What goes in the text is Baileys'
 * business, so nothing here imports it and the root test run covers all of it.
 */

import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CREDS = 'creds.json'
const BACKUP = 'creds.json.bak'
const TEMPORARY = 'creds.json.tmp'

/** A login file is usable when it parses to an object. Empty or cut short is not. */
function parses(path: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}

function exists(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

export function writeCredsAtomically(authFolder: string, json: string): void {
  mkdirSync(authFolder, { recursive: true })
  const temporary = join(authFolder, TEMPORARY)
  const target = join(authFolder, CREDS)
  writeFileSync(temporary, json, 'utf8')
  try {
    renameSync(temporary, target)
  } catch {
    // Windows refuses a rename while another program holds the file open (a
    // virus scanner, briefly). Writing in place is the fallback, and the backup
    // is what covers a kill during it.
    writeFileSync(target, json, 'utf8')
    rmSync(temporary, { force: true })
  }
}

/** Call when a connection has just opened: this login provably works. */
export function backUpCreds(authFolder: string): boolean {
  const source = join(authFolder, CREDS)
  if (!parses(source)) return false
  copyFileSync(source, join(authFolder, BACKUP))
  return true
}

export type RestoreResult = 'not_needed' | 'restored' | 'nothing_to_restore'

/**
 * Call before loading the login. Restores only a file that is missing or
 * unreadable; a file that parses is left alone whatever it holds.
 */
export function restoreCredsIfBroken(authFolder: string): RestoreResult {
  const target = join(authFolder, CREDS)
  if (parses(target)) return 'not_needed'
  const backup = join(authFolder, BACKUP)
  if (!parses(backup)) return exists(target) ? 'nothing_to_restore' : 'not_needed'
  copyFileSync(backup, target)
  return 'restored'
}

/** Forget the login entirely, backup included. Used before a fresh link and by `unlink`. */
export function forgetLogin(authFolder: string): void {
  // Windows briefly refuses to delete a file a virus scanner has open.
  rmSync(authFolder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

/**
 * Whether a completed link is saved here. **Reads only**: `status` asks this
 * while another window may be connected and saving, so it must not restore,
 * create or touch anything. A login mid-save reads as its backup.
 */
export function hasSavedLink(authFolder: string): boolean {
  for (const name of [CREDS, BACKUP]) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(authFolder, name), 'utf8'))
      if (typeof parsed === 'object' && parsed !== null) return 'account' in parsed
    } catch {
      // Missing or mid-write: try the backup.
    }
  }
  return false
}
