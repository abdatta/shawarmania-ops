import type {
  AlertPriority as DomainAlertPriority,
  AlertStatus as DomainAlertStatus,
  MovementType as DomainMovementType,
} from '@/domain'

import type { Tables } from '../../database.types'
import { accountFixtures } from './accounts'
import { menuItemFixtures } from './menu'
import { outletFixtures } from './outlets'

/**
 * The compile-time drift proof, stated as code: a fixture the database could
 * not serve fails to compile. This file is type-checked (`npm run typecheck`
 * and the build) but never executed — if any `@ts-expect-error` below stops
 * erroring, the schema types have drifted loose of what fixtures assume, and
 * tsc fails the build with "unused @ts-expect-error".
 */

const validOutlet = outletFixtures[0] as Tables<'outlets'>

// A fixture must not carry a column the schema lacks.
export const columnTheSchemaLacks: Tables<'outlets'> = {
  ...validOutlet,
  // @ts-expect-error — `nickname` is not a column of outlets.
  nickname: 'shack',
}

// A fixture must not assign the wrong type to a real column.
export const wrongValueType: Pick<Tables<'outlets'>, 'geofence_radius_m'> = {
  // @ts-expect-error — geofence_radius_m is a number, not a string.
  geofence_radius_m: '150',
}

// A fixture must not omit a required column.
// @ts-expect-error — a bare object misses every required outlets column.
export const missingRequiredColumns: Tables<'outlets'> = {}

// A fixture must not invent enum members.
export const inventedRole: Pick<Tables<'profiles'>, 'role'> = {
  // @ts-expect-error — 'intern' is not an app_role.
  role: 'intern',
}

// The same proof for the people fixtures — staff are accounts, and the staff
// facts live on profiles.
const validAccount = accountFixtures[0] as Tables<'profiles'>

export const accountColumnTheSchemaLacks: Tables<'profiles'> = {
  ...validAccount,
  // @ts-expect-error — `nickname` is not a column of profiles.
  nickname: 'chef',
}

// The merged staff facts must exist with the types the adapters assume.
export const staffFactsShape: Pick<
  Tables<'profiles'>,
  'staff_code' | 'role_title' | 'joined_on' | 'left_on'
> = {
  staff_code: 'KAL-01',
  role_title: 'Counter staff',
  joined_on: '2026-01-12',
  left_on: null,
}

// @ts-expect-error — `salary_paise` was dropped, not moved: no payroll here.
export const payrollStaysOutside: Pick<Tables<'profiles'>, 'salary_paise'> = {
  salary_paise: 0,
}

// The evidence columns attendance relies on must exist with the types the
// adapters assume — a fixture or an adapter that drifted from the schema
// would fail here rather than at runtime in front of an employee.
export const attendanceEvidenceShape: Pick<
  Tables<'attendance'>,
  | 'check_in_distance_m'
  | 'check_in_accuracy_m'
  | 'check_in_source'
  | 'override_by_name'
  | 'person_id'
  | 'check_in_entered_by'
  | 'check_in_entered_by_name'
> = {
  check_in_distance_m: 11.6,
  check_in_accuracy_m: 14,
  check_in_source: 'phone',
  override_by_name: 'Demo Manager',
  person_id: 'd1000000-0000-4000-a000-000000000004',
  check_in_entered_by: null,
  check_in_entered_by_name: null,
}

export const inventedCheckInSource: Pick<Tables<'attendance'>, 'check_in_source'> = {
  // @ts-expect-error — 'smartwatch' is not a check_in_source.
  check_in_source: 'smartwatch',
}

// 'manual' is: an admin typed the event in, and the row says who.
export const manualCheckInSource: Pick<Tables<'attendance'>, 'check_in_source'> = {
  check_in_source: 'manual',
}

// The outlet capture evidence added by this change.
export const outletCaptureShape: Pick<
  Tables<'outlets'>,
  'location_accuracy_m' | 'location_captured_at'
> = {
  location_accuracy_m: 9,
  location_captured_at: '2026-07-24T09:15:00+00:00',
}

// ── The menu fixtures the operational surfaces and the counter both read ─────

const validMenuItem = menuItemFixtures[0] as Tables<'menu_items'>

