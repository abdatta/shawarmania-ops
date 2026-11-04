/**
 * Where a full sign-in has got to, as the server records it (#46).
 *
 * The stage lives on `aggregator_channel_credentials.login_stage`, beside the
 * channel's session pointers, and reaches the owner only through
 * `aggregator_credential_health_v2`. Most stages are recorded here, by the
 * server, from calls the runner already makes — the dispatch, the mailbox
 * opening, the code being collected, the login finishing — so the stepper says
 * something true even about a runner that reports nothing. The runner adds only
 * what the server cannot see, through `report_stage`, and only from its own
 * short list.
 *
 * Kept pure apart from `recordLoginStage`, which takes the narrowest client
 * shape it needs, so the vocabulary and the guard are unit-testable without a
 * Deno runtime.
 */

/** Every word the column's check permits, in the order a sign-in passes them. */
export const LOGIN_STAGES = [
  'starting',
  'opening_portal',
  'signing_in',
  'waiting_for_code',
  'checking_code',
  'bringing_hyperpure',
  'done',
  'stopped',
] as const

export type LoginStage = (typeof LOGIN_STAGES)[number]

/**
 * The words a runner may report. Everything else the server records itself,
 * and a runner claiming `waiting_for_code` without a mailbox would be claiming
 * a code box that does not exist.
 */
export const RUNNER_STAGES: readonly LoginStage[] = [
  'opening_portal',
  'signing_in',
  'done',
  'stopped',
]

const TERMINAL: readonly LoginStage[] = ['done', 'stopped']

/**
 * How long after its last stage a sign-in can still be under way.
 *
 * Twice `login.yml`'s fifteen-minute job timeout: past this no runner can be
 * alive to report anything, so a report arriving later is a replay or a bug and
 * must not wake a sign-in that ended.
 */
export const SIGN_IN_HORIZON_MS = 30 * 60_000

export function isLoginStage(value: unknown): value is LoginStage {
  return typeof value === 'string' && (LOGIN_STAGES as readonly string[]).includes(value)
}

/**
 * May the runner record `stage` now, given what is recorded?
 *
 * Only its own words, only while a sign-in is under way (a non-terminal stage
 * recorded within the horizon), and `done` only for Zomato — Swiggy's comes
 * from `finish_login`, because Swiggy has no Hyperpure hop after it.
 */
export function judgeRunnerStage(input: {
  channel: string
  stage: unknown
  current: string | null
  currentAt: string | null
  now: Date
}): { ok: true; stage: LoginStage } | { ok: false; error: 'unknown_stage' | 'no_sign_in' } {
  const { channel, stage, current, currentAt, now } = input
  if (!isLoginStage(stage) || !RUNNER_STAGES.includes(stage))
    return { ok: false, error: 'unknown_stage' }
  if (stage === 'done' && channel !== 'zomato') return { ok: false, error: 'unknown_stage' }
  if (!isLoginStage(current) || TERMINAL.includes(current) || currentAt === null) {
    return { ok: false, error: 'no_sign_in' }
  }
  const age = now.getTime() - new Date(currentAt).getTime()
  if (!(age >= -60_000 && age <= SIGN_IN_HORIZON_MS)) return { ok: false, error: 'no_sign_in' }
  return { ok: true, stage }
}

/** The stage a successful `finish_login` means: Zomato still has its Hyperpure hop to make. */
export function stageAfterSignedIn(channel: string): LoginStage {
  return channel === 'zomato' ? 'bringing_hyperpure' : 'done'
}

/** The narrow slice of a Supabase client this needs. */
interface StageWriter {
  from(table: 'aggregator_channel_credentials'): {
    update(values: { login_stage: LoginStage; login_stage_at: string }): {
      eq(column: 'channel', value: string): PromiseLike<{ error: { code?: string } | null }>
    }
  }
}

/**
 * Record a stage, best effort.
 *
 * A sign-in is worth more than its narration: a failed write is logged and the
 * action it rode on carries on. Never throws.
 */
export async function recordLoginStage(
  service: StageWriter,
  channel: string,
  stage: LoginStage,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const { error } = await service
      .from('aggregator_channel_credentials')
      .update({ login_stage: stage, login_stage_at: now.toISOString() })
      .eq('channel', channel)
    if (error) {
      console.error('could not record the sign-in stage', { stage, code: error.code })
      return false
    }
    return true
  } catch (cause) {
    console.error('could not record the sign-in stage', { stage, cause: String(cause) })
    return false
  }
}
