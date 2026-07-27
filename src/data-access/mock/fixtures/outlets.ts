import type { Tables } from '../../database.types'

/**
 * The two real outlets. Public business facts — names, addresses, cutover —
 * are fine in fixtures (docs/DEMO_MODE.md); people never are. Values mirror
 * supabase/seed.sql, including its placeholder coordinates, so demo and local
 * data cannot quietly disagree about the business.
 *
 * Typed from the generated schema types: a column the database does not have
 * is a compile error here, which is the whole point of the seam.
 */

export const OUTLET_KALYANI_ID = 'd0000000-0000-4000-a000-000000000001'
export const OUTLET_KANCHRAPARA_ID = 'd0000000-0000-4000-a000-000000000002'

/** One fixed instant; fixtures never call the clock. */
const FIXTURE_CREATED_AT = '2026-07-26T00:00:00+00:00'

export const outletFixtures: Tables<'outlets'>[] = [
  {
    id: OUTLET_KALYANI_ID,
    code: 'kalyani',
    name: 'Shawarmania Kalyani',
    location_label: 'Kalyani — Central Park',
    address_line1: 'Ward 10, B-9 Diagonal Road, Near Central Park Ground',
    address_line2: null,
    city: 'Kalyani',
    district: 'Nadia',
    pincode: '741235',
    phone: '+91 89815 24778',
    latitude: 22.975,
    longitude: 88.4345,
    geofence_radius_m: 150,
    business_day_cutover: '04:00:00',
    is_active: true,
    created_at: FIXTURE_CREATED_AT,
  },
  {
    id: OUTLET_KANCHRAPARA_ID,
    code: 'kanchrapara',
    name: 'Shawarmania Kanchrapara',
    location_label: 'Kanchrapara',
    address_line1: '281, K G Path (N), Near Joramandir Bus Stand',
    address_line2: null,
    city: 'Kanchrapara',
    district: 'North 24 Parganas',
    pincode: '743145',
    phone: '+91 89815 24778',
    latitude: 22.945,
    longitude: 88.433,
    geofence_radius_m: 150,
    business_day_cutover: '04:00:00',
    is_active: true,
    created_at: FIXTURE_CREATED_AT,
  },
]
