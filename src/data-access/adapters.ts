import type {
  BillingCommandResult,
  MovementType,
  ProfitBasis,
  ProfitEstimate,
  SyncStateKind,
} from '@/domain'
import type { PositionReading } from '@/lib/geolocation'

import type { BillingCommand } from '../../shared/billing-command'

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
    /** First business date whose Cash/UPI revenue comes from counter bills. */
    billingLiveFrom: string | null
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
export type AccountInvitePurpose = 'activation' | 'password_reset'

export interface LiveAccountInvite {
  purpose: AccountInvitePurpose
  expiresAt: string
}

export type AccountLifecycle =
  | { kind: 'needs_setup' }
  | { kind: 'setup_link_issued'; expiresAt: string }
  | { kind: 'active' }
  | { kind: 'password_reset_issued'; expiresAt: string }
  | { kind: 'deactivated' }

export interface AccountLifecycleFacts {
  isActive: boolean
  hasSignedIn: boolean
  invite: LiveAccountInvite | null
}

/**
 * Derive the one product lifecycle label from authoritative facts. Expired
 * links are inert even if a historical row remains unused in the database.
 */
export function deriveAccountLifecycle(
  facts: AccountLifecycleFacts,
  now: Date = new Date(),
): AccountLifecycle {
  if (!facts.isActive) return { kind: 'deactivated' }
  const invite =
    facts.invite && new Date(facts.invite.expiresAt).getTime() > now.getTime() ? facts.invite : null

  if (!facts.hasSignedIn) {
    return invite?.purpose === 'activation'
      ? { kind: 'setup_link_issued', expiresAt: invite.expiresAt }
      : { kind: 'needs_setup' }
  }
  return invite?.purpose === 'password_reset'
    ? { kind: 'password_reset_issued', expiresAt: invite.expiresAt }
    : { kind: 'active' }
}

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
  /** True only after Auth records a successful sign-in for this account. */
  hasSignedIn: boolean
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
  invite: LiveAccountInvite | null
  /** Product state derived from active/sign-in/live-invite facts. */
  lifecycle: AccountLifecycle
  /** Opaque concurrency token covering all facts an account edit may replace. */
  stateFingerprint: string
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

/** @deprecated Account facts now change through the atomic edit command. */
export type StaffFactsPatch = Partial<{
  fullName: string
  roleTitle: string | null
}>

/**
 * The roles that make somebody **staff**: a person who works a shift at a shop,
 * as against a person who manages or owns one (a-biller-is-staff, design D5).
 *
 * A Biller is on this list because a Biller works a shift at the shop and
 * therefore turns up to it. `identity-and-access` requires their assignment to
 * confer personal attendance, and `attendance_submit_attempt` has always
 * accepted either role.
 *
 * One list, because the same question is asked in four places: who is on an
 * outlet's attendance roll-call, which roles a manager may hand out, which
 * assignments a manager may edit, and who may record against the manual ledger.
 * They were four separate spellings of it and one of them was a role short,
 * which is the bug this change exists to correct. A rule worth stating once is
 * worth storing once.
 *
 * Ordered by seniority to match `ROLE_SENIORITY`, since the accounts surface
 * renders it directly as the roles on offer.
 *
 * Stated as the roles it admits rather than as the roles it excludes, so a role
 * added to the enum joins nothing until somebody decides that it should
 * (design D1).
 */
export const STAFF_ROLES = ['biller', 'employee'] as const satisfies readonly AppRole[]

/** Does this role make its holder staff at the outlet it is held at? */
export function isStaffRole(role: AppRole): boolean {
  return (STAFF_ROLES as readonly AppRole[]).includes(role)
}

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
 * A **staff assignment is an Employee or a Biller one**, which is `STAFF_ROLES`
 * above. This read of it named Employee alone, so a person promoted from
 * Employee to Biller left the roll-call and the by-staff picker on the day of
 * the promotion (a-biller-is-staff).
 *
 * The people surfaces ask no such question: what they may see is decided by the
 * policies, and a manager belongs on their outlet's people list whether or not
 * anybody records their arrival.
 */
export function isStaffAt(account: Pick<AccountSummary, 'assignments'>, outletId: string): boolean {
  return liveAssignments(account.assignments).some(
    (a) => a.outletId === outletId && isStaffRole(a.role),
  )
}

/** The one-time code, returned once and never retrievable again. */
export interface AccountHandover {
  profileId: string
  username: string
  code: string
  expiresAt: string
  purpose: AccountInvitePurpose
}

/** Compatibility name retained while older account call sites migrate. */
export type IssuedCode = AccountHandover

export interface IntendedAssignment {
  assignmentId: string | null
  outletId: string | null
  role: AppRole
  startedOn: string
}

export interface EditAccountCommand {
  profileId: string
  expectedStateFingerprint: string
  fullName: string
  phone: string | null
  roleTitle: string | null
  accountEmail: string | null
  /** Complete intended live set; an empty set is reserved for Mark as left. */
  assignments: IntendedAssignment[]
}

