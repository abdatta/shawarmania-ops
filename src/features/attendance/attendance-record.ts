import type { AttendanceDecision, AttendanceEvent, AttendanceRecord } from '@/data-access/adapters'
import { formatTime, instantOnBusinessDay } from '@/domain'

/**
 * What a stored attendance row means, derived in one place.
 *
 * Three of the states a day can be in are not columns. "Waiting for a manager",
 * "late" and "absent because nobody came" are all facts the stored evidence and
 * the outlet's clock already answer, and `attendance_status` holds payroll
 * outcomes rather than process states (design D1). They must read identically
 * on the manager's day view, on the person view and on the employee's own
 * history, so all three ask here.
 *
 * **A day belongs to the person, not to the shop**
 * (attendance-one-day-per-person, design D2). Since that change a person holds
 * at most one attendance row per business date across every outlet, and this
 * module is the only place that knows it. No view derives absence, collapses
 * rows, or reasons about outlets on its own.
 *
 * That is deliberate, because the owner accepted the rule on the condition that
 * restoring split shifts later stays cheap. **What reversing it costs:** two
 * migration statements (swap `attendance_one_per_person_day` back to
 * `attendance_one_per_person_outlet_day`, the mirror of what
 * 20260801000001 did) plus this module — `readDay` goes back to judging one
 * outlet at a time, `elsewhere` and `tallyDays`' per-date collapse come out, and
 * the `attendance_elsewhere` function loses its only caller. Rows written under
 * one-per-person-per-day already satisfy one-per-person-per-outlet-per-day, so
 * nothing needs repairing. The cost is here on purpose: it is one file, and a
 * grep for `DayReading` finds every screen that would need re-rendering.
 */

export function isOutOfFence(event: AttendanceEvent | null, radiusMetres: number): boolean {
  return event !== null && event.distanceMetres !== null && event.distanceMetres > radiusMetres
}

/**
 * A phone check-in that carried no position at all — permission refused, or no
 * fix. There is nothing for a manager to weigh but the person's word, which is
 * worth saying out loud on the surfaces.
 */
export function isUnverifiable(event: AttendanceEvent | null): boolean {
  return event !== null && event.latitude === null && event.source === 'phone'
}

/** The fence could not be evaluated: no coordinates, or an outlet never surveyed. */
export function isUnevaluated(event: AttendanceEvent | null): boolean {
  return event !== null && event.distanceMetres === null
}

/**
 * A check-in nobody has vouched for yet.
 *
 * Mirrors the database: an unapproved check-in is stored `absent` whatever its
 * distance, and an approval is what turns it into `present`. Reading the stored
 * status rather than re-judging the fence is what keeps this honest about
 * history too — a day recorded before approval was required carries a check-in,
 * no approval, and status `present`, and it reads as what it is rather than as
 * something that has been waiting for weeks (design D10).
 *
 * A day a manager deliberately marked `absent` while a check-in exists is
 * indistinguishable from a waiting one, which it also was under the old
 * override rule. The way to record "arrived but not counted" is `half_day`.
 */
export function isWaitingForApproval(record: AttendanceRecord): boolean {
  return record.currentAttemptId !== null
}

/**
 * Was the approver standing at the outlet when they vouched for this day?
 *
 * Derived rather than stored, so it cannot disagree with the coordinates it is
 * derived from. An unsurveyed outlet has no position to judge anyone against, so
 * every approval there reads as unverified rather than as on-site — which is
 * honest, and matches how check-ins already behave there.
 */
export function wasApprovedOnSite(record: AttendanceRecord, radiusMetres: number): boolean {
  const { approval } = record
  return (
    approval !== null && approval.distanceMetres !== null && approval.distanceMetres <= radiusMetres
  )
}

/**
 * Did this arrival land after the deadline that applied to it?
 *
 * Judged against the deadline stamped on the row, never the outlet's current
 * one, so editing an outlet's rule cannot retroactively relabel a recorded day.
 * A row with no stamped deadline predates the rule and is never called late.
 *
 * @param cutover the row's outlet's `business_day_cutover`, which decides which
 *   calendar day the deadline falls on
 */
export function isLate(record: AttendanceRecord, cutover: string): boolean {
  if (!record.checkIn || record.arrivalDeadline === null) return false
  const deadline = instantOnBusinessDay(record.businessDate, record.arrivalDeadline, cutover)
  return record.checkIn.at > deadline
}

/**
 * How a day reads, whether or not a row exists for it.
 *
 * The absent-by-deadline rule lives here and nowhere else. Nothing writes those
 * rows — no scheduled job manufactures a row per assigned person per day, races
 * the late check-in it is trying to describe, or needs a backfill for every past
 * day (design D6). A stored row always wins, so a day marked `leave` stays
 * leave.
 */
