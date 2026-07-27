import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'
import { personaFixtures } from './personas'

/**
 * The demo roster for the People and Access surfaces: the four personas plus
 * enough colleagues either side of the outlet boundary that the Super Admin's
 * cross-outlet list and the Franchise Admin's own-outlet one are visibly
 * different things.
 *
 * Typed from the generated schema types like every fixture, so a column the
 * database does not have fails to compile (docs/DEMO_MODE.md).
 */

const FIXTURE_CREATED_AT = '2026-07-26T00:00:00+00:00'

const colleagues = [
  {
    id: 'd1000000-0000-4000-a000-000000000005',
    full_name: 'Demo Manager (Kanchrapara)',
    phone: null,
    role: 'franchise_admin',
    outlet_id: OUTLET_KANCHRAPARA_ID,
    is_active: true,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: 'd1000000-0000-4000-a000-000000000006',
    full_name: 'Demo Griller',
    phone: null,
    role: 'employee',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: true,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: 'd1000000-0000-4000-a000-000000000007',
    full_name: 'Demo Evening Biller',
    phone: null,
    role: 'biller',
    outlet_id: OUTLET_KANCHRAPARA_ID,
    is_active: true,
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
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: 'd1000000-0000-4000-a000-000000000009',
    full_name: 'Demo Former Staff',
    phone: null,
    role: 'employee',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: false,
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
