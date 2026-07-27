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

export interface OutletsAdapter {
  /** Active outlets, for the surfaces a role can see. */
  listOutlets(): Promise<Tables<'outlets'>[]>
  /** One outlet by id, or null if it does not exist. */
  getOutlet(id: string): Promise<Tables<'outlets'> | null>
  /**
   * Record an outlet's surveyed position. Super Admin only — enforced by the
   * `outlets_update` policy, not by whether this method is offered (design D4).
   */
  saveLocation(id: string, location: OutletLocation): Promise<Tables<'outlets'>>
}

export type AppRole = Tables<'profiles'>['role']

/** One row of the People / Access surfaces: the account and its invite state. */
export interface AccountSummary {
  id: string
  fullName: string
  phone: string | null
  role: AppRole
  outletId: string | null
  isActive: boolean
  /**
   * The outstanding invite, if there is one. Never carries the code — the
   * hash column is not readable by any client (see the account_invites
   * migration), and the code itself exists only in the response that issued
   * it. "Pending since Tuesday" is all a list can honestly show.
   */
  invite: { expiresAt: string; attempts: number } | null
}

export interface NewAccount {
  fullName: string
  email: string
  phone?: string | null
  role: AppRole
  outletId: string | null
}

/** The one-time code, returned once and never retrievable again. */
export interface IssuedCode {
  profileId: string
  code: string
  expiresAt: string
}

/**
 * A refusal the UI can say something useful about. The `code` is the
 * machine-readable one the privileged function returned; anything unrecognised
 * surfaces as a generic failure rather than as a leaked internal string.
 */
export class AccountActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AccountActionError'
  }
}

/**
 * Account management as the admin surfaces need it. Every write here is a
 * privileged operation that runs server-side with the service-role key — the
 * adapter is the seam in front of it, not the thing doing it.
 */
export interface AccountsAdapter {
  /** Accounts the caller may see: all outlets for the Super Admin, one for a Franchise Admin. */
  listAccounts(): Promise<AccountSummary[]>
  provision(account: NewAccount): Promise<IssuedCode>
  reissue(profileId: string): Promise<IssuedCode>
  setActive(profileId: string, isActive: boolean): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Attendance and the roster.

export type AttendanceStatus = Tables<'attendance'>['status']
export type CheckInSource = Tables<'attendance'>['check_in_source']
export type EmploymentStatus = Tables<'employees'>['employment_status']

/**
 * One captured location event — a check-in or a check-out.
 *
 * `distanceMetres` is the database's answer, not the client's: it is recomputed
 * from the coordinates on every write, so a row cannot show a distance its own
 * coordinates contradict. It is null when the fence could not be evaluated at
 * all — no coordinates were supplied, or the outlet has never been surveyed —
 * and that is reported as unknown rather than guessed at.
 */
export interface AttendanceEvent {
  at: string
  latitude: number | null
  longitude: number | null
  accuracyMetres: number | null
  distanceMetres: number | null
  source: CheckInSource | null
}

/** Who cleared a blocked check-in, when, and why. */
export interface AttendanceOverride {
  by: string
  /** Snapshot on the row, so the employee it concerns can read it too. */
  byName: string | null
  at: string
  reason: string
}

/**
 * One employee's day. Deliberately one shape for both the manager's day view
 * and the employee's own history: the proposal's insistence that an employee
 * sees exactly what their manager sees is easiest to keep true when there is
 * only one thing to render.
 */
export interface AttendanceRecord {
  id: string
  outletId: string
  employeeId: string
  employeeCode: string
  employeeName: string
  businessDate: string
  status: AttendanceStatus
  checkIn: AttendanceEvent | null
  checkOut: AttendanceEvent | null
  override: AttendanceOverride | null
}

export interface CheckInInput {
  employeeId: string
  outletId: string
  businessDate: string
  /**
   * Null when the device could not supply one — permission refused, no fix.
   * The record is still written, because the override path needs a row to
   * point at; the database declines to count it present until a manager does.
   */
  reading: PositionReading | null
}

export interface CheckOutInput {
  attendanceId: string
  /** Null for the same reasons. A check-out is never refused (design D3). */
  reading: PositionReading | null
}

/**
 * A refusal an attendance surface can say something useful about, rather than
 * surfacing a raw Postgres message to someone standing at a counter.
 */
export class AttendanceActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AttendanceActionError'
  }
}

export interface AttendanceAdapter {
  /**
   * One employee's record for a business date, or null if they have not
   * started. The employee id is explicit rather than implied by the session:
   * a query should mean one thing, and RLS should be the second line of
   * defence rather than the only thing that makes it correct.
   */
  getDay(employeeId: string, businessDate: string): Promise<AttendanceRecord | null>
  /** One employee's history, most recent business date first. */
  listHistory(employeeId: string, limit?: number): Promise<AttendanceRecord[]>
  /** One outlet's day, for a manager. */
  listOutletDay(outletId: string, businessDate: string): Promise<AttendanceRecord[]>
  /**
   * Record a check-in with its evidence. The claim is always `present`; whether
   * it survives is the database's call, and an out-of-fence row comes back
   * `absent` and awaiting an override.
   */
  checkIn(input: CheckInInput): Promise<AttendanceRecord>
  checkOut(input: CheckOutInput): Promise<AttendanceRecord>
  /**
   * Clear a blocked check-in. `approverId` must be the calling session's own
   * id — the database refuses anything else, so this argument is a convenience
   * for the caller, never a trust boundary.
   */
  approveOverride(attendanceId: string, reason: string, approverId: string): Promise<AttendanceRecord>
}

/** One roster row. Distinct from an app account: an employee may have no login. */
export interface EmployeeSummary {
  id: string
  outletId: string
  profileId: string | null
  employeeCode: string
  fullName: string
  phone: string | null
  roleTitle: string | null
  employmentStatus: EmploymentStatus
  joinedOn: string | null
}

export interface NewEmployee {
  outletId: string
  employeeCode: string
  fullName: string
  phone?: string | null
  roleTitle?: string | null
  joinedOn?: string | null
}

export type EmployeePatch = Partial<
  Pick<EmployeeSummary, 'fullName' | 'phone' | 'roleTitle' | 'employmentStatus' | 'joinedOn'>
>

export interface EmployeesAdapter {
  /** The outlet's roster. */
  listEmployees(outletId: string): Promise<EmployeeSummary[]>
  /** The caller's own roster row, or null if they are not on one. */
  getOwnEmployee(): Promise<EmployeeSummary | null>
  createEmployee(employee: NewEmployee): Promise<EmployeeSummary>
  updateEmployee(id: string, patch: EmployeePatch): Promise<EmployeeSummary>
}

/** The bag of domain adapters a session provider supplies to its tree. */
export interface DataAdapters {
  outlets: OutletsAdapter
  accounts: AccountsAdapter
  attendance: AttendanceAdapter
  employees: EmployeesAdapter
}