export interface AssignmentSetResult {
  profileId: string
  assignments: Assignment[]
  stateFingerprint: string
  replacementHandover: AccountHandover | null
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
 * the adapter is the seam in front of them, not the thing doing them. Facts
 * and placement cross the same atomic privileged boundary.
 */
export interface AccountsAdapter {
  /**
   * People the caller may see: everybody for the Super Admin, and for a
   * Franchise Admin the people live at an outlet they manage.
   */
  listAccounts(): Promise<AccountSummary[]>
  /** One step creates a working person: account, every assignment, issued code. */
  provision(account: NewAccount): Promise<IssuedCode>
  /** Issue or replace the purpose appropriate to the account's sign-in history. */
  issueHandover(profileId: string): Promise<AccountHandover>
  /** Replace profile facts and the complete intended live assignment set atomically. */
  editAccount(command: EditAccountCommand): Promise<AssignmentSetResult>
  /** End every live assignment and deactivate in the same transaction. */
  markAsLeft(profileId: string, expectedStateFingerprint: string): Promise<AssignmentSetResult>
  /** @deprecated Use issueHandover. Retained during the Edge rollout. */
  reissue(profileId: string): Promise<IssuedCode>
  setActive(profileId: string, isActive: boolean): Promise<void>
  /** @deprecated Use editAccount with a complete intended assignment set. */
  grantAssignment(input: {
    personId: string
    role: AppRole
    outletId: string | null
    accountEmail?: string | null
  }): Promise<IssuedCode | null>
  /** @deprecated Use editAccount or markAsLeft. */
  endAssignment(assignmentId: string): Promise<IssuedCode | null>
  /**
   * Correct the username an account signs in with. Any outstanding one-time
   * code survives because it is bound to the account, not the username.
   */
  changeUsername(profileId: string, username: string): Promise<void>
  setAccountEmail(profileId: string, accountEmail: string): Promise<void>
  /** @deprecated Use editAccount. */
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

/** One outlet's business day at the reference instant the backend supplied. */
export interface AttendanceCurrentOutlet {
  outletId: string
  businessDate: string
}

/**
 * The attendance surface's one authoritative clock read. `serverAt` is shared
 * by every outlet date, so different cutovers can be compared without asking a
 * device what time it is.
 */
export interface AttendanceCurrentContext {
  serverAt: string
  outlets: AttendanceCurrentOutlet[]
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
 * One person in a selected set, named with everything the database needs to
 * decide them without re-reading the day.
 *
 * The attempt and the version are the whole of the staleness contract: a retry,
 * another manager's decision or an assignment change moves one of them, and the
 * command then refuses the set rather than settling a row nobody looked at.
 *
 * **The decision id is generated once by the caller and reused unchanged on
 * retry.** That is what makes a lost response harmless: the same identity with
 * the same payload settles the rows once and returns them, and the same identity
 * with anything changed is refused. The adapter used to mint one inside its own
 * loop, so a retry created new identities and a partial failure left a morning
 * half settled with nothing saying which half.
 */
export interface AttendanceDecisionItem {
  attendanceId: string
  expectedAttemptId: string
  expectedVersion: number
  decisionId: string
}

/**
 * What one approval action carries, whether it settles one day or a morning's
 * worth. One position reading and one reason cover the set: the manager is
 * standing in one place making one decision, and the database computes each
 * row's distance to its own outlet from that one reading independently.
 */
export interface ApprovalInput {
  /** The action's own identity, shared by every decision it writes. */
  commandId: string
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

/**
 * Denial takes the same set shape as approval, and deliberately carries no
 * position: it says the attempts should not count, not that the manager stood
 * anywhere.
 */
export interface DenialInput {
  commandId: string
  reason: string
  preventRetry: boolean
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

/**
 * A refused set settled nothing, so the manager's selection is still worth
 * something — the surface re-reads the day, keeps every row that has not moved,
 * and names the ones that have.
 *
 * A code rather than a message, because a surface that decided this by matching
 * on prose would break the first time the prose was reworded, and the codes are
 * what the adapter already promises.
 */
const RECOVERABLE_REFUSALS = new Set(['stale_state', 'changed_request', 'not_permitted'])

export function isRecoverableSetRefusal(cause: unknown): cause is AttendanceActionError {
  return cause instanceof AttendanceActionError && RECOVERABLE_REFUSALS.has(cause.code)
}

export interface AttendanceAdapter {
  /**
   * Current business dates for the named readable outlets, derived at one
   * backend instant. The caller still chooses the set; the backend decides
   * which outlets it may see.
   */
  getCurrentContext(outletIds: readonly string[]): Promise<AttendanceCurrentContext>
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
   * Settle an explicitly selected set of waiting days in **one** database
   * command, so a partial failure cannot leave half a morning approved with
   * nothing on screen saying which half (attendance-batch-decisions, design D1).
   *
   * A set of one is the ordinary case and takes the same path, which is what
   * keeps the reason rule, the evidence rule, the authority rule and the device
   * rule to one implementation rather than two.
   *
   * Returns every settled row. The database decides per row whether the reason
   * was required, stores it only there, and refuses the whole set if a row
   * required one and none was given.
   */
  approve(
    items: readonly AttendanceDecisionItem[],
    input: ApprovalInput,
  ): Promise<AttendanceRecord[]>
  /**
   * The same set shape, always reasoned, never capturing manager location, with
   * one retry choice applying to every selected person's own business date.
   */
  deny(items: readonly AttendanceDecisionItem[], input: DenialInput): Promise<AttendanceRecord[]>
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

/** The item-first create shape; a new category is created atomically with it. */
export interface NewMenuItemWithCategory extends Omit<NewMenuItem, 'categoryId'> {
  categoryName: string
}

export type MenuItemWithCategoryPatch = Omit<MenuItemPatch, 'categoryId'> & {
  categoryName: string
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
  createItemWithCategory(item: NewMenuItemWithCategory): Promise<{
    category: Tables<'menu_categories'>
    item: Tables<'menu_items'>
  }>
  updateItemWithCategory(
    id: string,
    patch: MenuItemWithCategoryPatch,
  ): Promise<Tables<'menu_items'>>
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
  /** Retire without deleting rows referenced by captured order or bill lines. */
  retireItem(id: string): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// The counter: shifts, bills, and the queue they leave through.

export type PaymentMethod = NonNullable<Tables<'bills'>['payment_method']>
export const BILLING_PAYMENT_METHODS = ['cash', 'upi'] as const satisfies readonly PaymentMethod[]

/** One exact tender allocation. Several allocations may settle one bill. */
export interface PaymentAllocation {
  method: PaymentMethod
  amountPaise: number
}

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
  payments: PaymentAllocation[]
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

export type OrderStatus = Tables<'orders'>['status']
export type BillStatus = Tables<'bills'>['status']

/** A saved order as the counter and manager surfaces read it. */
export interface BillingOrder {
  id: Tables<'orders'>['id']
  outletId: Tables<'orders'>['outlet_id']
  deviceId: Tables<'orders'>['device_id']
  orderNumber: Tables<'orders'>['order_number']
  /** Present only until the server assigns the permanent daily order number. */
  localReference?: string | null
  businessDate: Tables<'orders'>['business_date']
  orderedAt: Tables<'orders'>['ordered_at']
  /**
   * The preparation axis, independent of `status` (the money lifecycle). Null
   * means still preparing; a timestamp means prepared, and clearing it back to
   * null is reprepare. Paid-but-null is the upfront payer still waiting for food.
   */
  preparedAt: Tables<'orders'>['prepared_at']
  status: OrderStatus
  creatorId: Tables<'orders'>['created_by']
  creatorName: string
  customerName: Tables<'orders'>['customer_name']
  customerPhone: Tables<'orders'>['customer_phone']
  lines: BillLineDraft[]
  totalPaise: Tables<'orders'>['total_paise']
  cancelReason: Tables<'orders'>['cancel_reason']
  cancelledAt: Tables<'orders'>['cancelled_at']
  cancelledByName: string | null
  /** When the money arrived — what the five-minute unwind window measures from. */
  paidAt: Tables<'orders'>['paid_at']
  billId: Tables<'orders'>['bill_id']
}

/** Which kind of act voided a settled bill, stamped by the performing transaction. */
export type BillVoidKind = NonNullable<Tables<'bills'>['void_kind']>

export interface SaveOrderInput {
  clientId: string
  outletId: string
  shiftId: string
  businessDate: string
  lines: BillLineDraft[]
  customerId?: string | null
  customerName?: string | null
  customerPhone?: string | null
}

export interface BillingBill {
  id: Tables<'bills'>['id']
  outletId: Tables<'bills'>['outlet_id']
  billNumber: Tables<'bills'>['bill_number']
  /** The order this bill settled, when it came from one. What unwinds chain to. */
  orderId: Tables<'bills'>['order_id']
  orderNumber: Tables<'orders'>['order_number'] | null
  businessDate: Tables<'bills'>['business_date']
  orderedAt: Tables<'bills'>['ordered_at']
  paidAt: Tables<'bills'>['paid_at']
  paymentBusinessDate: Tables<'bills'>['payment_business_date']
  /** Exact tender allocations; their sum is always the bill total. */
  payments: PaymentAllocation[]
  /** Revision zero is the immutable original allocation. */
  paymentRevision: number
  /** Present only when this tablet may still append a tender correction. */
  paymentEditableUntil: string | null
  /** Convenience label for summaries; `mixed` is not itself a tender method. */
  paymentMethod: PaymentMethod | 'mixed'
  status: BillStatus
  /** Snapshotted attribution resolved for display; never inferred from the reader's session. */
  billerName: string
  customerName: Tables<'bills'>['customer_name']
  customerPhone: Tables<'bills'>['customer_phone']
  lines: BillLineDraft[]
  totalPaise: Tables<'bills'>['total_paise']
  /**
   * The structured kind stamped when this bill was voided: `manager_void`,
   * `counter_unpay` or `cancelled_after_paid`. Legacy rows read null and are
   * displayed as manager voids. Never inferred at read time.
   */
  voidKind: Tables<'bills'>['void_kind']
  voidReason: Tables<'bills'>['void_reason']
  voidedAt: Tables<'bills'>['voided_at']
  /** The actor stamped by the database when the immutable bill was cancelled. */
  voidedBy: LedgerActor | null
}

export interface BillingHistoryFilters {
  outletId: string
  businessDate?: string
  status?: BillStatus | 'all'
  paymentMethod?: PaymentMethod | 'all'
}

export interface BillingMethodTotal {
  method: PaymentMethod
  totalPaise: number
}

export interface ShiftBillingHistory {
  bills: BillingBill[]
  totals: BillingMethodTotal[]
}

/** Non-identifying delivery metadata safe to show on a manager phone. */
export interface BillingDeliveryDiagnostic {
  reference: Tables<'billing_commands'>['id']
  commandType: Tables<'billing_commands'>['command_type']
  resultCategory: Tables<'billing_commands'>['result_category']
  receivedAt: Tables<'billing_commands'>['received_at']
  ageMs: number
  /**
   * The order the refusal named, or null. A daily order number is a
   * non-identifying reference, which is what makes it showable here.
   */
  orderNumber: number | null
}

/** The richer local trace that never leaves the originating tablet surface. */
export interface BillingAttentionItem extends BillingDeliveryDiagnostic {
  deviceId: NonNullable<Tables<'billing_commands'>['device_id']>
  refusedTrace: string
  state: 'needs_attention' | 'corrected' | 'discarded'
  linkedCorrectionId: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  discardReason: string | null
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
   * Append a complete replacement tender allocation during the edit window.
   */
  correctBillPayment(
    billId: string,
    expectedRevision: number,
    payments: PaymentAllocation[],
  ): Promise<BillingBill>
  saveOrder(input: SaveOrderInput): Promise<BillingOrder>
  reviseOrder(
    orderId: string,
    input: Pick<SaveOrderInput, 'lines' | 'customerId' | 'customerName' | 'customerPhone'>,
  ): Promise<BillingOrder>
  listOpenOrders(outletId: string): Promise<BillingOrder[]>
  /**
   * Record tender against an open order. When the order is already prepared
   * this settles it into a bill and resolves with that bill; when its food is
   * still owed the money is held against the order and **null** resolves — no
   * bill exists yet, because an order enters Bills only when prepared and paid.
   */
  payOrder(orderId: string, payments: PaymentAllocation[]): Promise<BillingBill | null>
  cancelOrder(orderId: string, reason: string): Promise<BillingOrder>
  /**
   * Mark an order prepared, or reprepare it by clearing the mark. The order
   * must be open — or paid but not yet prepared, the upfront payer's path into
   * Bills: settling that order is what marking prepared does. Repreparing a
   * paid order is refused: the bills border is terminal in that direction.
   */
  markOrderPrepared(orderId: string, prepared: boolean): Promise<BillingOrder>
  /**
   * Take this tablet's own payment back within the grace window. A settled
   * bill is voided as `counter_unpay`; money held against a paid-but-unprepared
   * order is discarded. Either way the order reopens. Queued behind the payment
   * it reverses, so offline acceptance cannot overtake it.
   */
  unpayOrder(orderId: string, billId: string | null, reason: string): Promise<BillingOrder>
  /**
   * Cancel a paid order within the same window: one reasoned act that voids
   * the bill as `cancelled_after_paid` and cancels the order — warned about
   * first by the surface, because the money leaves the drawer.
   */
  cancelPaidOrder(orderId: string, reason: string): Promise<BillingOrder>
  listShiftHistory(shiftId: string): Promise<ShiftBillingHistory>
  listManagerHistory(filters: BillingHistoryFilters): Promise<BillingBill[]>
  getBill(billId: string): Promise<BillingBill | null>
  voidBill(billId: string, reason: string): Promise<BillingBill>
  listManagerOpenOrders(outletId: string): Promise<BillingOrder[]>
  managerCancelOrder(orderId: string, reason: string): Promise<BillingOrder>
  listAttention(): Promise<BillingAttentionItem[]>
  correctAttention(reference: string, correctionId: string): Promise<BillingAttentionItem>
  discardAttention(reference: string, reason: string): Promise<BillingAttentionItem>
  listDeliveryDiagnostics(outletId: string): Promise<BillingDeliveryDiagnostic[]>
  /** Demo-only clock control; live adapters deliberately omit it. */
  advanceDemoPaymentClock?(milliseconds: number): void
}

/**
 * The settled live command seam. It is intentionally separate from the
 * demo-gated BillingAdapter until #10 promotes the surface and supplies the
 * durable dependency-ordered queue.
 */
export interface BillingCommandAdapter {
  execute(command: BillingCommand): Promise<BillingCommandResult>
  readiness(
    outletId: string,
    businessDate: string,
  ): Promise<{
    status: 'ok' | 'authorization_refused'
    ready?: boolean
    openOrders?: number
    liveShifts?: number
    missingConfirmations?: number
    staleConfirmations?: number
  }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Counter tablets, and the two-device handshake that opens a shift (#9).

/**
 * One tablet, as the management surface reads it.
 *
 * `lastSeenAt` and `lastReportedUnsent` are **what the tablet last said**, never
 * what is true now: they are written by the tablet's own heartbeat, so a tablet
 * that is switched off, offline or broken reports nothing at all and its figures
 * simply stop moving. The surface says "as of" for that reason, and stale
 * telemetry is marked rather than rendered as though it were current.
 */
export interface CounterDeviceSummary {
  id: string
  outletId: string
  label: string
  setUpAt: string
  lastSeenAt: string | null
  lastReportedUnsent: number
}

/**
 * One server-coherent reading of the counter currently standing behind a
 * tablet. This is deliberately smaller than billing history: an oversight
 * phone needs operational totals, not customer or bill contents.
 */
export interface CounterDeviceOperations {
  shiftId: string
  operatorName: string
  openedAt: string
  businessDate: string
  billCount: number
  cashTotalPaise: number
  upiTotalPaise: number
  openOrderCount: number
  /** Cash the shift's effective bill allocations contributed to the drawer. */
  drawerCashPaise: number
}

/**
 * Hardware telemetry and counter operations returned by one database read.
 * `readAt` is stamped by that read, so every operational figure on a card is
 * honestly from the same moment.
 */
export interface CounterDeviceOperationalSnapshot extends CounterDeviceSummary {
  readAt: string
  operations: CounterDeviceOperations | null
}

/**
 * A pending request for somebody to open a counter, as the person it names sees
 * it on their own phone.
 *
 * **There is no code on this type, and that absence is the design.** The column
 * is withheld by grant from every client role, including this person: the code
 * lives on the tablet's screen, which is the whole point of asking for it.
 */
export interface CounterShiftRequest {
  id: string
  deviceId: string
  deviceLabel: string | null
  outletId: string
  outletName: string | null
  createdAt: string
  expiresAt: string
}

/** A live shift, on somebody's hardware. */
export interface LiveCounterShift {
  id: string
  /**
   * Who is accountable. Carried because `counter_shifts_select` admits an
   * outlet's manager and the owner as well as the operator, so "is this mine?"
   * is a question the reader has to be able to answer rather than assume.
   */
  personId: string
  deviceId: string
  deviceLabel: string | null
  outletId: string
  outletName: string | null
  openedAt: string
  businessDate: string
  expiresAt: string
}

/** What the tablet gets back for asking, and the only place the code exists. */
export interface IssuedShiftRequest {
  requestId: string
  /** Four digits, displayed large. Returned to the requesting tablet alone. */
  code: string
  expiresAt: string
}

/**
 * A refusal from the counter handshake.
 *
 * `wrong_code`, `exhausted` and `not_eligible` are deliberately distinct: each
 * is a different thing for the person holding the phone to do next, and none of
 * them says anything about an account other than their own.
 */
export class CounterActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
    this.name = 'CounterActionError'
  }
}

/**
 * Tablets, and the handshake.
 *
 * One interface for three callers — an admin, an operator's phone, and the
 * tablet itself — because the boundary between them is the database's and the
 * Edge Function's, not this seam's. A method offered to a caller who may not use
 * it is refused where refusals belong; splitting the interface would only move
 * the appearance of a boundary somewhere it is not enforced.
 */
export interface CounterAdapter {
  /** Tablets at outlets the caller may see. Removed ones are not listed. */
  listDevices(): Promise<CounterDeviceSummary[]>
  /**
   * One coherent operational read for the requested outlets. RLS still decides
   * which of those outlets the caller may actually see.
   */
  readDeviceOperations(outletIds: readonly string[]): Promise<CounterDeviceOperationalSnapshot[]>
  /**
   * Mint a setup code for an outlet with no live tablet. Returned once and never
   * retrievable: only its hash is kept.
   */
  issueSetupCode(outletId: string, label: string): Promise<{ code: string; validFor: string }>
  /** Permanent, immediate, and it ends any live shift with it. */
  removeDevice(deviceId: string): Promise<void>

  /** The tablet asks for a named person to open the counter. */
  requestShift(username: string): Promise<IssuedShiftRequest>
  /** The tablet withdraws its own request, for the ordinary mistyped name. */
  cancelRequest(): Promise<void>
  /** One request by id, for the tablet watching its own resolve. */
  getRequestResolution(requestId: string): Promise<string | null>

  /** Requests naming the reader, pending and unexpired. */
  listPendingRequests(): Promise<CounterShiftRequest[]>
  /**
   * Live shifts the reader can see, which for a manager or the owner is more
   * than their own. Callers narrow by `personId`.
   */
  listLiveShifts(): Promise<LiveCounterShift[]>
  confirmShift(requestId: string, code: string): Promise<void>
  rejectRequest(requestId: string): Promise<void>
  endShift(shiftId: string): Promise<void>

  /**
   * Be told when a request naming this person, or a shift they hold, changes.
   *
   * Returns an unsubscribe function. **Every surface that uses this must resolve
   * correctly without it** — it is a live nudge over a channel that may be
   * unavailable, not the way the data arrives.
   */
  subscribeToOwnHandshake(personId: string, onChange: () => void): () => void
  /** The tablet's own version of the above, watching its request and its shift. */
  subscribeToDeviceHandshake(deviceId: string, onChange: () => void): () => void
  /**
   * Be told that this outlet's menu or billing activity moved. The event is a
   * nudge only: callers must re-read and must also refresh on foreground so a
   * silently dead channel cannot leave prices or open work stale all evening.
   */
  subscribeToOutletBilling(outletId: string, onChange: () => void): () => void
  /** The tablet's heartbeat: what it last said about itself. */
  reportState(unsent: number): Promise<void>
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
  paymentMethod: PaymentMethod | 'mixed'
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
  cashAddedPaise: number
  cashAddedReason: string | null
  cashRemovedPaise: number
  cashRemovedReason: string | null
  countedCashPaise: number
  /**
   * The commission actually charged on this day, in paise. Never a rate [owner,
   * 2026-08-17]: the take swings between roughly 24% and 35% day to day, so a
   * percentage was an estimate wearing the clothes of an exact figure. Typed off
   * the statement, or read from Zomato where the day is synced.
   *
   * **`null` means undetermined**, not nought. Zomato's Order History shows today's
   * orders but carries no commission and no payout, so a day read tonight knows
   * what came in and cannot know what was kept until its week closes. A channel
   * that sold nothing is charged nought, which is known and therefore not null.
   */
  zomatoCommissionPaise: number | null
  /** Optional, unlike an expense description: it explains a cash difference. */
  note: string | null
  /**
   * Who first recorded this day, and who last corrected it. Frozen and stamped
   * respectively, both by the database. The reading names both where they
   * differ, so a day the owner recorded and a manager later fixed does not read
   * as though the owner entered the figures now on screen (design D6).
   */
  recordedBy: LedgerActor
  updatedBy: LedgerActor | null
  /**
   * Where this day's Zomato figures came from, where the sync covers it. Null on
   * every day recorded before the sync, and on every day at an outlet it does
   * not cover, which is what keeps a historical month computing exactly as it
   * was recorded.
   *
   * It carries no figures of its own. Since commission became an amount, a synced
   * day and a typed day store the same two numbers in the same two columns, and
   * duplicating them here would be inviting the copy to disagree with the
   * original.
   */
  zomatoSettlement: ZomatoSettlement | null
  /**
   * Swiggy's measured reading for the date, on the same terms. Where present it
   * is authoritative over any legacy typed figure in the day's own columns,
   * because a portal read is evidence and a memory is not; where absent — an
   * outlet Swiggy does not cover, or a date before its first read — the typed
   * columns stand exactly as they always did.
   */
  swiggySettlement: ChannelSettlement | null
}

/**
 * A day's measured Zomato figures, and where they came from.
 *
 * It carries the figures now, because they live on their own row rather than the
 * day's, so a caller holding a day has nowhere else to read them. A day the sync
 * has never touched has no settlement at all.
 */
export interface ZomatoSettlement {
  /** What Zomato stated the day took, before commission. */
  revenuePaise: number
  /**
   * What Zomato kept. **`null` means undetermined**, not nought: the week has not
   * settled and no route reaches the figure yet. A channel that sold nothing is
   * charged nought, which is known and so not null.
   */
  commissionPaise: number | null
  /**
   * `provisional` the week is not paid yet; `settled` it is paid and reconciles;
   * `disputed` it is paid and does not. The third is not a kind of provisional:
   * a disputed week will never settle on its own.
   */
  state: 'provisional' | 'settled' | 'disputed'
  /**
   * Which origin wrote the figures: the twice-daily reader, a settlement
   * statement, or a statement supplied by hand when the reader was blocked.
   */
  origin: 'daily_reader' | 'settlement' | 'supplied_by_hand'
  /** What an earlier origin's figures were, where this write replaced them. */
  supersededTyped: { revenuePaise: number; commissionPaise: number | null; at: string } | null
  /**
   * What the day read before its week settled, kept only where settling moved
   * it. Present is precisely what "revised" means.
   */
  revisedFrom: { revenuePaise: number; commissionPaise: number | null } | null
  revisedAt: string | null
}

/**
 * The same shape, on any restaurant channel.
 *
 * Swiggy's channel-day rows carry exactly the facts Zomato's do — stated
 * revenue, commission where determined, the state of the cycle behind them,
 * what superseded what — because both tables are written by the same ingest
 * contract. The alias records that the reading is channel-neutral without
 * renaming a type half the surface already imports.
 */
export type ChannelSettlement = ZomatoSettlement

/** Settled counter allocations that replace typed Cash/UPI after go-live. */
export interface ManualLedgerCounterRevenue {
  cashRevenuePaise: number
  upiRevenuePaise: number
}

/**
 * Who touched a ledger row, as the surface names them.
 *
 * The name is resolved separately from the row, because `profiles` is not
 * readable by everyone who may now read an expense — an Employee sees nobody
 * through it, and nobody at an outlet sees an owner. `manual_ledger_people()`
 * answers exactly these names and nothing else. A null name is a person the
 * caller genuinely cannot resolve rather than an error, and the surface says
 * "someone" rather than inventing one.
 */
export interface LedgerActor {
  id: string
  name: string | null
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
  updatedAt: string
  /**
   * Frozen at insert. Naming it is what makes "your own rows" legible.
   *
   * **Null on a row no person recorded**, which is a row the sync wrote from an
   * aggregator's own deduction record. Naming an account there would put
   * somebody's name on a purchase they never entered; `source` says where it
   * came from instead.
   */
  recordedBy: LedgerActor | null
  /**
   * Where this row came from, when it came from a machine. Null on every row a
   * person entered, which is what the possible-duplicate signal compares.
   */
  source: { system: string; ref: string } | null
  /** Null until somebody corrects the row, so an untouched row names one party. */
  updatedBy: LedgerActor | null
  /**
   * Recorded by an account holding no live assignment at this outlet. Stamped
   * once, never derived on read: an assignment that ends later must not rewrite
   * what was true when the row was written. The surface shows it **only on a
   * drawer expense**, where it explains why expected cash moved without anybody
   * at the outlet spending it (design D9).
   */
  recordedAway: boolean
  /** Set together, by the database. A voided row is visible and stops counting. */
  voidedAt: string | null
  voidedBy: LedgerActor | null
  /** Optional [owner, 2026-08-09]. The trace answers who and when without it. */
  voidedReason: string | null
}

/**
 * The day form's payload. Upserted on `(outlet, business date)` — design D6.
 *
 * Attribution is absent by construction: `recorded_by` defaults from the session
 * and is frozen, `updated_by` is stamped by the guard and refused from a caller.
 * A form that could name either would be asserting something the database is
 * about to overrule.
 *
 * The two Swiggy figures are absent by the same argument that froze Zomato's,
 * one stage later: Swiggy's measured reading arrives through its channel-day
 * row, and a form field would invite typing over it. The columns remain on the
 * table carrying their typed history, so an old month still computes exactly as
 * it was recorded — they are simply no longer writable from here.
 */
export type ManualLedgerDayInput = Omit<
  ManualLedgerDay,
  'recordedBy' | 'updatedBy' | 'zomatoSettlement' | 'swiggySettlement'
>

/**
 * A day as the reading functions want it: the figures, plus the settlements where
 * they exist. Optional so that a caller holding only what a form can write still
 * type-checks — a form cannot write a settlement, and the database refuses one
 * from any signed-in session whatever the types allow. The legacy Swiggy figures
 * are optional for the mirror reason: present only when reading a row that still
 * carries its typed history.
 */
export type ManualLedgerDayFigures = ManualLedgerDayInput & {
  zomatoSettlement?: ZomatoSettlement | null
  swiggySettlement?: ChannelSettlement | null
  /** Typed history only; never written by this app any more. */
  /** Typed history only; `null` meant undetermined then and still does. */
  /**
   * False on a day that has aggregator figures but no cash count — the "day nobody
   * counted", surfaced so its figures still show and total. Absent means
   * counted, so every existing day and form payload needs no change.
   */
  counted?: boolean
}

/**
 * The measured channel readings for one date, independently of a manual ledger
 * row. A cash count is not a prerequisite for either channel to report sales.
 */
export interface ManualLedgerChannelFigures {
  zomato: ZomatoSettlement | null
  swiggy: ChannelSettlement | null
}

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
  // Figures rather than full days: the month reading needs only the figures, and
  // typing it this way lets a date with aggregator figures but no cash count join
  // the list without a ledger row behind it (the "day nobody counted").
  days: ManualLedgerDayFigures[]
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
   * Both channels' figures for a date, whether or not anyone counted the cash.
   * `getDay` returns null on a day with no cash count, but the sync writes each
   * channel to its own table. This virtual reading keeps either (or both) portal
   * figures visible instead of claiming that nothing arrived.
   */
  getDayFigures(outletId: string, businessDate: string): Promise<ManualLedgerChannelFigures | null>
  /** Null before this outlet's billing-live date; zeroes are meaningful after it. */
  getCounterRevenue(
    outletId: string,
    businessDate: string,
  ): Promise<ManualLedgerCounterRevenue | null>
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
  /**
   * Expenses across several business days at once, newest day first — what the
   * staff surface opens on.
   *
   * The caller resolves the dates from the outlet's own cutover, because "the
   * last two business days" is a question about an outlet's clock rather than
   * about the calendar. **The window is a presentation default and not a
   * boundary**: no policy carries a date predicate on reads, and an older
   * expense asked for by id is still returned (design D2).
   */
  listRecentExpenses(
    outletId: string,
    businessDates: readonly string[],
  ): Promise<ManualLedgerExpense[]>
  createExpense(expense: NewManualLedgerExpense): Promise<ManualLedgerExpense>
  updateExpense(id: string, patch: ManualLedgerExpensePatch): Promise<ManualLedgerExpense>
  /**
   * Withdraw an expense. It replaces `deleteExpense`, because once several
   * people write here a row that can vanish without trace defeats the reason to
   * open the surface up at all.
   *
   * The reason is optional [owner, 2026-08-09]: the database stamps who and
   * when, which is what the trace exists to answer, and demanding a sentence on
   * the fastest correction path collects a column of "mistake".
   */
  voidExpense(id: string, reason?: string | null): Promise<ManualLedgerExpense>
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
  /** Tablets, and the handshake that opens a shift on one (#9). */
  counter: CounterAdapter
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
  /** What the Zomato sync has done, and the two things the owner can do about it (#42). */
  aggregatorSync: AggregatorSyncAdapter
  /**
   * The same seam, pointed at Swiggy.
   *
   * An independent session, mailbox and set of figures, so a Zomato outage can
   * never be visible on the Swiggy surface or the reverse. The interface is
   * deliberately shared: runs, reconciliations and channel days answer the same
   * questions, and two interfaces would drift exactly where they agree.
   */
  swiggySync: AggregatorSyncAdapter
}

// ─────────────────────────────────────────────────────────────────────────────
// The aggregator sync, as the owner sees it.

/**
 * One thing that happened, rather than one time the job ran.
 *
 * The sync runs twice a day against every outlet, so a row per run would be
 * roughly a hundred and twenty rows a month of which nearly all say nothing
 * changed — and a log nobody reads is the same as no log. The health line above
 * the list carries "it ran, it was fine"; this list carries only what moved.
 */
export type AggregatorSyncEvent =
  | { kind: 'days-written'; days: number; from: string; to: string }
  | { kind: 'week-settled'; from: string; to: string; netPaise: number }
  | {
      kind: 'day-revised'
      businessDate: string
      /** Both figures, because "it changed" without "from what" is not a record. */
      fromNetPaise: number
      toNetPaise: number
    }
  | {
      kind: 'week-disputed'
      from: string
      to: string
      computedPaise: number
      statedPayoutPaise: number
      differencePaise: number
    }
  | { kind: 'session-lapsed'; detail: string | null }
  | { kind: 'shape-changed'; detail: string | null }
  /**
   * Two expenses that may be the same purchase entered twice.
   *
   * **Both sides are carried, because they will not agree.** A hand-entered row
   * is typed from a paper bill or from memory: the amount may be rounded, the
   * date may be when it was noticed rather than when it was spent, and the note
   * is whatever the owner writes. Reporting one amount and one date would be
   * describing one of the two rows and calling it both.
   *
   * The matching itself is deliberately loose. A flag the owner dismisses costs
   * one tap; a duplicate nobody flags overstates costs and understates profit
   * quietly and permanently. The asymmetry decides the tolerance.
   */
  | {
      kind: 'possible-duplicate-expense'
      typed: { businessDate: string; amountPaise: number; note: string | null; expenseId: string }
      synced: { businessDate: string; amountPaise: number; note: string | null; expenseId: string }
    }

export interface AggregatorSyncEventRow {
  id: string
  outletId: string
  at: string
  event: AggregatorSyncEvent
  /**
   * When this stopped needing anybody, if it ever did.
   *
   * Resolved rather than removed. The page's job is answering "why did this
   * change", so deleting the week that would not reconcile once it was settled
   * would delete the only record that it ever did not. A row that is still
   * listed as needing you after you have dealt with it is the opposite failure,
   * and this is what tells the two apart.
   */
  resolvedAt: string | null
  /**
   * What was decided, where the row was one that offered a choice. Kept so the
   * settled row can say which way it went rather than only that it went.
   */
  resolution?: 'not-a-duplicate'
}

/**
 * Whether the sync is running, quiet, or waiting on somebody.
 *
 * `awaitingOneTimePassword` is deliberately not a kind of `sessionLapsed`. One
 * says the login died and nobody has started fixing it; the other says a repair
 * is under way and the job is waiting for a person to read a code off a phone.
 * They ask different things of the reader, so they are different words.
 */
export interface AggregatorSyncHealth {
  outletId: string
  lastRunAt: string | null
  lastOutcome: 'ok' | 'session_lapsed' | 'shape_changed' | 'reconciliation_failed' | null
  running: boolean
  /** Present while the job is blocked on a one-time password for this outlet. */
  awaitingOneTimePassword: { requestedAt: string; expiresAt: string } | null
  /** Whether the configured channel still has captured session material, never the material itself. */
  hasSession: boolean
  /** Null until an outlet is switched on; the surface says so rather than showing nil. */
  syncedFrom: string | null
}

/**
 * Hyperpure's health, which is account-level and thinner than Zomato's.
 *
 * Hyperpure rides Zomato's login, so it has no reconnect of its own and no
 * one-time-password: a stale session is fixed by reconnecting Zomato, which
 * refreshes both. And it is a supply cost, not a payout, so there is no synced-from
 * boundary and no reconciliation — only whether the last read worked and whether
 * the session it rides is still alive. `shape_changed` is the maintainer's signal;
 * `session_lapsed` is the one that asks the owner to reconnect Zomato.
 */
/**
 * Hyperpure's health, which is account-level and thinner than Zomato's.
 *
 * Hyperpure rides Zomato's login (Model A: one reconnect fixes both channels),
 * but its session can lapse independently of the parent's — and since the
 * capture-only repair landed, a lapsed Hyperpure under a warm Zomato is
 * repaired without any sign-in at all. It is a supply cost, not a payout, so
 * there is no synced-from boundary and no reconciliation — only whether the
 * last read worked and whether the session is still alive. `shape_changed` is
 * the maintainer's signal; `session_lapsed` asks the owner to reconnect.
 */
export interface HyperpureHealth {
  lastRunAt: string | null
  lastOutcome: 'ok' | 'session_lapsed' | 'shape_changed' | null
  running: boolean
  hasSession: boolean
  sessionExpiresAt: string | null
}

/**
 * What a reconnect decided, from the repair ladder.
 *
 * `dispatched` means a runner is on it (capture-only or the full login — the
 * surface follows the health reads either way). `still_signed_in` means the
 * probe found both channels alive and nothing was dispatched: the owner is
 * told so rather than being shown a busy button for nothing.
 */
export type ReconnectResult = { outcome: 'dispatched' | 'still_signed_in' }

export interface AggregatorSyncAdapter {
  getHealth(outletId: string): Promise<AggregatorSyncHealth>
  /**
   * Hyperpure's health, account-level (no outlet). Null-ish fields until the first
   * read runs; the surface shows a read-only line, since reconnect is Zomato's.
   */
  getHyperpureHealth(): Promise<HyperpureHealth>
  listEvents(outletId: string): Promise<AggregatorSyncEventRow[]>
  /**
   * How many things want the owner, per outlet they can reach.
   *
   * Per outlet rather than one total, because two questions are asked of the
   * same read and answering only the first leaves the second unanswerable. The
   * navigation badge wants the sum: a discrepancy at Kanchrapara that only
   * appeared once Kanchrapara was selected would hide exactly when it is
   * needed. The outlet chips want the split, so a reader looking at one outlet
   * can see where the rest of that sum is instead of hunting for it.
   *
   * Tenancy comes from the policies, as it does for every other count.
   */
  countNeedsOwner(): Promise<readonly { outletId: string; needing: number }[]>
  /**
   * Start a run now.
   *
   * Resolves when the run has been *asked for*, not when it has finished — the
   * surface then follows `getHealth`. A call that resolved on dispatch would let
   * a button say "synced" about a job that had not started reading anything.
   */
  requestRun(outletId: string): Promise<void>
  /**
   * Begin repairing a channel, through the repair ladder.
   *
   * The server probes both sessions first: a warm parent with a cold child
   * dispatches the capture-only runner, a cold parent dispatches the full
   * login (whose runner asks for a code only when the login requests one), and
   * two warm channels mean nothing is dispatched at all — the owner simply
   * learns they are still signed in. Resolves once the ladder has decided,
   * not when any repair finished.
   */
  requestReconnect(
    outletId: string,
    channel?: 'zomato' | 'swiggy' | 'hyperpure',
  ): Promise<ReconnectResult>
  /**
   * The code the owner read off their own phone.
   *
   * It is a credential in transit: never logged, never echoed back, never put in
   * a URL. The adapter hands it over and keeps nothing.
   */
  answerOneTimePassword(outletId: string, code: string): Promise<void>
  /** Re-read a disputed week from the aggregator and reconcile it again. */
  recheckWeek(outletId: string, from: string, to: string): Promise<void>
  /** Accept a disputed week, recording the gap rather than absorbing it. */
  acceptDifference(outletId: string, from: string, to: string): Promise<void>
  /**
   * Say that two expenses which look alike are both real.
   *
   * The flag's other ending is the owner withdrawing one of them, which happens
   * in the ledger where the row sits among that day's other costs rather than
   * here, where it is two lines of text out of context. Withdrawing is
   * append-only and cannot be undone, and it should be done looking at the day
   * it changes.
   *
   * This is the answer the ledger cannot give: buying the same thing twice on
   * one day is ordinary, and without a way to say so the flag would sit there
   * forever asking a question that has already been answered.
   */
  markNotDuplicate(outletId: string, eventId: string): Promise<void>
  /**
   * Bring a period in from a statement supplied by hand, when the reader cannot.
   *
   * This is the disaster-recovery path: the file is self-sufficient, parsed by
   * the same code the reader uses, and written for the outlets the caller may
   * reach. It resolves to what was written — which kind of file it was and how it
   * landed — so the surface can say so rather than leaving the owner to wonder
   * whether a silent upload did anything.
   *
   * A `StatementUploadConfirmation`-shaped return with `needsConfirmation` set
   * means the file would replace figures a settlement had already closed; the
   * surface asks, and calls again with `confirmed`.
   */
  uploadStatement(file: StatementUpload): Promise<StatementUploadResult>
}

/** A statement's bytes, on their way to the parser. */
export interface StatementUpload {
  /** The file's own name, kept for the audit trail, never used to recognise it. */
  filename: string
  /** The raw file, base64-encoded for transit. */
  base64: string
  /** Set on a second call to go ahead past a settled-week replacement. */
  confirmed?: boolean
}

export interface StatementUploadResult {
  /** What the file turned out to be, once its content was read. */
  kind:
    | 'zomato-order-history'
    | 'zomato-settlement'
    | 'hyperpure-statement'
    | 'swiggy-annexure'
    | 'swiggy-metrics-evidence'
  /** A short, human line per outlet the upload touched. */
  wrote: readonly string[]
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
