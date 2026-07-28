import type { MovementType, SyncStateKind } from '@/domain'
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
  /**
   * The three characters every staff code at this outlet begins with.
   *
   * Optional here: when it is absent or blank the database derives one from the
   * outlet code — first three alphanumerics, uppercased, with a numeric suffix
   * if that is taken — so a caller that does not care still gets a valid,
   * unique prefix. The outlet form does care, and sends a pre-filled, editable
   * value, because this string ends up on every staff code at the outlet
   * forever.
   */
  staffCodePrefix?: string
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  district?: string | null
  pincode?: string | null
  phone?: string | null
  /** `HH:MM`, the per-outlet business-day boundary. */
  businessDayCutover?: string
}

export type OutletPatch = Partial<
  NewOutlet & {
    isActive: boolean
  }
>

/**
 * One thing still attached to an outlet, and how much of it. `table` is a
 * database identifier — `employees`, `counter_devices` — because the set is
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

export type AppRole = Tables<'profiles'>['role']

/** One row of the People / Access surfaces: the account and its invite state. */
export interface AccountSummary {
  id: string
  fullName: string
  /**
   * The address this account signs in with, or null when the caller may not
   * see it — a Biller on the counter tablet gets null for everyone, because
   * colleagues' contact details have no business being ambient on a shared
   * device (design D12).
   *
   * It is not a column on `profiles`; it lives in `auth.users` and reaches
   * here only through the privileged function. Null therefore also covers "the
   * lookup failed", which degrades the list to names rather than blanking it.
   */
  email: string | null
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
  invite: { expiresAt: string } | null
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
  /**
   * Correct the address an account signs in with. Any outstanding one-time
   * code survives — it is bound to the account, not the address, so it starts
   * working the moment the address is right (design D13).
   */
  changeEmail(profileId: string, email: string): Promise<void>
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

/** A refusal from the attendance write path. */
export class AttendanceActionError extends DataActionError {
  constructor(code: string, message: string) {
    super(code, message)
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
  approveOverride(
    attendanceId: string,
    reason: string,
    approverId: string,
  ): Promise<AttendanceRecord>
}

/**
 * The app account linked to a roster row, resolved alongside it.
 *
 * Carried on the summary rather than joined in a screen because
 * `getOwnEmployee` needs it too, and an Employee has no permission to list
 * accounts (design D7). Its absence is the answer to "why can this person not
 * check in?", so it is never merely omitted — it is null, and the screens say
 * what null means.
 */
export interface LinkedAccount {
  id: string
  fullName: string
  isActive: boolean
}

/** One roster row. Distinct from an app account: an employee may have no login. */
export interface EmployeeSummary {
  id: string
  outletId: string
  profileId: string | null
  linkedAccount: LinkedAccount | null
  employeeCode: string
  fullName: string
  phone: string | null
  roleTitle: string | null
  employmentStatus: EmploymentStatus
  joinedOn: string | null
}

export interface NewEmployee {
  outletId: string
  /**
   * Optional, and normally omitted: **the database issues it**.
   *
   * A `before insert` trigger fills a blank or absent code with the outlet's
   * `staff_code_prefix` and four Crockford base32 characters — `KAL-7KQ2`.
   * Nothing at this call site reveals that, which is the price of making "a
   * roster row always has a sensible code" a property of the table rather than
   * a habit of one caller.
   *
   * Supplying one still wins, unchanged, so an import that arrives with its own
   * numbering scheme keeps working.
   */
  employeeCode?: string
  fullName: string
  phone?: string | null
  roleTitle?: string | null
  joinedOn?: string | null
  /**
   * Link the row to an app account as it is created — one write rather than
   * two, which is what provisioning-with-a-roster-row does.
   */
  profileId?: string | null
}

export type EmployeePatch = Partial<
  Pick<EmployeeSummary, 'fullName' | 'phone' | 'roleTitle' | 'employmentStatus' | 'joinedOn'> & {
    /**
     * **Only a Super Admin may send this, and the database is what enforces
     * that** — an `employee_code_guard` trigger, not this type and not the form
     * control. `employees_update` is a row policy, and a row policy permits
     * every column on a row it permits, so a Franchise Admin can otherwise
     * change a code freely. Send it only when the value actually changed;
     * writing the same code back is not a change and does not trip the guard,
     * but sending it on every ordinary edit invites one.
     */
    employeeCode: string
  }
>

export interface EmployeesAdapter {
  /** The outlet's roster. */
  listEmployees(outletId: string): Promise<EmployeeSummary[]>
  /** The caller's own roster row, or null if they are not on one. */
  getOwnEmployee(): Promise<EmployeeSummary | null>
  createEmployee(employee: NewEmployee): Promise<EmployeeSummary>
  updateEmployee(id: string, patch: EmployeePatch): Promise<EmployeeSummary>
  /**
   * Join an app account to a roster row. The database refuses a cross-outlet
   * link and a second link to the same account; the caller's authority over
   * the roster row is the `employees_update` policy's business, not this
   * method's.
   */
  linkAccount(employeeId: string, profileId: string): Promise<EmployeeSummary>
  /**
   * Separate them again. Attendance already recorded against the roster row
   * stays exactly where it is — the days were worked.
   */
  unlinkAccount(employeeId: string): Promise<EmployeeSummary>
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

export type ExpenseCategory = Tables<'expenses'>['category']

export interface ExpenseRecord {
  id: string
  outletId: string
  businessDate: string
  category: ExpenseCategory
  amountPaise: number
  paymentMethod: PaymentMethod
  description: string | null
  createdAt: string
}

export interface NewExpense {
  outletId: string
  businessDate: string
  category: ExpenseCategory
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

/** The bag of domain adapters a session provider supplies to its tree. */
export interface DataAdapters {
  outlets: OutletsAdapter
  accounts: AccountsAdapter
  attendance: AttendanceAdapter
  employees: EmployeesAdapter
  menu: MenuAdapter
  billing: BillingAdapter
  inventory: InventoryAdapter
  expenses: ExpensesAdapter
  dailyCash: DailyCashAdapter
  addressLookup: AddressLookupAdapter
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