export type DayReading =
  /** Nothing recorded, and no deadline that could still see them has passed. */
  | { kind: 'not-yet-arrived' }
  /**
   * Nothing recorded anywhere, and every deadline has passed. No row exists.
   *
   * Carries the deadline it was judged against, because the surfaces name it and
   * it is otherwise worked out and thrown away here. With several outlets it is
   * the latest of them — the same instant that decided the absence.
   */
  | { kind: 'absent'; deadline: string }
  /**
   * Nothing recorded at the outlets in scope, and the database says they hold a
   * row somewhere the reader cannot see. Carries no outlet, time or evidence,
   * because the answer behind it carries none (design D3).
   */
  | { kind: 'elsewhere' }
  /** Recorded, and waiting for a manager to settle it. */
  | { kind: 'waiting'; record: AttendanceRecord }
  /** Recorded and settled. The row's own status is the answer. */
  | { kind: 'recorded'; record: AttendanceRecord }

/** Everything about an outlet that bears on how a day reads. */
export interface OutletClock {
  arrival_deadline: string
  business_day_cutover: string
}

/**
 * The last moment any of these outlets could still see this person arrive.
 *
 * With one outlet this is just its deadline. With several it is the latest of
 * them, which is the only honest answer: somebody staffed at a shop that closes
 * its arrivals at 20:00 has not failed to turn up at 13:30 merely because the
 * other shop they sometimes work at had given up by then. Nothing global is
 * assumed about the clocks (design D7) even though production's two outlets
 * currently agree.
 */
function lastDeadline(clocks: readonly OutletClock[], businessDate: string): string | null {
  let latest: string | null = null
  for (const clock of clocks) {
    const at = instantOnBusinessDay(
      businessDate,
      clock.arrival_deadline,
      clock.business_day_cutover,
    )
    if (latest === null || at > latest) latest = at
  }
  return latest
}

/** What the caller knows beyond the row itself. */
export interface DayContext {
  now?: Date
  /**
   * Does the database say this person holds a row at an outlet outside the
   * reader's scope on this date (design D3)? Only ever true when `record` is
   * null, because one person holds one row a day.
   */
  accountedForElsewhere?: boolean
}

/**
 * @param clocks every outlet whose deadline could still see this person arrive
 *   on this date — for a roll-call, the outlets in scope they are staff at. A
 *   day is not about one shop, so this is plural even where the caller has one.
 */
export function readDay(
  record: AttendanceRecord | null,
  clocks: readonly OutletClock[],
  businessDate: string,
  { now = new Date(), accountedForElsewhere = false }: DayContext = {},
): DayReading {
  if (record) {
    return isWaitingForApproval(record) ? { kind: 'waiting', record } : { kind: 'recorded', record }
  }
  // Ahead of the deadline, because it beats "not yet arrived" as well as
  // "absent": they have arrived, just not here. Saying otherwise would be a
  // false statement about a day somebody is paid for.
  if (accountedForElsewhere) return { kind: 'elsewhere' }
  // No row means no stamped deadline, so the outlets' current ones are used.
  // Acceptable and stated in the spec: whether somebody turned up does not turn
  // on the exact minute the rule was set to.
  const deadline = lastDeadline(clocks, businessDate)
  if (deadline === null) return { kind: 'not-yet-arrived' }
  return now.toISOString() > deadline ? { kind: 'absent', deadline } : { kind: 'not-yet-arrived' }
}

export const STATUS_LABELS = {
  present: 'Present',
  absent: 'Absent',
  half_day: 'Half day',
  leave: 'Leave',
} as const satisfies Record<AttendanceRecord['status'], string>

/**
 * Does this row actually count as an absence?
 *
 * Not the same question as `status === 'absent'`. Every unapproved check-in is
 * stored absent, so a row waiting for its first decision reads absent in the
 * column and is not an absence — it is a claim nobody has settled. What makes a
 * waiting row absent too is a decision already behind it: the denied day
 * somebody has since checked in again on, which stays absent until the new
 * attempt is approved.
 *
 * Three readers asked this separately before it had a name — the verdict, the
 * tally and the reason beneath it — which is three chances to disagree about
 * whether somebody was paid for a day.
 */
export function isAbsence(record: AttendanceRecord): boolean {
  if (record.status !== 'absent') return false
  return !isWaitingForApproval(record) || record.latestDecisionId !== null
}

