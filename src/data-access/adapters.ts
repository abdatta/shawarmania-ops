import type { MovementType, ProfitBasis, ProfitEstimate, SyncStateKind } from '@/domain'
import type { PositionReading } from '@/lib/geolocation'

import type { Tables } from './database.types'

/**
 * The adapter seam — one typed interface per domain area, two implementations
 * each: a Supabase adapter (real data) and a mock adapter (fixtures typed
 * from the generated schema types). Screens depend on these interfaces and
 * on nothing below them; swapping an implementation must never touch a
 * screen. See docs/DEMO_MODE.md and design D2 of demo-mode-and-app-shell.
 *
 * Interfaces are added here by the `ui-*` change that needs them, shaped by
 * real screen requirements — not designed speculatively. `outlets` is the
 * exemplar the shells themselves consume.
 */

/**
 * A position captured standing at the counter, with the quality of the fix that
 * produced it. The accuracy is stored, not just checked — an outlet's position
 * judges every future check-in, and a reader deserves to know how good the
 * reading behind it was.
 */
export interface OutletLocation {
  latitude: number
  longitude: number
  accuracyMetres: number
  radiusMetres: number
}

/**
 * A refusal a surface can say something useful about, rather than putting a
 * raw Postgres message in front of someone standing at a counter. The `code`
 * is machine-readable; anything unrecognised surfaces as a generic failure so
 * that an internal string never leaks into the UI.
 *
 * One base for every domain: the per-domain classes below extend it and keep
 * their names, and a surface that catches `DataActionError` catches all of
 * them (design D8).
 */
export class DataActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DataActionError'
  }
}

/** A new outlet. `code` is the short handle people say out loud. */
export interface NewOutlet {
  code: string
  name: string
  locationLabel: string
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  district?: string | null
  pincode?: string | null
  phone?: string | null
  /** `HH:MM`, the per-outlet business-day boundary. */
  businessDayCutover?: string
  /**
   * `HH:MM`, the time by which staff are expected to have arrived. Defaults to
   * 13:00. Editing it applies to arrivals from then on and never
   * retrospectively, because each attendance row stamps the deadline that
   * applied to it.
   */
  arrivalDeadline?: string
}

export type OutletPatch = Partial<
  NewOutlet & {
    isActive: boolean
  }
>

/**
 * One thing still attached to an outlet, and how much of it. `table` is a
 * database identifier — `profiles`, `counter_devices` — because the set is
 * read from the schema's own foreign keys rather than from a list somebody
 * maintains, and a table added later has no English phrase waiting for it. The
 * surface translates the ones it knows and shows the rest as they are: falling
 * back to an identifier is acceptable, omitting a table is not.
 */
export interface OutletReference {
  table: string
  count: number
}

export interface OutletsAdapter {
  /**
   * Outlets, for the surfaces a role can see. Active only by default, because
   * every caller but the owner's management view is asking "which outlets are
   * trading?" — an assignment list that offers a closed shop is offering a
   * mistake.
   */
  listOutlets(options?: { includeInactive?: boolean }): Promise<Tables<'outlets'>[]>
  /** One outlet by id, or null if it does not exist. */
  getOutlet(id: string): Promise<Tables<'outlets'> | null>
  /** Super Admin only — enforced by `outlets_insert`, not by the caller. */
  createOutlet(outlet: NewOutlet): Promise<Tables<'outlets'>>
  /** Super Admin only — enforced by `outlets_update`. */
  updateOutlet(id: string, patch: OutletPatch): Promise<Tables<'outlets'>>
  /**
   * Record an outlet's surveyed position. Super Admin only — enforced by the
   * `outlets_update` policy, not by whether this method is offered (design D4).
   */
  saveLocation(id: string, location: OutletLocation): Promise<Tables<'outlets'>>
  /**
   * Remove an outlet entirely. Super Admin only, and only while nothing
   * anywhere references it — both enforced in Postgres, by `outlets_delete`
   * and by seventeen foreign keys of which not one cascades.
   *
   * **`outlets` is the only table in this schema any client may delete from**,
   * which is why no other adapter here has a method like this and why adding
   * one would be a schema change rather than an adapter change. The rule is
   * that history is voided, deactivated or corrected rather than removed; an
   * outlet nothing references has no history, which is the entire argument for
   * the exception and the reason it stops at this table.
   *
   * Closing an outlet is the answer for one that traded. This is for one that
   * should never have existed.
   */
  deleteOutlet(id: string): Promise<void>
  /**
   * What is still attached to an outlet, for explaining a refused delete.
   * Returns only non-empty things, so an empty array means the outlet is
   * deletable right now. Super Admin only.
   */
  outletReferences(id: string): Promise<OutletReference[]>
}

export type AppRole = Tables<'assignments'>['role']

/**
 * One place a person works, as one role.
 *
 * Since multi-outlet-people this is where authority lives: a person holds a
 * SET of these rather than a single role-and-outlet pair, and every policy in
 * the database answers by membership in that set. `endedOn` null means live;
 * an ended assignment is kept, because rows written under it have to stay
 * explicable.
 *
 * `outletId` is null exactly for the business-wide `super_admin` role — the
 * same invariant the database checks.
 */
export interface Assignment {
  id: string
  role: AppRole
  outletId: string | null
  startedOn: string
  endedOn: string | null
}

/** The live ones, which are the only ones that confer anything. */
export function liveAssignments(assignments: readonly Assignment[]): Assignment[] {
  return assignments.filter((a) => a.endedOn === null)
}

/**
 * Seniority, for choosing which shell to land somebody in. **Not a hierarchy
 * of permissions** — a Franchise Admin assignment at Kalyani confers nothing at
 * Kanchrapara however senior it is (the role-hierarchy idea was rejected on
 * 2026-07-28). This orders shells, and nothing else.
 */
const ROLE_SENIORITY: Record<AppRole, number> = {
  super_admin: 4,
  franchise_admin: 3,
  biller: 2,
  employee: 1,
}

/** The highest role a person holds live, or null if they hold none. */
export function highestRole(assignments: readonly Assignment[]): AppRole | null {
  return liveAssignments(assignments).reduce<AppRole | null>(
    (best, a) => (best === null || ROLE_SENIORITY[a.role] > ROLE_SENIORITY[best] ? a.role : best),
    null,
  )
}

/** The outlets this person holds a live assignment at, in the given role. */
export function outletsForRole(assignments: readonly Assignment[], role: AppRole): string[] {
  return [
    ...new Set(
      liveAssignments(assignments)
        .filter((a) => a.role === role && a.outletId !== null)
        .map((a) => a.outletId as string),
    ),
  ]
}

