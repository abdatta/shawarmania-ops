import type { AddressLookupAdapter, AddressSuggestion } from '../adapters'

/**
 * The demo's address lookup: three places, matched by substring, resolved with
 * no I/O whatsoever.
 *
 * The demo tree's guarantee is that no request leaves the app's own origin, and
 * an address search is exactly the kind of feature that would quietly break it
 * — the network call is somebody else's service, invisible in the UI, and it
 * would look like it was working right up until an E2E run noticed.
 *
 * The third fixture carries no PIN on purpose. A demo that only ever shows the
 * complete fill teaches that the fill is always complete, and then somebody is
 * surprised by a half-filled form on a real shop that OpenStreetMap knows less
 * well.
 */

const DEMO_PLACES: AddressSuggestion[] = [
  {
    id: 'demo-place-1',
    label: 'Central Park, B-7, Kalyani, 741235',
    placeName: 'Central Park',
    addressLine1: 'Central Park',
    addressLine2: 'B-7',
    city: 'Kalyani',
    pincode: '741235',
  },
  {
    id: 'demo-place-2',
    label: 'Kanchrapara Station Road, Kanchrapara, 743145',
    placeName: 'Kanchrapara Station Road',
    addressLine1: 'Kanchrapara Station Road',
    addressLine2: '',
    city: 'Kanchrapara',
    pincode: '743145',
  },
  {
    id: 'demo-place-3',
    label: 'Ghoshpara Bazar, Kalyani',
    placeName: 'Ghoshpara Bazar',
    addressLine1: 'Ghoshpara Road',
    addressLine2: 'Ghoshpara Bazar',
    city: 'Kalyani',
    // Deliberately absent: this is the half-filled case.
    pincode: '',
  },
]

/** Only the PINs the fixtures above can produce. A demo needs no more. */
const DEMO_DISTRICTS: Record<string, string> = {
  '741235': 'Nadia',
  '743145': 'North 24 Parganas',
}

export function createMockAddressLookupAdapter(): AddressLookupAdapter {
  return {
    async suggest(query: string): Promise<AddressSuggestion[]> {
      const needle = query.trim().toLowerCase()
      if (needle.length < 3) return []
      return DEMO_PLACES.filter((place) => place.label.toLowerCase().includes(needle))
    },

    async districtForPincode(pincode: string): Promise<string | null> {
      return DEMO_DISTRICTS[pincode.trim()] ?? null
    },
  }
}