export const menuItemColumnTheSchemaLacks: Tables<'menu_items'> = {
  ...validMenuItem,
  // @ts-expect-error — `calories` is not a column of menu_items.
  calories: 420,
}

// The rule that matters most here: a price is integer paise, and paise are a
// number of them. A fixture that wrote ₹139 as `139.00` would compile if this
// column were loosely typed, and would then be a hundredfold error in a till.
export const menuPriceIsANumber: Pick<Tables<'menu_items'>, 'price_paise'> = {
  // @ts-expect-error — price_paise is a number, not a string.
  price_paise: '13900',
}

// @ts-expect-error — a bare object misses every required menu_items column.
export const menuItemMissingRequiredColumns: Tables<'menu_items'> = {}

export const menuCategoryShape: Pick<Tables<'menu_categories'>, 'sort_order' | 'is_active'> = {
  sort_order: 1,
  is_active: true,
}

// Bill line items are what make a price change safe: they carry their own
// snapshot of the name and the price charged, so the counter can never join a
// historical bill back to the live menu.
export const billItemSnapshotShape: Pick<
  Tables<'bill_items'>,
  'item_name' | 'unit_price_paise' | 'line_total_paise' | 'quantity'
> = {
  item_name: 'Classic Chicken Shawarma',
  unit_price_paise: 13900,
  line_total_paise: 27800,
  quantity: 2,
}

export const inventedPaymentMethod: Pick<Tables<'bills'>, 'payment_method'> = {
  // @ts-expect-error — 'paytm' is not a payment_method.
  payment_method: 'paytm',
}

export const inventedMovementType: Pick<Tables<'inventory_movements'>, 'movement_type'> = {
  // @ts-expect-error — 'spoiled' is not a movement_type.
  movement_type: 'spoiled',
}

export const inventedExpenseCategory: Pick<Tables<'expenses'>, 'category'> = {
  // @ts-expect-error — 'travel' is not an expense_category.
  category: 'travel',
}

/**
 * `src/domain/` imports from nothing, so it carries its own literal union of
 * movement types rather than reading the schema's enum. This is what keeps the
 * copy honest: adding or renaming a `movement_type` in the database and not in
 * the domain fails the build here, instead of producing a ledger that silently
 * cannot describe one of its own rows.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

export const movementTypesAgreeWithSchema: MutuallyAssignable<
  DomainMovementType,
  Tables<'inventory_movements'>['movement_type']
> = true

// ── Alerts, added by the owner console ──────────────────────────────────────

const validAlert: Tables<'alerts'> = {
  id: 'de000000-0000-4000-a000-000000000001',
  outlet_id: 'd0000000-0000-4000-a000-000000000001',
  raised_by: 'd1000000-0000-4000-a000-000000000002',
  category: 'inventory',
  priority: 'high',
  status: 'open',
  subject: 'Pita bread will not last tomorrow',
  message: 'Down to 8 packets.',
  created_at: '2026-07-28T05:10:00+00:00',
}

export const alertColumnTheSchemaLacks: Tables<'alerts'> = {
  ...validAlert,
  // @ts-expect-error — `assignee` is not a column of alerts; alerts are not routed.
  assignee: 'someone',
}

// @ts-expect-error — a bare object misses every required alerts column.
export const alertMissingRequiredColumns: Tables<'alerts'> = {}

export const inventedAlertCategory: Pick<Tables<'alerts'>, 'category'> = {
  // @ts-expect-error — 'weather' is not an alert_category.
  category: 'weather',
}

export const inventedAlertPriority: Pick<Tables<'alerts'>, 'priority'> = {
  // @ts-expect-error — 'critical' is not an alert_priority.
  priority: 'critical',
}

export const inventedAlertStatus: Pick<Tables<'alerts'>, 'status'> = {
  // @ts-expect-error — 'wontfix' is not an alert_status.
  status: 'wontfix',
}

/** The same standing proof for the alert lifecycle's own literal unions. */
export const alertStatusesAgreeWithSchema: MutuallyAssignable<
  DomainAlertStatus,
  Tables<'alerts'>['status']
> = true

export const alertPrioritiesAgreeWithSchema: MutuallyAssignable<
  DomainAlertPriority,
  Tables<'alerts'>['priority']
> = true
