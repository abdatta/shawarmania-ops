import type { Assignment } from '@/data-access/adapters'

import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'
import { liveAssignment, personaFixtures } from './personas'

/**
 * The demo's people: the four personas plus enough colleagues either side of
 * the outlet boundary that the Super Admin's cross-outlet list and the
 * Franchise Admin's own-outlet one are visibly different things.
 *
 * Staff are accounts — one record per person — and since multi-outlet-people
 * where they work is a set of assignments rather than a column. The cast
 * deliberately includes every people state an admin has to recognise and
 * repair (demo-mode spec, "unconfigured states"):
 *
 *   * `DEMO_HELPER_ACCOUNT_ID` carries a **placeholder address** — the state
 *     the roster merge mints for someone who never had a login. They cannot
 *     be invited until an admin fixes the address; the People surface says so.
 *   * `PENDING_ACCOUNT_ID` has an **invite outstanding** — provisioned,
 *     activated by nobody yet.
 *   * `Demo Former Staff` holds **no live assignment**: off every staff list,
 *     every record intact. That is what "departed" means now — a derived
 *     state, not a column.
 *   * `DEMO_PREP_COOK_ACCOUNT_ID` is **deactivated while still assigned** —
 *     the panic-button state. Access cut, still on today's attendance day.
 *   * `DEMO_SPLIT_SHIFT_ACCOUNT_ID` works at **both outlets**, and
 *     `DEMO_RETURNER_ACCOUNT_ID` **used to** work at the second one — one
 *     assignment ended, the other still running.
 *
 * Typed from the generated schema types like every fixture, so a column the
 * database does not have fails to compile (docs/DEMO_MODE.md).
 */

const FIXTURE_CREATED_AT = '2026-07-26T00:00:00+00:00'

/** An ordinary active colleague — the manual-entry demo records their check-out. */
export const DEMO_GRILLER_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000006'
/** The placeholder-address person: cannot be invited until the address is fixed. */
export const DEMO_HELPER_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000011'
/** Deactivated while still assigned: the panic-button state, still on the day. */
export const DEMO_PREP_COOK_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000013'
/** Today's blocked check-in awaiting a decision belongs to this person. */
export const DEMO_RUNNER_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000014'
/** One login, two outlets — the person this whole change exists for. */
export const DEMO_SPLIT_SHIFT_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000015'
/** Still at Kalyani; their Kanchrapara assignment ended in the spring. */
export const DEMO_RETURNER_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000016'
/** Holds no live assignment at all: the person who has left the business. */
export const DEMO_FORMER_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000009'

