import type { Role } from '@/session/session'

import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, outletFixtures } from './outlets'

/**
 * Four invented people, one per role. Obviously synthetic by name — nobody
 * at Shawarmania is called "Demo" — and carrying no phone numbers: fixtures
 * never contain anything that could read as a real person's contact detail.
 */

const FIXTURE_CREATED_AT = '2026-07-26T00:00:00+00:00'

const kalyani = outletFixtures.find((outlet) => outlet.id === OUTLET_KALYANI_ID) ?? null

const profileFixtures = {
  super_admin: {
    id: 'd1000000-0000-4000-a000-000000000001',
    full_name: 'Demo Owner',
    phone: null,
    role: 'super_admin',
    outlet_id: null,
    is_active: true,
    staff_code: null,
    role_title: null,
    joined_on: null,
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
  franchise_admin: {
    id: 'd1000000-0000-4000-a000-000000000002',
    full_name: 'Demo Manager',
    phone: null,
    role: 'franchise_admin',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: true,
    staff_code: 'KAL-05',
    role_title: 'Manager',
    joined_on: '2025-08-01',
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
  biller: {
    id: 'd1000000-0000-4000-a000-000000000003',
    full_name: 'Demo Biller',
    phone: null,
    role: 'biller',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: true,
    // A counter tablet is a device, not a person: no staff facts, ever.
    staff_code: null,
    role_title: null,
    joined_on: null,
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
  employee: {
    id: 'd1000000-0000-4000-a000-000000000004',
    full_name: 'Demo Staff',
    phone: null,
    role: 'employee',
    outlet_id: OUTLET_KALYANI_ID,
    is_active: true,
    staff_code: 'KAL-01',
    role_title: 'Counter staff',
    joined_on: '2026-01-12',
    left_on: null,
    created_at: FIXTURE_CREATED_AT,
  },
} satisfies Record<Role, Tables<'profiles'>>

export interface PersonaFixture {
  profile: Tables<'profiles'>
  outlet: Tables<'outlets'> | null
}

/** The demo persona for each role: profile plus the outlet they belong to. */
export const personaFixtures: Record<Role, PersonaFixture> = {
  super_admin: { profile: profileFixtures.super_admin, outlet: null },
  franchise_admin: { profile: profileFixtures.franchise_admin, outlet: kalyani },
  biller: { profile: profileFixtures.biller, outlet: kalyani },
  employee: { profile: profileFixtures.employee, outlet: kalyani },
}
