import type { AggregatorRunSummary, AggregatorSyncRunRow, AggregatorRunOutcome } from '../adapters'

/**
 * A hundred runs' worth of history, so the surface can be judged before it has
 * one (#48).
 *
 * **This fixture is the check on the rule this change overturns.** The spec
 * used to say a row is an event rather than a run, and gave a sound reason: two
 * channels reading twice a day is well over a hundred runs a month, nearly all
 * of them quiet. What replaces that reason is compression plus laziness — so
 * the demo has to carry the case that would break it, not a tidy dozen.
 *
 * What is in here, and why each one is:
 *
 *  - **A long quiet stretch**, which is what the collapse rule is for. If sixty
 *    scheduled reads that moved nothing do not read as a handful of lines, the
 *    compression is not working and the surface got worse.
 *  - **A failure storm** — a session that died at 4:10 am and failed every
 *    scheduled read until noon. The noisiest thing this list will ever produce,
 *    and the thing healing hides today.
 *  - **The run that healed it**, immediately after, so the storm being still
 *    visible is demonstrable rather than asserted.
 *  - **Runs that moved figures**: a first measurement, a revision, a week that
 *    settled, a supply read.
 *  - **Runs the owner asked for**, four in a row and quiet, which must render
 *    as four lines however identical they are.
 *  - **A run refused over money** and **a run holding for a code**, neither of
 *    which the surface could show at all before this change.
 *  - **Runs predating summaries**, carrying outcome and time and nothing else,
 *    which is what the honest cut-off line is about.
 *
 * Every channel gets its own, seeded differently, because two independent
 * accounts with the same history relabelled would demonstrate the one thing
 * this surface must never imply.
 */

/** Deterministic, so a walkthrough shows the same page twice. */
function summary(parts: Partial<AggregatorRunSummary> = {}): AggregatorRunSummary {
  return {
    days: [],
    cyclesSettled: [],
    supplyOrders: { added: 0, amended: 0 },
    datesWithoutARecordedDay: [],
    ...parts,
  }
}

interface Seed {
  outletId: string
  channel: 'zomato' | 'swiggy'
  /** An ISO instant this many minutes ago. */
  at: (minutesAgo: number) => string
  /** A business date this many days ago. */
  day: (daysAgo: number) => string
}

