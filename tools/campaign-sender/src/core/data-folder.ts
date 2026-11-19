/**
 * The sender's folder on the laptop, and the halt record kept in it
 * (design D4, D10).
 *
 * **Whoever copies `whatsapp-auth` has the business WhatsApp account.** It
 * lives under `%LOCALAPPDATA%`, which OneDrive does not mirror, never in the
 * repository, and nothing here prints its contents.
 *
 * The halt record is written here first and anywhere else second: a sender
 * that WhatsApp has refused must still refuse to connect when the laptop next
 * wakes with no network at all.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { HaltReason } from './disconnect.ts'

const FOLDER_NAME = 'shawarmania-campaign-sender'

export function dataFolder(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['CAMPAIGN_SENDER_DATA_DIR']
  if (override) return override
  const local = env['LOCALAPPDATA']
  if (local) return join(local, FOLDER_NAME)
  return join(homedir(), `.${FOLDER_NAME}`)
}

export function authFolder(folder: string): string {
  return join(folder, 'whatsapp-auth')
}

/**
 * Where the owner's database sign-in will be kept once the sender has one
 * (design D4, task 4.4). Named here, before anything writes it, because one
 * thing already has to ask: a laptop that holds it works on the real queue,
 * and must never be given the rehearsal's stand-in instead.
 */
export function queueSessionPath(folder: string): string {
  return join(folder, 'supabase-session.json')
}

export function realQueueConfigured(folder: string): boolean {
  return existsSync(queueSessionPath(folder))
}

/**
 * The one number a rehearsal may message: digits with country code, written by
 * the owner into a file in the sender's folder. Never in the repository.
 */
export function rehearsalRecipientPath(folder: string): string {
  return join(folder, 'test-recipient.txt')
}

export interface HaltRecord {
  reason: HaltReason
  /** ISO instant, UTC. */
  at: string
}

function haltPath(folder: string): string {
  return join(folder, 'halted.json')
}

export function readHalt(folder: string): HaltRecord | null {
  let text: string
  try {
    text = readFileSync(haltPath(folder), 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(text) as Partial<HaltRecord>
    if (typeof parsed.reason === 'string' && typeof parsed.at === 'string') {
      return { reason: parsed.reason as HaltReason, at: parsed.at }
    }
  } catch {
    // Fall through: a file that exists and cannot be read is still a halt.
  }
  // Something wrote a halt and it is unreadable. Refusing is the safe reading.
  return { reason: 'unreadable_record', at: new Date(0).toISOString() }
}

export function writeHalt(folder: string, reason: HaltReason, now: Date = new Date()): HaltRecord {
  const record: HaltRecord = { reason, at: now.toISOString() }
  mkdirSync(folder, { recursive: true })
  writeFileSync(haltPath(folder), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

export function clearHalt(folder: string): void {
  rmSync(haltPath(folder), { force: true })
}