/**
 * One sentence for how a day stands, from the evidence rather than the bare
 * status — so "Absent" never appears next to a check-in time with no
 * explanation of why the two disagree.
 */
export function describeDay(record: AttendanceRecord): string {
  if (isWaitingForApproval(record)) {
    return isAbsence(record)
      ? 'Absent — new check-in awaiting manager review'
      : 'Waiting for a manager to approve'
  }
  // An approved day says "Present" here and carries its approval in the note
  // beneath it — every surface renders both, and two lines each opening
  // "Approved by" reads like a stutter rather than like two facts.
  return STATUS_LABELS[record.status]
}

/** How a derived, row-less day reads. Worded to match `describeDay`'s register. */
export function describeReading(reading: DayReading): string {
  switch (reading.kind) {
    case 'not-yet-arrived':
      return 'Not yet arrived'
    case 'absent':
      return 'Absent'
    // No outlet is named, and none can be: the fact crossing the boundary is
    // one bit wide (design D3).
    case 'elsewhere':
      return 'Working at another outlet'
    default:
      return describeDay(reading.record)
  }
}

/**
 * Why a day counts as absent, and in whose words.
 *
 * `note` is the manager's own sentence where the record holds one, kept apart
 * from `text` so it can be rendered as a quotation rather than folded into
 * prose the app wrote.
 */
export interface AbsenceReason {
  text: string
  note: string | null
}

/**
 * Who is reading, and whose day they are reading.
 *
 * Two independent questions, and the sentence turns on both: a manager reading
 * their own decision should be told "you denied it", and the person the day
 * belongs to should be told "your check-in" — while the manager reading somebody
 * else's day must be told neither, because "you did not check in" said to the
 * wrong reader is a false statement about a person's pay.
 *
 * Both are answered from ids the surfaces already hold, rather than from a
 * per-surface voice flag. A flag can be passed wrongly; an id cannot disagree
 * with itself.
 */
export interface AbsenceAudience {
  /** The signed-in reader. */
  viewerId: string | null
  /** Whose day this card is about — the derived readings carry no row to ask. */
  subjectId: string | null
}

/**
 * Did this decision make the day absent, or merely adjust one that already was?
 *
 * The distinction has now caught two kinds out, so it is named rather than
 * spelled as a list of kinds a third could quietly join.
 *
 * `allow_retry` and `correct_absent` on an already-absent day both record
 * `absent` as their new status while deciding nothing about the outcome — they
 * open or close the door to another check-in. Treating either as a cause means
 * the newest one wins and the denial behind it stops being shown, so somebody
 * reading "why am I absent" is told "a manager kept it absent", which answers
 * nothing. A denial is always the real answer in that sequence, and closing a
 * retry is still in the history below.
 *
 * `deny` needs its own arm: every unapproved check-in is stored `absent`, so a
 * denial's previous status is `absent` too, and going by status alone would drop
 * the one kind that matters most.
 */
function madeTheDayAbsent(decision: AttendanceDecision): boolean {
  if (decision.kind === 'deny') return true
  if (decision.kind === 'correct_absent' || decision.kind === 'absent_allow_retry') {
    return decision.previousStatus !== 'absent'
  }
  return false
}

/**
 * The cause behind an absence, stated once for every surface that renders one.
 *
 * "Absent" on its own is the verdict somebody is most likely to dispute and the
 * one they could least account for: the person reading their own month could not
 * tell a forgotten check-in from a manager declining the one they made, and the
 * manager reading the same day had to open the history timeline and scan it for
 * the reason they themselves typed. Both now read the same sentence, from here,
 * because asymmetric visibility in a monitoring feature is how it becomes
 * something staff resent.
 *
 * Derived, never stored. Every fact it states is already on the row and already
 * visible to both readers, so nothing crosses a boundary that did not cross it
 * before.
 *
 * Null for every day that is not an absence — including a row waiting for its
 * first decision, which is stored absent and is not one (`isAbsence`). Telling
 * somebody a day "counts as absent" underneath a verdict reading "waiting for a
 * manager" would be contradicting the line above it.
 *
 * Null too for the other two derived readings: nothing is wrong on a day nobody
 * has arrived for yet, and `elsewhere` is one bit wide on purpose (design
 * D3) — there is nothing more to say about it without inventing it.
 */
