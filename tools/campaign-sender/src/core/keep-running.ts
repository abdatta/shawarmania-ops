/**
 * Keeping the sender running until somebody stops it
 * (a-campaign-goes-out-on-whatsapp, design *The sender keeps running*).
 *
 * The sender first ran in whatever window started it, and died with that
 * window: on 2026-11-21 it was started in a terminal inside the Claude app and
 * went when the app closed its terminals, mid-test, with nothing to bring it
 * back. The owner: it should not stop "unless and until I really manually go
 * and stop it".
 *
 * So a keeper runs the sender and starts it again whenever it exits, except
 * for two reasons that are a person's to undo:
 *
 * - **The owner asked it to stop**, with `npm run stop` or the tray icon's
 *   *Stop the sender*. The request is a file in the data folder, so it holds
 *   across a restart of the laptop until the sender is started again.
 * - **The sender halted** (exit code 2): WhatsApp ended the session, logged
 *   the device out or restricted the account. Connecting again by itself is
 *   exactly what a halt forbids (design D10).
 *
 * Anything else, a crash, a kill, a clean exit nobody asked for, the network
 * missing at logon, is followed by a fresh start: soon after a run that had
 * settled, and later after each quick failure, up to five minutes, so a fault
 * that recurs at once is retried slowly forever rather than given up on.
 *
 * Text in, verdicts out: nothing here touches the disk or a process.
 */

/** The file in the data folder that asks the sender to stop, and to stay stopped. */
export const STOP_REQUEST_FILE = 'stopped-by-owner.json'

/** The keeper's own lock: one keeper per data folder, beside the sender's. */
export const KEEPER_LOCK_FILE = 'keeper.lock'

/**
 * Set on the sender a keeper starts. Such a sender never clears a stop
 * request; a sender a person starts by hand does, because starting it is the
 * person saying so.
 */
export const KEPT_ENV = 'CAMPAIGN_SENDER_KEPT'

/** The exit code of a sender that halted (design D10). */
export const HALTED_EXIT_CODE = 2

/** A run this long had settled: its exit is news, not a fault repeating. */
export const SETTLED_RUN_MS = 10 * 60_000

/** How long to wait before each start after quick exits in a row. */
export const KEEPER_STEPS_MS: readonly number[] = [5_000, 15_000, 60_000, 120_000, 300_000]

export interface FinishedRun {
  /** The sender's exit code; null when it was killed. */
  code: number | null
  ranMs: number
  /** A stop request was there when it exited. */
  stopAsked: boolean
  /** Quick exits in a row before this one. */
  quickExitsBefore: number
}

export type KeeperVerdict =
  | { kind: 'restart'; afterMs: number; quickExits: number }
  | { kind: 'stay_stopped'; why: 'owner' | 'halted' }

export function afterExit(run: FinishedRun): KeeperVerdict {
  if (run.stopAsked) return { kind: 'stay_stopped', why: 'owner' }
  if (run.code === HALTED_EXIT_CODE) return { kind: 'stay_stopped', why: 'halted' }
  const quickExits = run.ranMs >= SETTLED_RUN_MS ? 0 : run.quickExitsBefore + 1
  const step = Math.min(Math.max(quickExits - 1, 0), KEEPER_STEPS_MS.length - 1)
  return { kind: 'restart', afterMs: KEEPER_STEPS_MS[step] as number, quickExits }
}

export interface StopRequest {
  /** What asked: `npm run stop`, the tray icon. */
  by: string
  /** When, as an ISO instant; null when the file could not be read. */
  at: string | null
}

export function stopRequestText(by: string, at: Date): string {
  return `${JSON.stringify({ by, at: at.toISOString() })}\n`
}

/** Whatever the file says, its being there is the request. */
export function readStopRequest(text: string): StopRequest {
  try {
    const parsed = JSON.parse(text) as Partial<StopRequest>
    return {
      by: typeof parsed.by === 'string' ? parsed.by : 'unknown',
      at: typeof parsed.at === 'string' ? parsed.at : null,
    }
  } catch {
    return { by: 'unknown', at: null }
  }
}
