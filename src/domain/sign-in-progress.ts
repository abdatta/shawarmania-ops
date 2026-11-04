/**
 * What a full sign-in's recorded stage means on screen (#46).
 *
 * The server records a stage word and when it was reached. This turns that pair,
 * the clock and the channel's last read into one of five things the surface can
 * show — nothing, the stage list live, the list gone quiet, a stopped sign-in, or
 * a finished one — so the judgement lives in one pure, tested place rather than
 * in the component.
 *
 * The words are the server's (`supabase/functions/_shared/login-stage.ts`); a
 * test holds the two lists equal.
 */

export const SIGN_IN_STAGES = [
  'starting',
  'opening_portal',
  'signing_in',
  'waiting_for_code',
  'checking_code',
  'bringing_hyperpure',
  'done',
  'stopped',
] as const

export type SignInStage = (typeof SIGN_IN_STAGES)[number]

/** A stage on its way to done; the two that end a sign-in are not steps. */
export type SignInStep = Exclude<SignInStage, 'done' | 'stopped'>

export interface SignInRecord {
  stage: SignInStage
  /** When the stage was reached, by the server's clock. */
  at: string
}

export function isSignInStage(value: unknown): value is SignInStage {
  return typeof value === 'string' && (SIGN_IN_STAGES as readonly string[]).includes(value)
}

/**
 * How long each stage can legitimately stand before the sign-in is quiet.
 *
 * Each is well past what the stage was measured to take (design D5), so quiet
 * means something stopped rather than something was slow. Waiting for a code is
 * the long one because it waits on a person: the mailbox lives five minutes and
 * the runner gives up at five.
 */
export const STAGE_CEILING_MS: Record<SignInStep, number> = {
  starting: 4 * 60_000,
  opening_portal: 2 * 60_000,
  signing_in: 2 * 60_000,
  waiting_for_code: 6 * 60_000,
  checking_code: 2 * 60_000,
  bringing_hyperpure: 3 * 60_000,
}

/**
 * After this long a sign-in is history and the ordinary cards speak again.
 * Twice the runner's fifteen-minute job timeout, matching the server's guard.
 */
export const SIGN_IN_HORIZON_MS = 30 * 60_000

export type SignInView =
  | { kind: 'none' }
  | { kind: 'live'; stage: SignInStep }
  | { kind: 'quiet'; stage: SignInStep }
  | { kind: 'stopped' }
  | { kind: 'done'; at: string }

/**
 * The steps a channel's sign-in passes through, in order. Swiggy has no
 * Hyperpure to bring along, so its list is one shorter rather than showing a
 * step that never ticks.
 */
export function signInSteps(towsHyperpure: boolean): readonly SignInStep[] {
  return towsHyperpure
    ? [
        'starting',
        'opening_portal',
        'signing_in',
        'waiting_for_code',
        'checking_code',
        'bringing_hyperpure',
      ]
    : ['starting', 'opening_portal', 'signing_in', 'waiting_for_code', 'checking_code']
}

/**
 * Read a recorded stage.
 *
 * `lastRunAt` is the channel's latest read: a `done` with a read after it has
 * been overtaken, and that read's own outcome is what the surface should say.
 */
export function readSignIn(
  record: SignInRecord | null,
  now: number,
  lastRunAt: string | null,
): SignInView {
  if (!record || !isSignInStage(record.stage)) return { kind: 'none' }
  const at = new Date(record.at).getTime()
  if (Number.isNaN(at)) return { kind: 'none' }
  const age = now - at
  if (age > SIGN_IN_HORIZON_MS) return { kind: 'none' }

  // A read that ran after the sign-in last moved has had its say about the
  // session, and its own outcome is what the surface should show. That holds for
  // a sign-in that ended or went quiet — never for a live one, which a scheduled
  // read running alongside must not hide.
  const readSince = lastRunAt !== null && new Date(lastRunAt).getTime() >= at

  if (record.stage === 'done') {
    return readSince ? { kind: 'none' } : { kind: 'done', at: record.at }
  }
  if (record.stage === 'stopped') return readSince ? { kind: 'none' } : { kind: 'stopped' }

  if (age <= STAGE_CEILING_MS[record.stage]) return { kind: 'live', stage: record.stage }
  return readSince ? { kind: 'none' } : { kind: 'quiet', stage: record.stage }
}

/**
 * Whether a step is behind the current one, is the current one, or is still to
 * come. Used for the ticks; a step is never shown ticked unless the sign-in is
 * past it.
 */
export function stepState(
  steps: readonly SignInStep[],
  step: SignInStep,
  current: SignInStep,
): 'past' | 'current' | 'upcoming' {
  const at = steps.indexOf(current)
  const index = steps.indexOf(step)
  if (index < at) return 'past'
  return index === at ? 'current' : 'upcoming'
}