export function seedRunHistory({ outletId, channel, at, day }: Seed): AggregatorSyncRunRow[] {
  const rows: AggregatorSyncRunRow[] = []
  let serial = 0

  /**
   * One run, oldest first.
   *
   * `summary` defaults to the empty one — a run that ran and moved nothing —
   * and that is what a FAILED run carries too: it ran, it wrote nothing, and it
   * said so. Only `null` means the run predates the recording, which is a
   * different sentence and the surface draws a line where it starts.
   */
  const run = (
    minutesAgo: number,
    outcome: AggregatorRunOutcome,
    extra: {
      detail?: string | null
      startedBy?: 'schedule' | 'owner' | null
      summary?: AggregatorRunSummary | null
      running?: boolean
    } = {},
  ) => {
    serial += 1
    rows.push({
      id: `${channel}-${outletId}-run-${serial}`,
      outletId,
      channel,
      startedAt: at(minutesAgo),
      finishedAt: extra.running ? null : at(minutesAgo - 1),
      outcome,
      detail: extra.detail ?? null,
      startedBy: extra.startedBy === undefined ? 'schedule' : extra.startedBy,
      summary: extra.summary === undefined ? summary() : extra.summary,
    })
  }

  const HOUR = 60
  const DAY = 24 * HOUR
  // Swiggy's story is offset from Zomato's so that switching channels in demo
  // shows two independent histories rather than the same one relabelled.
  const shift = channel === 'swiggy' ? 3 * HOUR : 0

  // ── Oldest: the runs that predate summaries ───────────────────────────────
  // Outcome and time and nothing else, which is what a pre-#48 row honestly is.
  // Thirty of them, so the cut-off line has a real edge to sit on.
  // Counting DOWN in minutes-ago, so each run is pushed after the one before
  // it in time. `run` appends and the whole list is reversed at the end; a loop
  // that walked the other way would interleave a fortnight into last night.
  for (let i = 30; i >= 1; i -= 1) {
    run(30 * DAY + i * 12 * HOUR + shift, 'ok', { startedBy: null, summary: null })
  }

  // ── A quiet stretch: the majority case, and the reason for the collapse rule
  for (let i = 60; i >= 1; i -= 1) {
    run(10 * DAY + i * 8 * HOUR + shift, 'ok')
  }

  // ── A day that moved: a first measurement and a settled week ──────────────
  run(9 * DAY + shift, 'ok', {
    summary: summary({
      days: [
        {
          businessDate: day(10),
          movement: 'first_measured',
          from: null,
          to: { revenuePaise: 1_284_500, commissionPaise: 359_660, netPaise: 924_840 },
        },
      ],
      datesWithoutARecordedDay: [day(10)],
    }),
  })
  run(8 * DAY + shift, 'ok', {
    summary: summary({
      cyclesSettled: [
        {
          cycleStart: day(16),
          cycleEnd: day(10),
          computedPaise: 1_064_270,
          statedPayoutPaise: 1_064_270,
        },
      ],
    }),
  })

  // ── The cancellation-refund case: a day that legitimately grew after payout
  run(7 * DAY + shift, 'ok', {
    summary: summary({
      days: [
        {
          businessDate: day(12),
          movement: 'revised',
          from: { revenuePaise: 941_000, commissionPaise: 263_480, netPaise: 677_520 },
          to: { revenuePaise: 928_650, commissionPaise: 260_022, netPaise: 668_628 },
        },
      ],
    }),
  })

  // ── A week that would not add up ──────────────────────────────────────────
  run(6 * DAY + shift, 'reconciliation_failed', {
    detail: `The orders add up to ₹144.49 less than ${channel === 'swiggy' ? 'Swiggy' : 'Zomato'} says it paid.`,
  })

  // ── Four reads the owner asked for, all quiet ─────────────────────────────
  // They must render as four lines: the owner tapped four times and will look
  // for each by its time.
  for (let i = 4; i >= 1; i -= 1) {
    run(5 * DAY + i * 7 + shift, 'ok', { startedBy: 'owner' })
  }

  // ── The session dies at 4:10 am, and every read fails until noon ──────────
  const stormStart = 4 * DAY + shift
  for (let i = 9; i >= 1; i -= 1) {
    run(stormStart - (9 - i) * 55, 'session_lapsed', {
      detail:
        channel === 'swiggy'
          ? 'Swiggy ended this session. It needs a one time password to get back in.'
          : 'Zomato signed this account out. It needs a one time password to get back in.',
    })
  }

  // ── The repair, and the run that followed it ──────────────────────────────
  run(stormStart - 9 * 55 - 20, 'awaiting_one_time_password', {
    detail: 'Waiting for the code sent to the account’s phone.',
    startedBy: 'owner',
  })
  run(stormStart - 9 * 55 - 40, 'ok', {
    startedBy: 'owner',
    summary: summary({
      days: [
        {
          businessDate: day(5),
          movement: 'first_measured',
          from: null,
          to: { revenuePaise: 1_102_300, commissionPaise: 308_644, netPaise: 793_656 },
        },
        {
          businessDate: day(4),
          movement: 'first_measured',
          from: null,
          to: { revenuePaise: 987_450, commissionPaise: 276_486, netPaise: 710_964 },
        },
      ],
    }),
  })

  // ── A supply read, on the channel that tows one ───────────────────────────
  if (channel === 'zomato') {
    run(3 * DAY + shift, 'ok', { summary: summary({ supplyOrders: { added: 3, amended: 1 } }) })
  }

  // ── And back to quiet, up to this morning ─────────────────────────────────
  // Down to within the hour, so the date rail always has a `Today` on it.
  for (let i = 6; i >= 1; i -= 1) {
    run((i - 1) * 9 * HOUR + 25 + shift, 'ok')
  }

  // Newest first, which is how it is read and how it is paged.
  return rows.reverse()
}