/** Every outlet this person works at, in any role. */
export function assignedOutlets(assignments: readonly Assignment[]): string[] {
  return [
    ...new Set(
      liveAssignments(assignments)
        .filter((a) => a.outletId !== null)
        .map((a) => a.outletId as string),
    ),
  ]
}

/**
 * One person on the People surface: the account, its invite state, its job
 * title, and the assignments that place it. There is exactly one record per
 * person; a login and a staff-list membership are the same thing, and working
 * at two outlets does not make a second of either.
 */
export interface AccountSummary {
  id: string
  fullName: string
  /**
   * Canonical product username, returned through the privileged account
   * function. The reserved provider alias is never exposed.
   */
  username: string | null
  /** Private alternate identifier, visible only for authorized Super Admin operations. */
  accountEmail: string | null
  phone: string | null
  isActive: boolean
  /** Free-text job label ("Griller"), distinct from the app-capability role. */
  roleTitle: string | null
  /**
   * Where this person works and as what — every assignment, live and ended.
   * Ended ones are kept because the rows they produced have to stay
   * explicable, and because the People surface shows "left this outlet in
   * March" rather than nothing at all.
   *
   * A caller sees only the assignments their own authority reaches: a manager
   * gets the ones at outlets they manage, and **not** the other outlet's
   * assignment of somebody who works at both — that row is the other outlet's
   * data.
   */
  assignments: Assignment[]
  /**
   * The outstanding invite, if there is one. Never carries the code — the
   * hash column is not readable by any client (see the account_invites
   * migration), and the code itself exists only in the response that issued
   * it. "Pending since Tuesday" is all a list can honestly show.
   */
  invite: { expiresAt: string } | null
}

/**
 * A new person, and the one place they start working. Creating somebody is
 * still one act — it writes the account and their first assignment together,
 * and an account that reached the list with neither would be a person who
 * exists and works nowhere.
 */
export interface NewAccount {
  fullName: string
  username: string
  /** Required exactly for `super_admin`; null for every outlet-scoped role. */
  accountEmail?: string | null
  phone?: string | null
  role: AppRole
  /** Empty exactly for `super_admin`; every scoped role needs one or more. */
  outletIds: string[]
  roleTitle?: string | null
  /** The assignment's start date, not a fact about the person. */
  joinedOn?: string | null
}

/**
 * The staff facts an admin edits as their own session under Row-Level
 * Security — unlike every other account write, which is privileged. Access
 * Account access and placement are deliberately absent: each has its own
 * boundary.
 */
export type StaffFactsPatch = Partial<{
  fullName: string
  roleTitle: string | null
}>

/**
 * Is this person **staff** at this outlet — somebody whose arrival the outlet
 * tracks (owner-reaches-every-outlet, design D3)?
 *
 * This is the attendance roll-call's question, and it is deliberately narrower
 * than "is assigned here". It used to count a Franchise Admin assignment too,
 * which put every manager on their own outlet's roll-call and put the owner
 * there the moment they granted themselves a manager assignment to see the
 * screen at all. Nobody records a manager's arrival, and a list of people who
 * are not being tracked is a list a manager has to read past.
 *
 * A manager or an owner who **also** holds a staff assignment here qualifies
 * through that assignment, which is exactly the case where their attendance is a
 * real thing.
 *
 * Stated as a rule rather than as a list of roles that are not staff, so a role
 * added to the enum does not silently join the roll-call.
 *
 * The people surfaces ask no such question: what they may see is decided by the
 * policies, and a manager belongs on their outlet's people list whether or not
 * anybody records their arrival.
 */
export function isStaffAt(account: Pick<AccountSummary, 'assignments'>, outletId: string): boolean {
  return liveAssignments(account.assignments).some(
    (a) => a.outletId === outletId && a.role === 'employee',
  )
}

/** The one-time code, returned once and never retrievable again. */
export interface IssuedCode {
  profileId: string
  username: string
  code: string
  expiresAt: string
}

/**
 * A refusal from the privileged account functions, whose `code` is the
 * machine-readable one the function itself returned.
 */
export class AccountActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'AccountActionError'
  }
}

/**
 * People management as the admin surfaces need it. Identity and access writes
 * are privileged operations that run server-side with the service-role key —
 * the adapter is the seam in front of them, not the thing doing them. Staff
 * facts are the exception: they are the admin's own RLS write, exactly as
 * roster edits always were.
 */
export interface AccountsAdapter {
  /**
   * People the caller may see: everybody for the Super Admin, and for a
   * Franchise Admin the people live at an outlet they manage.
   */
  listAccounts(): Promise<AccountSummary[]>
  /** One step creates a working person: account, every assignment, issued code. */
  provision(account: NewAccount): Promise<IssuedCode>
  reissue(profileId: string): Promise<IssuedCode>
  setActive(profileId: string, isActive: boolean): Promise<void>
  /**
   * Place a person at an outlet. The privileged path, because authority is
   * re-derived from the caller's token — a manager may place somebody only at
   * an outlet they manage, and only as a Biller or Employee.
   *
   * **Self-assignment is refused except for one narrow case**: a Super Admin
   * may place themselves at an outlet, and nobody may ever grant themselves
   * the owner role. The database enforces both; this is the seam in front.
   */
  grantAssignment(input: {
    personId: string
    role: AppRole
    outletId: string | null
    accountEmail?: string | null
  }): Promise<IssuedCode | null>
  /**
   * End a placement. Never a delete — the assignment stays, with its end date,
   * because the rows it produced have to remain explicable. Refused for the
   * last live Super Admin assignment.
   */
  endAssignment(assignmentId: string): Promise<IssuedCode | null>
  /**
   * Correct the username an account signs in with. Any outstanding one-time
   * code survives because it is bound to the account, not the username.
   */
  changeUsername(profileId: string, username: string): Promise<void>
  setAccountEmail(profileId: string, accountEmail: string): Promise<void>
  /**
   * Edit the staff facts — the admin's own session under RLS, not the
   * privileged function. The database refuses a cross-outlet edit, a
   * non-owner changing a staff code, and the blanking of an issued one.
   */
  updateStaffFacts(profileId: string, patch: StaffFactsPatch): Promise<AccountSummary>
  /**
   * Failed activation attempts across the whole endpoint in the current
   * window. Null when the caller may not ask — which is every role but the
   * Super Admin, and is an answer rather than a failure (design D10).
   */
  failedActivations(): Promise<number | null>
}