const colleagues = [
  {
    id: 'd1000000-0000-4000-a000-000000000005',
    full_name: 'Demo Manager (Kanchrapara)',
    phone: null,
    is_active: true,
    role_title: 'Manager',
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: DEMO_GRILLER_ACCOUNT_ID,
    full_name: 'Demo Griller',
    phone: null,
    is_active: true,
    role_title: 'Grill',
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: 'd1000000-0000-4000-a000-000000000007',
    full_name: 'Demo Evening Biller',
    phone: null,
    is_active: true,
    role_title: null,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    // Someone provisioned but not yet activated: the state the People surface
    // most needs to show honestly, and the one a screenshot never captures.
    id: 'd1000000-0000-4000-a000-000000000008',
    full_name: 'Demo New Starter',
    phone: null,
    is_active: true,
    role_title: 'Prep',
    created_at: FIXTURE_CREATED_AT,
  },
  {
    // Left the business: no live assignment anywhere, access ended. The normal
    // end state — both facts, because the departure flow offers both.
    id: DEMO_FORMER_ACCOUNT_ID,
    full_name: 'Demo Former Staff',
    phone: null,
    is_active: false,
    role_title: 'Counter staff',
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
    is_active: true,
    role_title: null,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    // The roster merge's leftover: an account minted for somebody who never
    // had a login, still on its placeholder address. createDemoAccounts gives
    // this one `…@placeholder.invalid` instead of a demo address.
    id: DEMO_HELPER_ACCOUNT_ID,
    full_name: 'Demo Helper',
    phone: null,
    is_active: true,
    role_title: 'Prep',
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: 'd1000000-0000-4000-a000-000000000012',
    full_name: 'Demo Kanchrapara Staff',
    phone: null,
    is_active: true,
    role_title: 'Counter staff',
    created_at: FIXTURE_CREATED_AT,
  },
  {
    // Access cut, still assigned: the state one bit could never express, and
    // the reason deactivation and placement are two separate facts. Checked in
    // this morning; still on the attendance day.
    id: DEMO_PREP_COOK_ACCOUNT_ID,
    full_name: 'Demo Prep Cook',
    phone: null,
    is_active: false,
    role_title: 'Prep',
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: DEMO_RUNNER_ACCOUNT_ID,
    full_name: 'Demo Runner',
    phone: null,
    is_active: true,
    role_title: 'Runner',
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: DEMO_SPLIT_SHIFT_ACCOUNT_ID,
    full_name: 'Demo Split Shift',
    phone: null,
    is_active: true,
    role_title: 'Counter staff',
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: DEMO_RETURNER_ACCOUNT_ID,
    full_name: 'Demo Returner',
    phone: null,
    is_active: true,
    role_title: 'Grill',
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

/**
 * Who works where. One row per person per outlet, ended rows kept — the same
 * shape the database holds, so a mock that drifts from it is a mock that would
 * teach the wrong lesson about what the People surface can show.
 */
export const assignmentFixtures: Readonly<Record<string, Assignment[]>> = {
  [personaFixtures.super_admin.profile.id]: personaFixtures.super_admin.assignments,
  [personaFixtures.franchise_admin.profile.id]: personaFixtures.franchise_admin.assignments,
  [personaFixtures.biller.profile.id]: personaFixtures.biller.assignments,
  [personaFixtures.employee.profile.id]: personaFixtures.employee.assignments,

  'd1000000-0000-4000-a000-000000000005': [
    liveAssignment(
      'da000000-0000-4000-a000-000000000010',
      'franchise_admin',
      OUTLET_KANCHRAPARA_ID,
      '2025-09-15',
    ),
  ],
  [DEMO_GRILLER_ACCOUNT_ID]: [
    liveAssignment(
      'da000000-0000-4000-a000-000000000011',
      'employee',
      OUTLET_KALYANI_ID,
      '2025-11-03',
    ),
  ],
  'd1000000-0000-4000-a000-000000000007': [
    liveAssignment(
      'da000000-0000-4000-a000-000000000012',
      'biller',
      OUTLET_KANCHRAPARA_ID,
      '2025-10-01',
    ),
  ],
  'd1000000-0000-4000-a000-000000000008': [
    liveAssignment(
      'da000000-0000-4000-a000-000000000013',
      'employee',
      OUTLET_KALYANI_ID,
      '2026-07-20',
    ),
  ],
  // Departed: the assignment is ended, not removed. The days they worked stay
  // explicable, and the row is what explains them.
  [DEMO_FORMER_ACCOUNT_ID]: [
    {
      id: 'da000000-0000-4000-a000-000000000014',
      role: 'employee',
      outletId: OUTLET_KALYANI_ID,
      startedOn: '2025-02-01',
      endedOn: '2026-06-30',
    },
  ],
  'd1000000-0000-4000-a000-000000000010': [
    liveAssignment(
      'da000000-0000-4000-a000-000000000015',
      'biller',
      OUTLET_KALYANI_ID,
      '2025-12-01',
    ),
  ],
  [DEMO_HELPER_ACCOUNT_ID]: [
    liveAssignment(
      'da000000-0000-4000-a000-000000000016',
      'employee',
      OUTLET_KALYANI_ID,
      '2026-04-20',
    ),
  ],
  'd1000000-0000-4000-a000-000000000012': [
    liveAssignment(
      'da000000-0000-4000-a000-000000000017',
      'employee',
      OUTLET_KANCHRAPARA_ID,
      '2026-02-15',
    ),
  ],
  [DEMO_PREP_COOK_ACCOUNT_ID]: [
    liveAssignment(
      'da000000-0000-4000-a000-000000000018',
      'employee',
      OUTLET_KALYANI_ID,
      '2026-03-10',
    ),
  ],
  [DEMO_RUNNER_ACCOUNT_ID]: [
    liveAssignment(
      'da000000-0000-4000-a000-000000000019',
      'employee',
      OUTLET_KALYANI_ID,
      '2026-05-05',
    ),
  ],
  // Two live assignments, one login. Their attendance shows a morning at
  // Kalyani and an evening at Kanchrapara on the same business day.
  [DEMO_SPLIT_SHIFT_ACCOUNT_ID]: [
    liveAssignment(
      'da000000-0000-4000-a000-000000000020',
      'employee',
      OUTLET_KALYANI_ID,
      '2026-05-20',
    ),
    liveAssignment(
      'da000000-0000-4000-a000-000000000021',
      'employee',
      OUTLET_KANCHRAPARA_ID,
      '2026-06-15',
    ),
  ],
  // One ended, one running: leaving an outlet is not leaving the business.
  [DEMO_RETURNER_ACCOUNT_ID]: [
    liveAssignment(
      'da000000-0000-4000-a000-000000000022',
      'employee',
      OUTLET_KALYANI_ID,
      '2026-04-01',
    ),
    {
      id: 'da000000-0000-4000-a000-000000000023',
      role: 'employee',
      outletId: OUTLET_KANCHRAPARA_ID,
      startedOn: '2025-11-01',
      endedOn: '2026-03-31',
    },
  ],
}

/** The one demo account whose invite is still outstanding. */
export const PENDING_ACCOUNT_ID = 'd1000000-0000-4000-a000-000000000008'
