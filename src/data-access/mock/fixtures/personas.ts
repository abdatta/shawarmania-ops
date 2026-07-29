import type { Assignment } from '@/data-access/adapters'
import type { Role } from '@/session/session'

import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID, outletFixtures } from './outlets'

/**
 * Four invented people, one per role. Obviously synthetic by name — nobody
 * at Shawarmania is called "Demo" — and carrying no phone numbers: fixtures
 * never contain anything that could read as a real person's contact detail.
 *
 * Since multi-outlet-people the profile carries no role and no outlet: where
 * somebody works and as what is an assignment, and a person may hold more than
 * one. The owner below holds two — the business-wide role, and a manager's
 * assignment at Kalyani — because the owner day-running one outlet is the case
 * this change was built for and a demo that cannot walk it proves nothing.
 */

const FIXTURE_CREATED_AT = '2026-07-26T00:00:00+00:00'

const kalyani = outletFixtures.find((outlet) => outlet.id === OUTLET_KALYANI_ID) ?? null

export const DEMO_OWNER_ID = 'd1000000-0000-4000-a000-000000000001'
export const DEMO_MANAGER_ID = 'd1000000-0000-4000-a000-000000000002'
export const DEMO_BILLER_ID = 'd1000000-0000-4000-a000-000000000003'
export const DEMO_STAFF_ID = 'd1000000-0000-4000-a000-000000000004'

const profileFixtures = {
  super_admin: {
    id: DEMO_OWNER_ID,
    full_name: 'Demo Owner',
    phone: null,
    is_active: true,
    role_title: null,
    created_at: FIXTURE_CREATED_AT,
  },
  franchise_admin: {
    id: DEMO_MANAGER_ID,
    full_name: 'Demo Manager',
    phone: null,
    is_active: true,
    role_title: 'Manager',
    created_at: FIXTURE_CREATED_AT,
  },
  biller: {
    id: DEMO_BILLER_ID,
    full_name: 'Demo Biller',
    phone: null,
    is_active: true,
    // A counter tablet is a device, not a person: no job title, ever.
    role_title: null,
    created_at: FIXTURE_CREATED_AT,
  },
  employee: {
    id: DEMO_STAFF_ID,
    full_name: 'Demo Staff',
    phone: null,
    is_active: true,
    role_title: 'Counter staff',
    created_at: FIXTURE_CREATED_AT,
  },
} satisfies Record<Role, Tables<'profiles'>>

/** Shorthand for a live assignment — the overwhelmingly common shape. */
export function liveAssignment(
  id: string,
  role: Role,
  outletId: string | null,
  startedOn: string,
): Assignment {
  return { id, role, outletId, startedOn, endedOn: null }
}

const personaAssignments = {
  super_admin: [
    liveAssignment('da000000-0000-4000-a000-000000000001', 'super_admin', null, '2025-06-01'),
    // The owner, day-running Kalyani. Their operational writes there come from
    // THIS row rather than from being the owner — which is why the drawer
    // opens at Kalyani and nowhere else.
    liveAssignment(
      'da000000-0000-4000-a000-000000000002',
      'franchise_admin',
      OUTLET_KALYANI_ID,
      '2026-07-01',
    ),
  ],
  franchise_admin: [
    liveAssignment(
      'da000000-0000-4000-a000-000000000003',
      'franchise_admin',
      OUTLET_KALYANI_ID,
      '2025-08-01',
    ),
  ],
  biller: [
    liveAssignment(
      'da000000-0000-4000-a000-000000000004',
      'biller',
      OUTLET_KALYANI_ID,
      '2025-08-01',
    ),
  ],
  employee: [
    liveAssignment(
      'da000000-0000-4000-a000-000000000005',
      'employee',
      OUTLET_KALYANI_ID,
      '2026-01-12',
    ),
    // The Employee persona works BOTH outlets, because that is the case this
    // change exists for and a demo that only asserts it proves nothing. Their
    // own attendance names each day's outlet; their check-in button offers no
    // choice at all — the fence resolves it (design D5).
    liveAssignment(
      'da000000-0000-4000-a000-000000000006',
      'employee',
      OUTLET_KANCHRAPARA_ID,
      '2026-06-15',
    ),
  ],
} satisfies Record<Role, Assignment[]>

export interface PersonaFixture {
  profile: Tables<'profiles'>
  outlet: Tables<'outlets'> | null
  assignments: Assignment[]
}

/** The demo persona for each role: profile, assignments, and their home outlet. */
export const personaFixtures: Record<Role, PersonaFixture> = {
  super_admin: {
    profile: profileFixtures.super_admin,
    outlet: null,
    assignments: personaAssignments.super_admin,
  },
  franchise_admin: {
    profile: profileFixtures.franchise_admin,
    outlet: kalyani,
    assignments: personaAssignments.franchise_admin,
  },
  biller: {
    profile: profileFixtures.biller,
    outlet: kalyani,
    assignments: personaAssignments.biller,
  },
  employee: {
    profile: profileFixtures.employee,
    outlet: kalyani,
    assignments: personaAssignments.employee,
  },
}