/**
 * Above this many failed activations in a window, somebody should look. A real
 * onboarding contributes nothing at all — only failures are counted — so a
 * two-figure number here is already unusual rather than merely busy.
 */
export const FAILED_ACTIVATION_NOTICE = 25

// ─────────────────────────────────────────────────────────────────────────────
// Attendance.

export type AttendanceStatus = Tables<'attendance'>['status']
export type CheckInSource = Tables<'attendance'>['check_in_source']
export type AttendanceDecisionKind = Tables<'attendance_decisions'>['kind']

/**
 * One captured attendance event: an arrival.
 *
 * `distanceMetres` is the database's answer, not the client's: it is recomputed
 * from the coordinates on every write, so a row cannot show a distance its own
 * coordinates contradict. It is null when the fence could not be evaluated at
 * all — no coordinates were supplied, or the outlet has never been surveyed —
 * and that is reported as unknown rather than guessed at.
 *
 * A `manual` event carries an enterer instead of evidence: the admin who
 * typed it in, stamped by the database and snapshotted by name so the person
 * the entry is about can read it too. Wherever attendance is rendered, that
 * stamp is what makes a manual event visibly not a self check-in.
 */
export interface AttendanceEvent {
  at: string
  latitude: number | null
  longitude: number | null
  accuracyMetres: number | null
  distanceMetres: number | null
  source: CheckInSource | null
  enteredBy: string | null
  enteredByName: string | null
}

/** One immutable check-in claim. Older attempts remain visible after a retry. */
export interface AttendanceAttempt extends AttendanceEvent {
  id: string
  outletId: string
  outletName: string | null
  businessDate: string
  arrivalDeadline: string
  supersededAt: string | null
  settledAt: string | null
}

/** One append-only manager decision or correction. */
export interface AttendanceDecision {
  id: string
  attemptId: string | null
  outletId: string
  outletName: string | null
  kind: AttendanceDecisionKind
  by: string | null
  byName: string | null
  at: string
  reason: string | null
  preventsRetry: boolean
  previousStatus: AttendanceStatus
  newStatus: AttendanceStatus
  latitude: number | null
  longitude: number | null
  accuracyMetres: number | null
  distanceMetres: number | null
  /** Effective arrival time before/after a `correct_time` decision. */
  previousCheckInAt: string | null
  newCheckInAt: string | null
}

export type AttendanceRetryReason =
  | 'open-denial'
  | 'outside-current'
  | 'unverifiable-current'
  | 'inside-current'
  | 'prevented'
  | 'settled'
  | 'not-absent'

export interface AttendanceRetryEligibility {
  allowed: boolean
  reason: AttendanceRetryReason
}

/**
 * The recorded human decision that makes a day count.
 *
 * Every day goes through one of these: a check-in is a claim about where a
 * phone was, and only an approval says somebody worked. The position is the
 * approver's own, read in direct response to pressing approve, so the record
 * shows whether the manager was standing at the outlet when they vouched — the
 * approving manager is a subject of monitoring here exactly as the employee is.
 *
 * `reason` is null on the honest path: inside the fence, on the row's own
 * business day, an approval is one tap. Anywhere or any day else, the database
 * refuses it without one.
 */
export interface AttendanceApproval {
  by: string
  /** Snapshot on the row, so the employee it concerns can read it too. */
  byName: string | null
  at: string
  reason: string | null
  latitude: number | null
  longitude: number | null
  accuracyMetres: number | null
  /** The database's number, computed from the coordinates above. */
  distanceMetres: number | null
}

/**
 * One person's day. Deliberately one shape for both the manager's day view
 * and the employee's own history: the proposal's insistence that an employee
 * sees exactly what their manager sees is easiest to keep true when there is
 * only one thing to render. Rows key on the person's account — staff are
 * accounts, and `personId` is a `profiles` id.
 */
export interface AttendanceRecord {
  id: string
  outletId: string
  /**
   * Named on the row since multi-outlet-people: a person may work a morning at
   * one outlet and an evening at another, so "which outlet was this day?" is a
   * question their own attendance list has to answer rather than assume.
   */
  outletName: string | null
  personId: string
  personName: string
  businessDate: string
  status: AttendanceStatus
  /** Optimistic command version; every state transition increments it. */
  stateVersion: number
  currentAttemptId: string | null
  outcomeAttemptId: string | null
  latestDecisionId: string | null
  retryBlocked: boolean
  attempts: AttendanceAttempt[]
  decisions: AttendanceDecision[]
  retry: AttendanceRetryEligibility
  checkIn: AttendanceEvent | null
  approval: AttendanceApproval | null
  /**
   * The outlet's arrival deadline as it stood when this check-in landed,
   * `HH:MM:SS` in the outlet's reckoning. Stamped by the database and frozen,
   * so editing an outlet's rule next month cannot relabel a day recorded under
   * the old one. Null on a day with no check-in, and on every day recorded
   * before arrival deadlines existed.
   */
  arrivalDeadline: string | null
}

export interface CheckInInput {
  personId: string
  outletId: string
  businessDate: string
  /**
   * Null when the device could not supply one — permission refused, no fix.
   * The record is still written, because a manager needs a row to approve; the
   * database counts it as nothing until one does.
   */
  reading: PositionReading | null
  /** Stable across a transport retry; generated by the adapter when omitted. */
  attemptId?: string
  /** Required for a retry so a concurrent manager decision wins cleanly. */
  expectedVersion?: number | null
}

/**
 * An admin recording an arrival on somebody's behalf — the escape hatch that
 * keeps a hard arrival rule humane: the phone died, the person forgot, the
 * network was down. Past times only, on the outlet's current business day; the
 * database refuses a future time and stamps the enterer itself.
 *
 * Recording it is also settling it. The admin has already attested to the
 * arrival by typing it in, and asking them to then approve their own entry
 * would be a second signature on the same sentence.
 */
export interface ManualEntryInput {
  personId: string
  outletId: string
  businessDate: string
  /** The moment the arrival actually happened, as an ISO instant. */
  at: string
  /**
   * The recording session's own id. A convenience for the caller, never a
   * trust boundary — the database overwrites it with the writing session
   * regardless (the same contract as `approve`'s `approverId`).
   */
  enteredBy: string
}

/**
 * What one approval action carries, whether it settles one day or a morning's
 * worth. One position reading and one reason cover the batch: the manager is
 * standing in one place making one decision, and the database computes each
 * row's distance from that reading independently.
 */