export function explainAbsence(
  reading: DayReading,
  { viewerId, subjectId }: AbsenceAudience,
): AbsenceReason | null {
  /*
    Second person only when the reader is provably the subject. Both ids null —
    which is what a caller with nothing to say passes — must not read as a match,
    or every day would address a reader who may be anybody.
  */
  const own = viewerId !== null && subjectId === viewerId

  /*
    The deadline is named rather than described. "The deadline for arriving has
    passed" makes the reader ask which deadline; the time answers it in three
    words. Neither sentence names the day, because the card's own heading is the
    date, nor the person, because the heading is their name.
  */
  if (reading.kind === 'absent') {
    const by = formatTime(reading.deadline)
    return {
      text: own ? `You did not check in by ${by}.` : `No check-in by ${by}.`,
      note: null,
    }
  }
  if (reading.kind !== 'recorded' && reading.kind !== 'waiting') return null

  const { record } = reading
  if (!isAbsence(record)) return null

  // The last decision that made the day absent, as opposed to the last one that
  // touched it.
  const decision = [...record.decisions]
    .filter(madeTheDayAbsent)
    .sort((a, b) => a.at.localeCompare(b.at))
    .at(-1)

  /*
    No decision on this row asserts the absence. The case that reaches production
    is an absent row from before 20260802000001, which its backfill deliberately
    skipped: that migration inserted a decision only for a row with an approver or
    a status other than absent, so a day nobody had settled kept no decision and
    no actor to name. A row whose only decisions touch retry permission lands here
    too, and truthfully — nothing on it says who decided the outcome.

    Note what this is NOT, so nobody adds a branch for it: `legacy_outcome`.
    That kind is the same migration's `else`, reachable only when there is no
    approver, which under the same filter forces a status other than absent — so
    a legacy outcome cannot be an absence, here or in production. It still exists
    for present, half-day and leave rows, where the history timeline names it.
  */
  // One sentence for both readers: with the day no longer named there is nothing
  // left to make possessive.
  if (!decision) {
    return {
      text: 'Recorded absent, with no manager decision explaining it.',
      note: null,
    }
  }

  /*
    English past tense does not inflect for person — "you denied" and "Priya
    denied" take the same verb — so the actor is one substitution rather than a
    second set of sentences. That is what keeps this at three templates instead of
    twelve, and it is why the templates below read identically in both voices.
  */
  const by =
    decision.by !== null && decision.by === viewerId ? 'You' : (decision.byName ?? 'A manager')

  // Denied: a check-in existed and a manager rejected it.
  if (decision.kind === 'deny') {
    return {
      text: `${by} denied ${own ? 'your' : 'the'} check-in.`,
      note: decision.reason,
    }
  }
  /*
    Corrected: the day already counted as something and a manager changed it.
    Naming what it was before is what tells this apart from a denial, without
    asking the reader to weigh two similar sentences — and the row already knows.

    `previousStatus` cannot be `absent` here: `madeTheDayAbsent` keeps only the
    corrections that moved the outcome, so a manager merely closing a retry no
    longer reaches this and no longer displaces the denial that did.
  */
  return {
    text: `${by} changed this from ${STATUS_LABELS[decision.previousStatus].toLowerCase()} to absent.`,
    note: decision.reason,
  }
}

/** Present, late, absent and waiting across a range — the person view's summary. */
export interface AttendanceTally {
  present: number
  late: number
  absent: number
  waiting: number
}

/**
 * Counted once per business date, whatever outlet each day was worked at.
 *
 * The summary exists so somebody can compute pay by hand, and a day worked is
 * one day however many shops the month touched. The rows are already one per
 * date since the collapse, so the guard below is belt and braces rather than
 * the mechanism — but it is the difference between a summary that is a day
 * count and one that is a row count, and only one of those is payable.
 *
 * A day read as `elsewhere` counts as nothing here, deliberately. It is not a
 * present day (this reader cannot see that it was approved) and it is certainly
 * not an absent one. In practice it never reaches a tally at all: the by-staff
 * read already spans every outlet the reader may see, so there is no elsewhere
 * left to point at.
 */
export function tallyDays(
  readings: readonly { businessDate: string; reading: DayReading; late: boolean }[],
): AttendanceTally {
  const tally: AttendanceTally = { present: 0, late: 0, absent: 0, waiting: 0 }
  const counted = new Set<string>()
  for (const { businessDate, reading, late } of readings) {
    if (counted.has(businessDate)) continue
    counted.add(businessDate)
    if (late) tally.late += 1
    if (reading.kind === 'absent') {
      tally.absent += 1
    } else if (reading.kind === 'waiting') {
      tally.waiting += 1
      if (isAbsence(reading.record)) tally.absent += 1
    } else if (reading.kind === 'recorded') {
      if (reading.record.status === 'present') tally.present += 1
      else if (isAbsence(reading.record)) tally.absent += 1
    }
  }
  return tally
}
