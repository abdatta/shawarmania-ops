import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'
import { personaFixtures } from './personas'

/**
 * The demo's people: the four personas plus enough colleagues either side of
 * the outlet boundary that the Super Admin's cross-outlet list and the
 * Franchise Admin's own-outlet one are visibly different things.
 *
 * Staff are accounts — one record per person, carrying the staff facts the
 * roster table used to hold. The cast deliberately includes every people
 * state an admin has to recognise and repair (demo-mode spec, "unconfigured
 * states"):
 *
 *   * `DEMO_HELPER_ACCOUNT_ID` carries a **placeholder address** — the state
 *     the roster merge mints for someone who never had a login. They cannot
 *     be invited until an admin fixes the address; the People surface says so.
 *   * `PENDING_ACCOUNT_ID` has an **invite outstanding** — provisioned,
 *     activated by nobody yet.
 *   * `Demo Former Staff` has **left** (`left_on` set): off the staff list,
 *     every record intact.
 *   * `DEMO_PREP_COOK_ACCOUNT_ID` is **deactivated without leaving** — the
 *     panic-button state. Access cut, still on today's attendance day.
 *
 * Typed from the generated schema types like every fixture, so a column the
 * database does not have fails to compile (docs/DEMO_MODE.md).
 */

const FIXTURE_CREATED_AT = '2026-07-26T00:00:00+00:00'

/** An ordinary active colleague — the manual-entry demo records their check-out. */
export const DEMO_GRILLER_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000006'
/** The placeholder-address person: cannot be invited until the address is fixed. */
export const DEMO_HELPER_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000011'
/** Deactivated with `left_on` null: the panic-button state, still on the day. */
export const DEMO_PREP_COOK_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000013'
/** Today's blocked check-in awaiting a decision belongs to this person. */
export const DEMO_RUNNER_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000014'

const colleagues = [
  {
    id: 'd1000000-0000-4000-a000-000000000005',
    full_name: 'Demo Manager (Kanchrapara)',
    phone: null,
    role: 'franchise_admin',
    outlet_id: OUTLET_KANCHRAPARA_ID,
    is_active: true,
    staff_code: 'KPA-02',
    role_title: 'Manager',
    joined_on: '2025-09-15',
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: DEMO_GRILLER_ACCOUNT_ID,
    full_name: 'Demo Griller',
    phone: null,
    role: 'employee',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: true,
    staff_code: 'KAL-02',
    role_title: 'Grill',
    joined_on: '2025-11-03',
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: 'd1000000-0000-4000-a000-000000000007',
    full_name: 'Demo Evening Biller',
    phone: null,
    role: 'biller',
    outlet_id: OUTLET_KANCHRAPARA_ID,
    is_active: true,
    staff_code: null,
    role_title: null,
    joined_on: null,
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    // Someone provisioned but not yet activated: the state the People surface
    // most needs to show honestly, and the one a screenshot never captures.
    id: 'd1000000-0000-4000-a000-000000000008',
    full_name: 'Demo New Starter',
    phone: null,
    role: 'employee',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: true,
    staff_code: 'KAL-06',
    role_title: 'Prep',
    joined_on: '2026-07-20',
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    // Departed: off the staff list, history intact, access ended. The normal
    // end state — both facts set, because the departure flow offers both.
    id: 'd1000000-0000-4000-a000-000000000009',
    full_name: 'Demo Former Staff',
    phone: null,
    role: 'employee',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: false,
    staff_code: 'KAL-04',
    role_title: 'Counter staff',
    joined_on: '2025-02-01',
    left_on: '2026-06-30',
    created_at: FIXTURE_CREATED_AT,
  },
  {
    // Kalyani's second biller. A counter tablet is shared, and a handover needs
    // somebody to hand over *to* — with one biller the shift screen can only
    // demonstrate closing and reopening as the same person, which is the one
    // case that never happens in a shop.
    id: 'd1000000-0000-4000-a000-000000000010',
    full_name: 'Demo Morning Biller',
    phone: null,
    role: 'biller',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: true,
    staff_code: null,
    role_title: null,
    joined_on: null,
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    // The roster merge's leftover: an account minted for somebody who never
    // had a login, still on its placeholder address. createDemoAccounts gives
    // this one `…@placeholder.invalid` instead of a demo address.
    id: DEMO_HELPER_ACCOUNT_ID,
    full_name: 'Demo Helper',
    phone: null,
    role: 'employee',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: true,
    staff_code: 'KAL-03',
    role_title: 'Prep',
    joined_on: '2026-04-20',
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: 'd1000000-0000-4000-a000-000000000012',
    full_name: 'Demo Kanchrapara Staff',
    phone: null,
    role: 'employee',
    outlet_id: OUTLET_KANCHRAPARA_ID,
    is_active: true,
    staff_code: 'KPA-01',
    role_title: 'Counter staff',
    joined_on: '2026-02-15',
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    // Access cut, still employed: the state one bit could never express, and
    // the reason left_on and is_active are two columns. Checked in this
    // morning; still on the attendance day.
    id: DEMO_PREP_COOK_ACCOUNT_ID,
    full_name: 'Demo Prep Cook',
    phone: null,
    role: 'employee',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: false,
    staff_code: 'KAL-07',
    role_title: 'Prep',
    joined_on: '2026-03-10',
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: DEMO_RUNNER_ACCOUNT_ID,
    full_name: 'Demo Runner',
    phone: null,
    role: 'employee',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: true,
    staff_code: 'KAL-08',
    role_title: 'Runner',
    joined_on: '2026-05-05',
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
] as const satisfies readonly Tables<'profiles'>[]

export const accountFixtures: readonly Tables<'profiles'>[] = [
  personaFixtures.super_admin.profile,
  personaFixtures.franchise_admin.profile,
  personaFixtures.biller.profile,
  personaFixtures.employee.profile,
  ...colleagues,
]

/** The one demo account whose invite is still outstanding. */
export const PENDING_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000008'