export interface ApprovalInput {
  /**
   * Null unless the rule requires one. Callers should send what the manager
   * typed and let the database refuse a missing one — the rule is enforced
   * there, and a client that pre-judged it would drift.
   */
  reason: string | null
  /** Null when the approving device could supply no position, which costs a reason. */
  reading: PositionReading | null
  /**
   * The approving session's own id. The database refuses anything else, so this
   * is a convenience for the caller, never a trust boundary.
   */
  approverId: string
}

export interface DenialInput {
  attendanceId: string
  expectedAttemptId: string
  expectedVersion: number
  reason: string
  preventRetry: boolean
  decisionId?: string
}

export type AttendanceCorrectionAction =
  'present' | 'absent' | 'allow_retry' | 'absent_allow_retry' | 'time'

export interface AttendanceCorrectionInput {
  attendanceId: string
  expectedVersion: number
  action: AttendanceCorrectionAction
  reason: string
  reading: PositionReading | null
  /** Required only for `time`; an absolute instant on the row's business date. */
  correctedAt?: string | null
  decisionId?: string
}

/** Days waiting for a manager at one outlet. */
export interface WaitingCount {
  outletId: string
  outletName: string | null
  waiting: number
  /** The oldest waiting business date, which is what makes a count urgent. */
  oldest: string
  /**
   * The newest waiting business date. With `oldest` this is what marks the day
   * controls on the attendance view: there is unsettled work before the day on
   * screen when `oldest` is earlier, and after it when `newest` is later
   * (notification-badges, design D3). Two extremes answer that question without
   * a second read, so nothing here lists every waiting date.
   */
  newest: string
}

/** A refusal from the attendance write path. */
export class AttendanceActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'AttendanceActionError'
  }
}

export interface AttendanceAdapter {
  /**
   * One person's record for a business date, or null if they have not started.
   *
   * The outlet is no longer a parameter: since attendance-one-day-per-person a
   * person holds at most one row per business date across every outlet, so
   * naming one could only ever hide the row that exists.
   */
  getDay(personId: string, businessDate: string): Promise<AttendanceRecord | null>
  /**
   * One person's OWN history, most recent business date first, spanning every
   * outlet they work or worked at — each day naming its outlet, because a
   * person may work some days at one and some at another.
   */
  listHistory(personId: string, from: string, to: string): Promise<AttendanceRecord[]>
  /**
   * One person's days over a range of business dates, for a manager reading a
   * pattern rather than a roll-call.
   *
   * **The scope is the policy's** (attendance-one-day-per-person, design D4).
   * #28's D7 pinned an explicit outlet here so the query would mean one thing
   * rather than quietly widening to whatever RLS allowed. That held while the
   * intended meaning was one outlet; the intended meaning is now exactly the set
   * the policy computes — one outlet for a single-outlet Franchise Admin, their
   * own for a multi-outlet one, all of them for the owner — so naming a set
   * client-side would either duplicate the policy or contradict it. Asserted in
   * supabase/tests/18_attendance_elsewhere.sql rather than assumed.
   */
  listPersonRange(personId: string, from: string, to: string): Promise<AttendanceRecord[]>
  /**
   * The day across a set of outlets, for a manager. One list, each record
   * carrying its own outlet, a person appearing once.
   */
  listOutletDay(outletIds: readonly string[], businessDate: string): Promise<AttendanceRecord[]>
  /**
   * Which people on these outlets' staff lists are accounted for somewhere the
   * caller cannot see, on this business date (design D3).
   *
   * Person ids and nothing else. Not which outlet, not the time, not the
   * status, not the evidence, not the approver. It exists because a Franchise
   * Admin cannot read another outlet's rows and therefore cannot work out for
   * themselves that somebody missing from their roll-call was at work — without
   * it the surface would call them absent on a day they were paid for.
   */
  listElsewhere(outletIds: readonly string[], businessDate: string): Promise<string[]>
  /**
   * How many days are waiting for approval at each outlet the caller can reach,
   * so the owner learns where days are stranded without opening every outlet in
   * turn. A day nobody settles is otherwise invisible until somebody queries
   * their pay.
   */
  countWaitingByOutlet(): Promise<WaitingCount[]>
  /**
   * Record a check-in with its evidence. The claim is always `present`; the
   * database stores `absent` whatever the distance says, because the fence is
   * evidence and only a recorded approval settles a day.
   */
  checkIn(input: CheckInInput): Promise<AttendanceRecord>
  /**
   * Record an arrival on somebody's behalf, at a past time on the current
   * business day. Admin only, and the row permanently shows who entered it —
   * the database stamps the enterer, settles the day under their name, and
   * refuses the write from anyone else.
   */
  recordManualEntry(input: ManualEntryInput): Promise<AttendanceRecord>
  /**
   * Settle one waiting day, or every one of them, in a single statement — so a
   * partial failure cannot leave half a morning approved with nothing on screen
   * saying which half (design D8).
   *
   * Returns the settled rows. The database decides whether the reason was
   * needed and refuses the batch if it was and none was given.
   */
  approve(attendanceIds: readonly string[], input: ApprovalInput): Promise<AttendanceRecord[]>
  /** Denial is always reasoned and never captures manager location. */
  deny(input: DenialInput): Promise<AttendanceRecord>
  /** Append a reasoned correction without replacing employee evidence. */
  correct(input: AttendanceCorrectionInput): Promise<AttendanceRecord>
}

// ─────────────────────────────────────────────────────────────────────────────
// The menu: what an outlet sells, and for how much.

/**
 * One category and the items under it, already sorted. Categories and items are
 * two tables and one screen — and one billing grid — so the read that serves
 * both returns them joined rather than making every caller re-assemble them and
 * re-decide the sort.
 */
export interface MenuCategoryWithItems {
  category: Tables<'menu_categories'>
  items: Tables<'menu_items'>[]
}

export interface NewMenuCategory {
  outletId: string
  name: string
  sortOrder?: number
}

export type MenuCategoryPatch = Partial<{
  name: string
  sortOrder: number
  isActive: boolean
}>

/** A new menu item. `pricePaise` is integer paise — rupees never reach this layer. */
export interface NewMenuItem {
  outletId: string
  categoryId: string
  name: string
  pricePaise: number
  isVeg: boolean
  description?: string | null
  sortOrder?: number
}

export type MenuItemPatch = Partial<
  Omit<NewMenuItem, 'outletId'> & {
    isAvailable: boolean
  }
>

/** A refusal from the menu write path. */
export class MenuActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'MenuActionError'
  }
}

