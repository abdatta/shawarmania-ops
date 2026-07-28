import type { AddressLookupAdapter, AddressSuggestion } from '../adapters'

/**
 * The real address lookup — and the one adapter in this folder that talks to
 * neither Supabase nor anything holding a credential.
 *
 * It lives here anyway because this is the layer permitted to do I/O; a screen
 * reaching a network directly is the thing the seam exists to prevent, and the
 * rule does not get an exception for services that happen to need no key.
 *
 * Two public services, both keyless and free, both consulted only while an
 * admin types their own shop's address:
 *
 *   Photon (photon.komoot.io) — Komoot's OpenStreetMap geocoder. Chosen over
 *   Nominatim because Nominatim's usage policy forbids autocomplete outright,
 *   which disqualifies it on its terms rather than its behaviour.
 *
 *   api.postalpincode.in — India Post's PIN directory, for the one field no
 *   geocoder answers correctly here (see `districtForPincode`).
 *
 * Nothing below ever throws. A refused, slow, throttled or unreachable service
 * resolves to nothing, and the form carries on exactly as it does without the
 * lookup.
 */

/**
 * India, as a box. Photon's `bbox` restricts rather than biases, which is the
 * difference between "Central Park" meaning Kalyani and meaning Manhattan.
 */
const INDIA_BBOX = '68.1,6.5,97.4,35.7'
const PHOTON = 'https://photon.komoot.io/api'
const POSTAL = 'https://api.postalpincode.in/pincode'

/** Photon's GeoJSON properties, as far as this file cares. */
interface PhotonProperties {
  osm_id?: number
  osm_type?: string
  name?: string
  housenumber?: string
  street?: string
  locality?: string
  city?: string
  postcode?: string
  state?: string
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * A Photon feature, reduced to a postal address.
 *
 * Every rule here comes from a real response rather than the API docs, because
 * the docs describe the fields and not which of them India actually populates:
 *
 *   "Central Park", Kalyani  → a street with no `street`, so its `name` IS the
 *                              line, and `locality` (B-7) is the second line.
 *   "Shawarmaji", Mumbai     → `housenumber` + `street` make the line, and the
 *                              business name is not part of the address at all.
 *   "Block B, Faculty Qtrs"  → a named place on a street with no `locality`, so
 *                              the name is what the second line is for.
 *
 * `district` and `county` are read by nothing: OSM's `district` is a ward or
 * sector and its `county` is a municipality or subdistrict. Neither is the
 * revenue district, and putting either in that box would be confidently wrong,
 * which is worse than empty.
 */
function toSuggestion(properties: PhotonProperties, index: number): AddressSuggestion {
  const name = text(properties.name)
  const street = text(properties.street)
  const houseNumber = text(properties.housenumber)
  const locality = text(properties.locality)
  const city = text(properties.city)
  const pincode = text(properties.postcode)

  const addressLine1 = street ? [houseNumber, street].filter(Boolean).join(' ') : name
  // The name earns the second line only when the street already took the first
  // and the name says something the first line does not.
  const addressLine2 = locality || (street && name && name !== street ? name : '')

  const label = [name || addressLine1, locality, city, pincode].filter(Boolean).join(', ')

  return {
    id: `${text(properties.osm_type)}${properties.osm_id ?? index}-${index}`,
    label,
    placeName: name,
    addressLine1,
    addressLine2,
    city,
    pincode,
  }
}

export function createAddressLookupAdapter(fetchImpl: typeof fetch = fetch): AddressLookupAdapter {
  return {
    async suggest(query: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
      const q = query.trim()
      if (q.length < 3) return []

      try {
        const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=6&lang=en&bbox=${INDIA_BBOX}`
        const response = await fetchImpl(url, signal ? { signal } : {})
        if (!response.ok) return []

        const body = (await response.json()) as { features?: { properties?: PhotonProperties }[] }
        const suggestions = (body.features ?? [])
          .map((feature, index) => toSuggestion(feature.properties ?? {}, index))
          .filter((suggestion) => suggestion.addressLine1 !== '')

        // Photon happily returns the same road three times over. Three
        // identical rows read as a broken list rather than a choice.
        const seen = new Set<string>()
        return suggestions.filter((suggestion) => {
          if (seen.has(suggestion.label)) return false
          seen.add(suggestion.label)
          return true
        })
      } catch {
        return []
      }
    },

    async districtForPincode(pincode: string, signal?: AbortSignal): Promise<string | null> {
      const pin = pincode.trim()
      if (!/^\d{6}$/.test(pin)) return null

      try {
        const response = await fetchImpl(`${POSTAL}/${pin}`, signal ? { signal } : {})
        if (!response.ok) return null

        const body = (await response.json()) as {
          Status?: string
          PostOffice?: { District?: string }[] | null
        }[]
        const first = Array.isArray(body) ? body[0] : undefined
        if (first?.Status !== 'Success') return null

        return text(first.PostOffice?.[0]?.District) || null
      } catch {
        return null
      }
    },
  }
}
