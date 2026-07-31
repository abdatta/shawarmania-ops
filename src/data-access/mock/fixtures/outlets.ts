import type { Tables } from '../../database.types'

/**
 * The two real outlets, plus one that should never have existed. Public
 * business facts — names, addresses, cutover — are fine in fixtures
 * (docs/DEMO_MODE.md); people never are. Values mirror supabase/seed.sql,
 * including its placeholder coordinates, so demo and local data cannot quietly
 * disagree about the business.
 *
 * Typed from the generated schema types: a column the database does not have
 * is a compile error here, which is the whole point of the seam.
 *
 * **The third outlet is a mistake somebody made, and it has to stay one.** It
 * is closed and nothing references it, which makes it the only outlet here
 * that can actually be deleted. A demo carrying only the two real shops can
 * demonstrate a refusal and never a success — and a delete path whose happy
 * case nobody ever walks is how it ships broken (design D7).
 */

export const OUTLET_KALYANI_ID = 'd0000000-0000-4000-a000-000000000001'
export const OUTLET_KANCHRAPARA_ID = 'd0000000-0000-4000-a000-000000000002'
export const OUTLET_MISTAKE_ID = 'd0000000-0000-4000-a000-000000000003'

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
    arrival_deadline: '13:00:00',
    is_active: true,
    created_at: FIXTURE_CREATED_AT,
    location_accuracy_m: 9,
    location_captured_at: '2026-07-24T09:15:00+00:00',
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
    // Not the 13:00 default, mirroring supabase/seed.sql: a demo where both
    // shops share the deadline could not show a surface reading the outlet's
    // own rule rather than a constant. Late in the evening because the demo's
    // split-shift person works an EVENING here — one deadline per outlet cannot
    // describe two shifts, and a tighter value would demonstrate that
    // limitation instead of the rule (docs/LIMITATIONS.md).
    arrival_deadline: '20:00:00',
    is_active: true,
    created_at: FIXTURE_CREATED_AT,
    // Never surveyed, mirroring supabase/seed.sql — so the demo shows both
    // states of the owner's outlet screen without anyone travelling.
    location_accuracy_m: null,
    location_captured_at: null,
  },
  {
    id: OUTLET_MISTAKE_ID,
    code: 'demo-mistake',
    // Named so it sorts after both real shops. The owner's roster picker
    // defaults to the first outlet of a name-sorted list that includes closed
    // ones, so a demo outlet sorting first would quietly
    // land every Staff walkthrough on an empty roster.
    name: 'Test outlet (created by mistake)',
    location_label: 'Not a real shop',
    address_line1: null,
    address_line2: null,
    city: null,
    district: null,
    pincode: null,
    phone: null,
    latitude: null,
    longitude: null,
    geofence_radius_m: 150,
    business_day_cutover: '04:00:00',
    arrival_deadline: '13:00:00',
    // Already closed, so the demo starts where the delete action is offered.
    // Nothing is rostered here, nobody's account points at it, and no day was
    // ever traded — which is exactly the precondition that makes deleting it
    // destroy no history.
    is_active: false,
    created_at: FIXTURE_CREATED_AT,
    location_accuracy_m: null,
    location_captured_at: null,
  },
]