export interface MenuAdapter {
  /**
   * The outlet's menu, categories in sort order with their items in sort order.
   *
   * Unavailable items are **included**. The manager's screen has to show what is
   * off in order to turn it back on, and the counter has to show it in order to
   * refuse it — a tile that vanishes when the kitchen runs out reads as a bug to
   * a biller who was looking straight at it.
   */
  listMenu(outletId: string): Promise<MenuCategoryWithItems[]>
  createCategory(category: NewMenuCategory): Promise<Tables<'menu_categories'>>
  updateCategory(id: string, patch: MenuCategoryPatch): Promise<Tables<'menu_categories'>>
  createItem(item: NewMenuItem): Promise<Tables<'menu_items'>>
  /**
   * Edit an item. A price change here applies to future bills only — bill line
   * items snapshot `item_name` and `unit_price_paise`, so nothing already
   * recorded moves. The surface says so before it saves; this is where it
   * becomes true.
   */
  updateItem(id: string, patch: MenuItemPatch): Promise<Tables<'menu_items'>>
  /**
   * Turn one item on or off. Separate from `updateItem` because it is the
   * frequent action and belongs on the row rather than behind a form — and
   * because sending a whole item patch to flip one boolean invites a stale
   * price riding along with it.
   */
  setItemAvailability(id: string, isAvailable: boolean): Promise<Tables<'menu_items'>>
}

// ─────────────────────────────────────────────────────────────────────────────
// The counter: shifts, bills, and the queue they leave through.

export type PaymentMethod = Tables<'bills'>['payment_method']

/** Somebody who can hold a shift at this counter. */
export interface CounterBiller {
  profileId: string
  fullName: string
}

/** The open shift, which is what a bill is attributed to. */
export interface CounterShift {
  id: string
  outletId: string
  billerProfileId: string
  /** Snapshotted so the chrome can say who is on without a second lookup. */
  billerName: string
  businessDate: string
  openedAt: string
}

/**
 * One line as the counter holds it.
 *
 * `itemName` and `unitPricePaise` are **snapshots taken when the line was
 * created**, not references resolved at settle time. A price changed mid-order
 * must not rewrite what is already on the panel, and a bill must never be
 * joinable back to the live menu — that rule is the reason `bill_items` carries
 * these two columns at all.
 */
export interface BillLineDraft {
  menuItemId: string
  itemName: string
  unitPricePaise: number
  quantity: number
}

export interface BillDraft {
  /**
   * Client-generated, and the bill's identity from the moment it exists. The
   * queue may deliver it more than once; the same id must store one bill.
   */
  clientId: string
  outletId: string
  shiftId: string
  /** Resolved from the outlet's cutover at the moment of settle, never at read time. */
  businessDate: string
  paymentMethod: PaymentMethod
  lines: BillLineDraft[]
  customerName?: string | null
  customerPhone?: string | null
}

/**
 * A bill that is waiting to be sent.
 *
 * It carries no bill number, and cannot: numbers are the server's, assigned per
 * outlet and sequentially at insert. Showing a plausible integer before the bill
 * has landed would be the worst possible lie to tell a biller, so the type has
 * nowhere to put one.
 *
 * A delivered bill **leaves** the queue — it is a row in `bills` by then, and an
 * outbox that never empties is not an outbox.
 */
export interface QueuedBill {
  clientId: string
  totalPaise: number
  businessDate: string
  /** Epoch milliseconds it entered the queue — what the escalation clock reads. */
  queuedAt: number
}

export interface SyncState {
  kind: SyncStateKind
  pending: number
}

/** Everything the counter chrome and the counter screen both read. */
export interface CounterState {
  shift: CounterShift | null
  /** The outbox: bills settled and not yet delivered, oldest first. */
  queued: QueuedBill[]
  sync: SyncState
}

/** A refusal from the counter. */
export class BillingActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'BillingActionError'
  }
}

export interface BillingAdapter {
  /**
   * The current counter state. Stable by reference between changes, so it can
   * be read through `useSyncExternalStore` without re-rendering on every tick.
   */
  getCounterState(): CounterState
  /** Subscribe to counter changes. Returns the unsubscribe function. */
  subscribeCounter(listener: () => void): () => void
  /** The outlet's billers, for the shift-unlock grid. */
  listBillers(outletId: string): Promise<CounterBiller[]>
  /**
   * Open a shift. The PIN selects attribution and is not the security boundary
   * — the device's own session is (#9). A wrong PIN and an unknown biller get
   * one identical refusal.
   */
  openShift(input: {
    outletId: string
    billerProfileId: string
    pin: string
  }): Promise<CounterShift>
  closeShift(shiftId: string): Promise<void>
  /**
   * Hand a bill to the queue.
   *
   * **Resolves once it is queued, never once it is sent**, and the counter does
   * not await it either way: the panel clears the instant this is called. The
   * caller already knows the bill's identity and its total, because it made
   * both — so there is nothing to wait for.
   */
  settleBill(draft: BillDraft): Promise<void>
  /**
   * Cancel a queued bill that has not been sent — the undo. It removes a write
   * that has not happened; it never edits a bill, because a settled bill is
   * append-only. Refused once the bill has gone.
   */
  cancelQueuedBill(clientId: string): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Customers: one identity for the whole business, reachable only by phone.

/**
 * A customer as a billing context is permitted to see one.
 *
 * **What is absent is the design** (global-customer-identity). There is no
 * outlet, no bill, no visit count, no spend total and no timestamp here,
 * because a counter that could read any of those could read the OTHER outlet's
 * trade through a customer both outlets serve. The database returns these three
 * columns and no more; this type says the same thing in the language screens
 * read, so a surface cannot render what it was never given.
 */
export interface CustomerIdentity {
  id: string
  /** Canonical `+91XXXXXXXXXX`. Never the string somebody typed. */
  phone: string
  /** The saved billing name, which plenty of customers never give. */
  name: string | null
}

/**
 * A refusal from the customer directory.
 *
 * `phone_required` and `phone_incomplete` are the form's business.
 * `not_permitted` and `rate_limited` are the boundary's, and a counter should
 * treat both the same way: carry on with the bill. **A customer lookup is never
 * allowed to stop a sale** — the counter does not block.
 */
export class CustomerActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'CustomerActionError'
  }
}

