/**
 * One sender per laptop.
 *
 * Two copies running on one login take turns knocking each other off
 * WhatsApp's connection (which halts the sender). A second terminal left open
 * is the easy way to do that by accident, so the second copy is refused before
 * it connects.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function lockPath(folder: string): string {
  return join(folder, 'sender.lock')
}

function isRunning(pid: number): boolean {
  try {
    // Signal 0 sends nothing; it only asks whether the process exists.
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means it exists and belongs to someone else. Still running.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function holderOf(path: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(path, 'utf8').trim(), 10)
    return Number.isInteger(pid) ? pid : null
  } catch {
    return null
  }
}

export type LockResult = { ok: true; release: () => void } | { ok: false; heldByPid: number }

export function acquireSingleInstance(
  folder: string,
  pid: number = process.pid,
  running: (pid: number) => boolean = isRunning,
): LockResult {
  mkdirSync(folder, { recursive: true })
  const path = lockPath(folder)

  // Two tries: the second is for a lock left by a process that has since died.
  for (let tries = 0; tries < 2; tries += 1) {
    const holder = holderOf(path)
    if (holder !== null && holder !== pid && running(holder)) {
      return { ok: false, heldByPid: holder }
    }
    if (holder !== pid) {
      rmSync(path, { force: true })
      try {
        // `wx` fails if another copy created the file in the instant between,
        // so two copies started together cannot both believe they are alone.
        writeFileSync(path, `${pid}\n`, { encoding: 'utf8', flag: 'wx' })
      } catch {
        continue
      }
    }
    return {
      ok: true,
      release: () => {
        if (holderOf(path) === pid) rmSync(path, { force: true })
      },
    }
  }
  return { ok: false, heldByPid: holderOf(path) ?? 0 }
}
