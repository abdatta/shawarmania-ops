import type { Tables } from '../../database.types'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from './outlets'

/**
 * The demo roster. Invented people with invented codes, and no phone numbers —
 * fixtures never carry anything that could read as a real person's contact
 * detail (docs/DEMO_MODE.md).
 *
 * `DEMO_STAFF_EMPLOYEE_ID` is the roster row linked to the Employee persona's
 * profile, which is what makes the fourth role's walkthrough a working day
 * rather than an empty shell.
 *
 * **Two rows below are deliberately unfinished, and must stay that way.**
 * Fixtures describing a business that is already configured are what let
 * attendance ship unreachable — every test started from a wired-up world, and
 * none asked how that world comes to exist (design D11):
 *
 *   * `DEMO_GRILLER_EMPLOYEE_ID` has no linked account, and an account of the
 *     same name is waiting on Access. They are the pair a walkthrough joins.
 *   * `DEMO_BLOCKED_EMPLOYEE_ID` has no account at all, and no account is
 *     waiting for it — somebody on the payroll who simply does not use the app.
 *
 * Linking either of them in this file would delete the demonstration.
 */

export const DEMO_STAFF_EMPLOYEE_ID = 'd2000000-0000-4000-a000-000000000001'
export const DEMO_GRILLER_EMPLOYEE_ID = 'd2000000-0000-4000-a000-000000000002'
export const DEMO_BLOCKED_EMPLOYEE_ID = 'd2000000-0000-4000-a000-000000000003'

/** The Employee persona's profile id, from personas.ts. Kept in step by the roster below. */
const DEMO_STAFF_PROFILE_ID = 'd1000000-0000-4000-a000-000000000004'

export const employeeFixtures: Tables<'employees'>[] = [
  {
    id: DEMO_STAFF_EMPLOYEE_ID,
    outlet_id: OUTLET_KALYANI_ID,
    profile_id: DEMO_STAFF_PROFILE_ID,
    employee_code: 'KAL-01',
    full_name: 'Demo Staff',
    phone: null,
    salary_paise: 0,
    address: null,
    role_title: 'Counter staff',
    employment_status: 'active',
    joined_on: '2026-01-12',
  },
  {
    id: DEMO_GRILLER_EMPLOYEE_ID,
    outlet_id: OUTLET_KALYANI_ID,
    profile_id: null,
    employee_code: 'KAL-02',
    full_name: 'Demo Griller',
    phone: null,
    salary_paise: 0,
    address: null,
    role_title: 'Grill',
    employment_status: 'active',
    joined_on: '2025-11-03',
  },
  {
    id: DEMO_BLOCKED_EMPLOYEE_ID,
    outlet_id: OUTLET_KALYANI_ID,
    profile_id: null,
    employee_code: 'KAL-03',
    full_name: 'Demo Helper',
    phone: null,
    salary_paise: 0,
    address: null,
    role_title: 'Prep',
    employment_status: 'active',
    joined_on: '2026-04-20',
  },
  {
    id: 'd2000000-0000-4000-a000-000000000004',
    outlet_id: OUTLET_KALYANI_ID,
    profile_id: null,
    employee_code: 'KAL-04',
    full_name: 'Demo Former Staff',
    phone: null,
    salary_paise: 0,
    address: null,
    role_title: 'Counter staff',
    employment_status: 'terminated',
    joined_on: '2025-02-01',
  },
  {
    id: 'd2000000-0000-4000-a000-000000000005',
    outlet_id: OUTLET_KANCHRAPARA_ID,
    profile_id: null,
    employee_code: 'KPA-01',
    full_name: 'Demo Kanchrapara Staff',
    phone: null,
    salary_paise: 0,
    address: null,
    role_title: 'Counter staff',
    employment_status: 'active',
    joined_on: '2026-02-15',
  },
]