export interface CustomersAdapter {
  /**
   * Find a returning customer by their COMPLETE phone number.
   *
   * There is deliberately no search, prefix, or list method on this interface,
   * and there is no database verb behind one either. Resolves `null` when the
   * number is complete and nobody has used it — which is an answer, not a
   * failure. An incomplete number never reaches the database at all.
   */
  lookupByPhone(phone: string): Promise<CustomerIdentity | null>
  /**
   * Save this phone against the sale, creating the identity the first time it
   * is seen.
   *
   * **It never rewrites a profile that already exists.** A name typed at the
   * counter that differs from the saved one belongs on the bill's own snapshot,
   * which is history; changing the global profile from a till would let any
   * counter rename anybody.
   */
  createOrGet(input: { phone: string; name?: string | null }): Promise<CustomerIdentity>
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock: the ledger, and the cache the ledger maintains.

export type InventoryUnit = Tables<'inventory_items'>['unit']

/**
 * One stock item as a list needs it.
 *
 * `currentQuantity` is **derived from the movements**, never a column a client
 * writes: `openspec/specs/inventory-ledger/spec.md` makes the ledger the truth
 * and the quantity a cache the database maintains from it, and an adapter that
 * let a caller set it directly would be handing back the inversion the spec
 * exists to prevent.
 */
export interface InventoryItemSummary {
  id: string
  outletId: string
  name: string
  unit: InventoryUnit
  currentQuantity: number
  lowStockThreshold: number
  /** `currentQuantity <= lowStockThreshold`, resolved once so two screens agree. */
  isLow: boolean
  purchaseCostPaise: number
  isActive: boolean
  lastUpdatedAt: string
}

/** One row of an item's ledger, with the quantity it left behind. */
export interface InventoryMovementRecord {
  id: string
  inventoryItemId: string
  movementType: MovementType
  /** Signed: added is positive, used and wasted negative, a correction as given. */
  quantityDelta: number
  /** The item's quantity after this movement — what makes a ledger readable. */
  quantityAfter: number
  note: string | null
  businessDate: string
  createdAt: string
}

export interface NewInventoryItem {
  outletId: string
  name: string
  unit: InventoryUnit
  lowStockThreshold: number
  purchaseCostPaise?: number
}

export type InventoryItemPatch = Partial<{
  name: string
  lowStockThreshold: number
  purchaseCostPaise: number
  isActive: boolean
}>

export interface NewMovement {
  inventoryItemId: string
  movementType: MovementType
  /**
   * A magnitude for added / used / wasted — the sign comes from the kind of
   * movement, so nobody counting stock has to remember a minus. A correction
   * takes the signed value as given, because its direction is the point.
   */
  quantity: number
  note?: string | null
  businessDate: string
}

export class InventoryActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'InventoryActionError'
  }
}

export interface InventoryAdapter {
  listItems(outletId: string): Promise<InventoryItemSummary[]>
  getItem(id: string): Promise<InventoryItemSummary | null>
  /** One item's movements, most recent first. */
  listMovements(inventoryItemId: string): Promise<InventoryMovementRecord[]>
  createItem(item: NewInventoryItem): Promise<InventoryItemSummary>
  updateItem(id: string, patch: InventoryItemPatch): Promise<InventoryItemSummary>
  /**
   * Append a movement. There is deliberately no update and no delete: a
   * mistaken entry is corrected by a further movement carrying a note, and the
   * original stays visible. History is corrected, never edited.
   */
  recordMovement(movement: NewMovement): Promise<InventoryItemSummary>
}

// ─────────────────────────────────────────────────────────────────────────────
// Expenses: what the outlet spent, and how.

export interface ExpenseRecord {
  id: string
  outletId: string
  businessDate: string
  category: string
  amountPaise: number
  paymentMethod: PaymentMethod
  description: string | null
  createdAt: string
}

export interface NewExpense {
  outletId: string
  businessDate: string
  category: string
  /** Integer paise. Rupees are converted at the input boundary, never here. */
  amountPaise: number
  paymentMethod: PaymentMethod
  description?: string | null
}

export class ExpenseActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'ExpenseActionError'
  }
}

export interface ExpensesAdapter {
  /** One outlet's expenses for one business date, most recent first. */
  listExpenses(outletId: string, businessDate: string): Promise<ExpenseRecord[]>
  createExpense(expense: NewExpense): Promise<ExpenseRecord>
}

// ─────────────────────────────────────────────────────────────────────────────
// Expense categories: a business-wide suggestion list and owner curation.

export interface ExpenseCategorySuggestion {
  id: string
  name: string
  ledgerUsageCount: number
  expenseUsageCount: number
  createdAt: string
}

export interface ExpenseCategoryOperation {
  id: string
  operation: 'rename' | 'merge'
  nameBefore: string
  nameAfter: string
  ledgerRowsMoved: number
  expenseRowsMoved: number
  performedBy: string
  performedAt: string
}

export interface ExpenseCategoryMoveResult {
  ledgerRowsMoved: number
  expenseRowsMoved: number
}

export interface ExpenseCategoriesAdapter {
  list(): Promise<ExpenseCategorySuggestion[]>
  rename(from: string, to: string, rewriteHistory: boolean): Promise<ExpenseCategoryMoveResult>
  merge(from: string, into: string): Promise<ExpenseCategoryMoveResult>
  retire(name: string): Promise<void>
  listOperations(): Promise<ExpenseCategoryOperation[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily cash: the number a human signs their name to.

/** A withdrawal from the drawer during the day. */
export interface CashWithdrawalRecord {
  id: string
  amountPaise: number
  withdrawnBy: string
  reason: string | null
  createdAt: string
}

/**
 * A bill that reached the server after its business day had been closed.
 *
 * The closed figures do not move — that is what "a closed day is a snapshot"
 * means — so the arrival has to surface somewhere, and it surfaces here.
 */
export interface ReconciliationException {
  billId: string
  billNumber: number
  businessDate: string
  totalPaise: number
  paymentMethod: PaymentMethod
  /** When it was rung, and when it landed. The gap is the whole problem. */
  createdAt: string
  syncedAt: string
}

/**
 * One outlet's cash day.
 *
 * **Every derived figure is computed here, never supplied by the caller.** The
 * `close_business_day` contract requires the database to compute them
 * server-side inside the transaction that writes the record, and a mock that
 * accepted them from a screen would be teaching the opposite.
 */
export interface DailyCashDay {
  outletId: string
  businessDate: string
  openingCashPaise: number
  /** Settled bills paid in cash for this date. No other method contributes. */
  cashSalesPaise: number
  /** Expenses paid in cash for this date. A UPI expense does not appear here. */
  cashExpensesPaise: number
  cashWithdrawnPaise: number
  expectedClosingPaise: number
  withdrawals: CashWithdrawalRecord[]
  /** Non-null once the day has been closed: the snapshot, exactly as stored. */
  closed: Tables<'daily_cash_records'> | null
  /** Bills that arrived after this day was closed. Empty unless it was. */
  exceptions: ReconciliationException[]
}

export interface NewWithdrawal {
  outletId: string
  businessDate: string
  amountPaise: number
  withdrawnBy: string
  reason?: string | null
}

export interface CloseDayInput {
  outletId: string
  businessDate: string
  /** The only two numbers a person supplies. Everything else is derived. */
  actualClosingPaise: number
  notes?: string | null
}

export class DailyCashActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'DailyCashActionError'
  }
}

export interface DailyCashAdapter {
  getDay(outletId: string, businessDate: string): Promise<DailyCashDay>
  recordWithdrawal(withdrawal: NewWithdrawal): Promise<DailyCashDay>
  /**
   * Close the day. Refused for a date already closed — one record per outlet per
   * business date — and the stored figures are never recomputed afterwards.
   */
  closeDay(input: CloseDayInput): Promise<Tables<'daily_cash_records'>>
}

// ─────────────────────────────────────────────────────────────────────────────
// Alerts: what one outlet needs the owner to know about.

export type AlertCategory = Tables<'alerts'>['category']
export type AlertPriorityValue = Tables<'alerts'>['priority']
export type AlertStatusValue = Tables<'alerts'>['status']

/** One response on an alert's thread. Append-only: a response is never edited. */
export interface AlertResponseRecord {
  id: string
  message: string
  /** Snapshotted so the thread reads without a second lookup per row. */
  responderName: string
  createdAt: string
}

export interface AlertSummary {
  id: string
  outletId: string
  /**
   * Carried on the row rather than joined by the screen. The owner's inbox is
   * cross-outlet, and an alert whose outlet the reader has to work out from
   * context is an alert they will act on for the wrong shop.
   */
  outletName: string
  category: AlertCategory
  priority: AlertPriorityValue
  status: AlertStatusValue
  subject: string
  message: string
  raisedBy: string
  raisedByName: string
  createdAt: string
  responseCount: number
}

export interface AlertDetail extends AlertSummary {
  responses: AlertResponseRecord[]
}

export interface NewAlert {
  outletId: string
  category: AlertCategory
  priority: AlertPriorityValue
  subject: string
  message: string
}

/** A refusal from the alerts path — an illegal transition, or a blank field. */
export class AlertActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'AlertActionError'
  }
}

export interface AlertsAdapter {
  /**
   * Alerts the caller may see, ordered so that what needs attention is found
   * first. The Super Admin gets every outlet's; anybody else gets their own
   * outlet's, and naming another outlet returns nothing rather than throwing —
   * a policy that excludes rows is what RLS does.
   */
  listAlerts(options?: { outletId?: string }): Promise<AlertSummary[]>
  getAlert(id: string): Promise<AlertDetail | null>
  raiseAlert(alert: NewAlert): Promise<AlertSummary>
  /** Add to the thread. Deliberately does not move the status (design D8). */
  respond(alertId: string, message: string): Promise<AlertDetail>
  /**
   * Move the alert along. Only the transitions `src/domain/alerts.ts` permits;
   * anything else is refused by name rather than accepted silently.
   */
  setStatus(alertId: string, status: AlertStatusValue): Promise<AlertSummary>
}

// ─────────────────────────────────────────────────────────────────────────────
// Insights: the owner's derived figures.

/** An inclusive range of business dates. Dates, never timestamps. */
export interface InsightsPeriod {
  from: string
  to: string
}

/** Money taken by one payment method. */
export interface MethodTotal {
  method: PaymentMethod
  amountPaise: number
}

/** Money spent under one category. */
export interface CategoryTotal {
  category: string
  amountPaise: number
}

/**
 * One outlet's today, as the console shows it.
 *
 * **Nothing here is supplied by a caller.** Every figure is summed from the
 * rows the operational surfaces write, which is what keeps the console and the
 * counter from contradicting each other (design D4).
 */
export interface OutletDaySummary {
  outletId: string
  businessDate: string
  salesPaise: number
  billCount: number
  salesByMethod: MethodTotal[]
  /** What the drawer should hold: the same invariant the cash screen states. */
  expectedCashPaise: number
  dayClosed: boolean
  /** Null while the day is open — nobody has counted it yet. */
  cashDifferencePaise: number | null
  lowStockCount: number
  openAlertCount: number
  /**
   * Arrivals recorded today. A recorded arrival is a claim, not a settled day —
   * `waitingApprovalCount` is how many of them still count for nothing.
   */
  checkedInCount: number
  /** Arrivals nobody has approved. A day left here counts for nothing at all. */
  waitingApprovalCount: number
}

/** One day inside a period, for the shape of a run rather than its total. */
export interface PeriodDay {
  businessDate: string
  salesPaise: number
  dayClosed: boolean
  cashDifferencePaise: number | null
}

export interface PeriodSummary {
  outletId: string
  period: InsightsPeriod
  salesPaise: number
  billCount: number
  salesByMethod: MethodTotal[]
  expensesByCategory: CategoryTotal[]
  expensesPaise: number
  /**
   * The profit and the working behind it, **on the basis that was asked for**.
   * There is no basis-free variant: a figure whose basis the caller never chose
   * is a figure a surface cannot honestly label (design D5).
   */
  profit: ProfitEstimate
  days: PeriodDay[]
}

/** One outlet's row on the comparison. */
export interface OutletComparisonRow {
  outletId: string
  outletName: string
  salesPaise: number
  expensesPaise: number
  profitPaise: number
  /** Summed over the closed days in the period; null if none were closed. */
  cashDifferencePaise: number | null
}

/**
 * The owner's derived figures.
 *
 * Every method may answer `null` — **which is a real answer, not a failure**.
 * `owner-dashboard` is a `live` surface, so this adapter's Supabase
 * implementation is genuinely called today and genuinely has nothing to report
 * until `owner-console-live` (#13) gives it real bills. The console renders the
 * outlet with the absence stated rather than a fabricated zero (design D3).
 */
export interface InsightsAdapter {
  outletDay(outletId: string, businessDate: string): Promise<OutletDaySummary | null>
  periodSummary(
    outletId: string,
    period: InsightsPeriod,
    basis: ProfitBasis,
  ): Promise<PeriodSummary | null>
  comparison(
    outletIds: readonly string[],
    period: InsightsPeriod,
    basis: ProfitBasis,
  ): Promise<OutletComparisonRow[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual ledger: the temporary owner-only notebook (#36).
//
// **This section is designed to be deleted**, along with
// `src/features/manual-ledger/`, `mock/manual-ledger.ts`,
// `supabase-adapters/manual-ledger.ts`, one registry entry, one route and two
// tables. It exists because billing (#10), expenses (#11) and daily cash (#12)
// are not live while August 2026 is trading, and the month cannot be
// reconstructed from memory afterwards.
//
// It is deliberately NOT a partial `ExpensesAdapter` or `DailyCashAdapter`.
// Those belong to #11 and #12, whose tables have not been designed; writing
// into them now would either constrain those changes or collapse the authority
// boundary `docs/LIMITATIONS.md` draws around the drawer.

/** One trading day at one outlet, exactly as stored. Nothing here is derived. */
export interface ManualLedgerDay {
  outletId: string
  businessDate: string
  /** Stored, never derived from the previous day's count — see design D2. */
  openingCashPaise: number
  /** Negative is legitimate: a cash refund is recorded by lowering this. */
  cashRevenuePaise: number
  upiRevenuePaise: number
  zomatoRevenuePaise: number
  swiggyRevenuePaise: number
  cashAddedPaise: number
  cashAddedReason: string | null
  cashRemovedPaise: number
  cashRemovedReason: string | null
  countedCashPaise: number
  /** Basis points that applied to THIS day. 2250 is 22.5%. */
  zomatoCommissionBp: number
  swiggyCommissionBp: number
  /** Optional, unlike an expense description: it explains a cash difference. */
  note: string | null
}

export interface ManualLedgerExpense {
  id: string
  outletId: string
  businessDate: string
  category: string
  /** The only question this ledger asks of an expense: did it leave the drawer? */
  isCash: boolean
  amountPaise: number
  /** Optional detail beyond the category, such as a quantity. */
  note: string | null
  createdAt: string
}

/** The day form's payload. Upserted on `(outlet, business date)` — design D6. */
export type ManualLedgerDayInput = ManualLedgerDay

export interface NewManualLedgerExpense {
  outletId: string
  businessDate: string
  category: string
  isCash: boolean
  /** Integer paise. Rupees are converted at the input boundary, never here. */
  amountPaise: number
  note?: string | null
}

export type ManualLedgerExpensePatch = Partial<
  Pick<NewManualLedgerExpense, 'category' | 'isCash' | 'amountPaise' | 'note'>
>

/** Everything a month reading needs, unaggregated. The maths is not the adapter's. */
export interface ManualLedgerMonth {
  days: ManualLedgerDay[]
  expenses: ManualLedgerExpense[]
}

export class ManualLedgerActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'ManualLedgerActionError'
  }
}

export interface ManualLedgerAdapter {
  getDay(outletId: string, businessDate: string): Promise<ManualLedgerDay | null>
  /**
   * The most recent day row BEFORE this date at this outlet, or null on an
   * outlet's first tracked day.
   *
   * Serves two jobs that must not be conflated: it supplies the form's defaults,
   * and it is what the opening-cash chain is checked against. Both are reads —
   * nothing here writes a repaired figure, because a stored figure the owner
   * entered is evidence and a recomputed one is not (design D2).
   */
  getPreviousDay(outletId: string, businessDate: string): Promise<ManualLedgerDay | null>
  upsertDay(day: ManualLedgerDayInput): Promise<ManualLedgerDay>
  /** A day typed against the wrong date. There is no history here to protect. */
  deleteDay(outletId: string, businessDate: string): Promise<void>
  listExpenses(outletId: string, businessDate: string): Promise<ManualLedgerExpense[]>
  createExpense(expense: NewManualLedgerExpense): Promise<ManualLedgerExpense>
  updateExpense(id: string, patch: ManualLedgerExpensePatch): Promise<ManualLedgerExpense>
  deleteExpense(id: string): Promise<void>
  /** One outlet, one month, as `YYYY-MM`. One outlet at a time — design D9. */
  getMonth(outletId: string, month: string): Promise<ManualLedgerMonth>
}

/** The bag of domain adapters a session provider supplies to its tree. */
export interface DataAdapters {
  outlets: OutletsAdapter
  accounts: AccountsAdapter
  attendance: AttendanceAdapter
  menu: MenuAdapter
  billing: BillingAdapter
  customers: CustomersAdapter
  inventory: InventoryAdapter
  expenses: ExpensesAdapter
  expenseCategories: ExpenseCategoriesAdapter
  dailyCash: DailyCashAdapter
  alerts: AlertsAdapter
  insights: InsightsAdapter
  addressLookup: AddressLookupAdapter
  /** Temporary (#36). Removed with the capability once #12 carries its rows. */
  manualLedger: ManualLedgerAdapter
}

// ─────────────────────────────────────────────────────────────────────────────
// Looking up a postal address.

/**
 * A place somebody can pick, reduced to the parts of a postal address.
 *
 * **There is no latitude or longitude here, and that absence is the design.**
 * `outlets.latitude/longitude` is read directly by the check-in trigger, so a
 * coordinate from a map search would arm the geofence against a rooftop
 * centroid and mark somebody absent while they stand at their own counter.
 * Capturing a position on site is the only thing that surveys an outlet
 * (attendance design D4).
 *
 * A comment saying "do not use these" survives exactly until somebody needs
 * them. A type that cannot carry them does not.
 */
export interface AddressSuggestion {
  /** Stable within one result set; only ever used as a React key and an id. */
  id: string
  /** What the person reads in the list — enough to tell three near-identical places apart. */
  label: string
  /** Offered for the outlet's location label, and only when that field is empty. */
  placeName: string
  addressLine1: string
  addressLine2: string
  city: string
  pincode: string
}

/**
 * Postal address lookup: suggestions as somebody types, and the one field no
 * geocoder answers correctly for India.
 *
 * Both calls are optional to whatever operation is in progress. Neither throws
 * — an unreachable, refused or slow service resolves to nothing, because this
 * is a convenience on an optional block and an error here would imply something
 * needs fixing when nothing does.
 */
export interface AddressLookupAdapter {
  suggest(query: string, signal?: AbortSignal): Promise<AddressSuggestion[]>
  /**
   * The Indian revenue district for a PIN code — Nadia for 741235, North 24
   * Parganas for 743145. Deliberately not taken from the geocoder: OpenStreetMap's
   * `district` for Kalyani is the sector `B-7` and its `county` is the
   * municipality, neither of which is what goes on an invoice.
   */
  districtForPincode(pincode: string, signal?: AbortSignal): Promise<string | null>
}
