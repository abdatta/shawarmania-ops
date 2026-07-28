import { describe, expect, it, vi } from 'vitest'

import { createAddressLookupAdapter } from './address-lookup'

/**
 * The mapper, against payloads recorded from the live services rather than
 * written from the API docs.
 *
 * That distinction is the whole value of this file. The docs describe which
 * fields exist; only real responses show which ones India actually populates —
 * that a street in Kalyani has no `street`, that a named building has no
 * `city`, and that `district` means something entirely different here than the
 * word does on an invoice.
 */

/** Photon, `q=Central Park Kalyani`. A street whose `name` IS the street. */
const CENTRAL_PARK = {
  properties: {
    osm_type: 'W',
    osm_id: 890919775,
    type: 'street',
    name: 'Central Park',
    locality: 'B-7',
    district: 'B-7',
    city: 'Kalyani',
    county: 'Kalyani',
    postcode: '741235',
    state: 'West Bengal',
  },
}

/** Photon, `q=Kanchrapara Station`. No locality, and a `county` that is a block. */
const KANCHRAPARA = {
  properties: {
    osm_type: 'W',
    osm_id: 338562550,
    type: 'street',
    name: 'Kanchrapara Station Road',
    city: 'Kanchrapara',
    county: 'Barrackpur - I',
    postcode: '743145',
    state: 'West Bengal',
  },
}

/** Photon, `q=Shawarmania`. A shop: house number, street, and a name that is neither. */
const SHOP = {
  properties: {
    osm_type: 'N',
    osm_id: 13026558801,
    type: 'house',
    name: 'Shawarmaji',
    housenumber: '491A',
    street: 'Road No 33',
    locality: 'Matunga East',
    district: 'F/N Ward',
    county: 'Mumbai City District',
    postcode: '400019',
    state: 'Maharashtra',
  },
}

/** Photon, `q=Kalyani B Block`. A named building on a street, with no city at all. */
const FACULTY_QUARTERS = {
  properties: {
    osm_type: 'N',
    osm_id: 1,
    type: 'house',
    name: 'Block B, Faculty Quarters',
    street: 'National Highway 34 Connector',
    county: 'Kalyani',
    postcode: '741245',
    state: 'West Bengal',
  },
}

function adapterReturning(body: unknown, ok = true) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  } as Response)
  return { adapter: createAddressLookupAdapter(fetchImpl as unknown as typeof fetch), fetchImpl }
}

describe('turning a place into an address', () => {
  it('uses the name as the street line when there is no street', async () => {
    const { adapter } = adapterReturning({ features: [CENTRAL_PARK] })
    const [suggestion] = await adapter.suggest('Central Park Kalyani')

    expect(suggestion).toMatchObject({
      addressLine1: 'Central Park',
      addressLine2: 'B-7',
      city: 'Kalyani',
      pincode: '741235',
      placeName: 'Central Park',
    })
  })

  it('builds the street line from house number and street when it has them', async () => {
    const { adapter } = adapterReturning({ features: [SHOP] })
    const [suggestion] = await adapter.suggest('Shawarmania')

    expect(suggestion?.addressLine1).toBe('491A Road No 33')
    // The business name is not part of the address; the locality is.
    expect(suggestion?.addressLine2).toBe('Matunga East')
    expect(suggestion?.placeName).toBe('Shawarmaji')
  })

  it('puts a named building on the second line when there is no locality', async () => {
    const { adapter } = adapterReturning({ features: [FACULTY_QUARTERS] })
    const [suggestion] = await adapter.suggest('Kalyani B Block')

    expect(suggestion?.addressLine1).toBe('National Highway 34 Connector')
    expect(suggestion?.addressLine2).toBe('Block B, Faculty Quarters')
    // Genuinely absent in the real response, and left empty rather than guessed.
    expect(suggestion?.city).toBe('')
  })

  it('leaves the second line empty rather than inventing one', async () => {
    const { adapter } = adapterReturning({ features: [KANCHRAPARA] })
    const [suggestion] = await adapter.suggest('Kanchrapara Station')

    expect(suggestion?.addressLine1).toBe('Kanchrapara Station Road')
    expect(suggestion?.addressLine2).toBe('')
  })

  it('never lets a geocoder district or county reach the output', async () => {
    // OSM's `district` is a ward (`F/N Ward`) and its `county` is a
    // municipality or block (`Barrackpur - I`, `Mumbai City District`). Neither
    // is the revenue district, and putting either in that box would be
    // confidently wrong — worse than empty.
    //
    // Asserted on records where those values appear in NO other field. Central
    // Park is deliberately not among them: its `locality` and its `district`
    // both read `B-7`, so it could not tell a leak from a legitimate second
    // line.
    const { adapter } = adapterReturning({ features: [SHOP, KANCHRAPARA, FACULTY_QUARTERS] })
    const serialised = JSON.stringify(await adapter.suggest('anything at all'))

    expect(serialised).not.toContain('F/N Ward')
    expect(serialised).not.toContain('Mumbai City District')
    expect(serialised).not.toContain('Barrackpur')
    // …while the fields that ARE sourced still came through.
    expect(serialised).toContain('Matunga East')
    expect(serialised).toContain('Kanchrapara Station Road')
  })

  it('carries no coordinates, because the type has nowhere to put them', async () => {
    const { adapter } = adapterReturning({
      features: [{ ...CENTRAL_PARK, geometry: { type: 'Point', coordinates: [88.43, 22.97] } }],
    })
    const [suggestion] = await adapter.suggest('Central Park Kalyani')

    // A coordinate written to outlets.latitude arms the geofence against a
    // rooftop centroid. There must be nothing here to wire up by accident.
    expect(Object.keys(suggestion!).sort()).toEqual([
      'addressLine1',
      'addressLine2',
      'city',
      'id',
      'label',
      'pincode',
      'placeName',
    ])
    expect(JSON.stringify(suggestion)).not.toContain('88.43')
  })

  it('drops the duplicate rows Photon returns for one road', async () => {
    const { adapter } = adapterReturning({ features: [KANCHRAPARA, KANCHRAPARA, KANCHRAPARA] })
    expect(await adapter.suggest('Kanchrapara Station')).toHaveLength(1)
  })

  it('restricts to India rather than merely preferring it', async () => {
    const { adapter, fetchImpl } = adapterReturning({ features: [] })
    await adapter.suggest('Central Park')

    // Without the box, "Central Park" is in Manhattan.
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('bbox=68.1,6.5,97.4,35.7')
  })
})

describe('when the lookup will not answer', () => {
  it('says nothing for a query too short to mean anything', async () => {
    const { adapter, fetchImpl } = adapterReturning({ features: [] })
    expect(await adapter.suggest('ka')).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('resolves empty rather than throwing when the service refuses', async () => {
    const { adapter } = adapterReturning({}, false)
    expect(await adapter.suggest('Central Park Kalyani')).toEqual([])
  })

  it('resolves empty rather than throwing when the network fails', async () => {
    const adapter = createAddressLookupAdapter(
      vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
    )
    expect(await adapter.suggest('Central Park Kalyani')).toEqual([])
    expect(await adapter.districtForPincode('741235')).toBeNull()
  })

  it('ignores a feature with nothing usable in it', async () => {
    const { adapter } = adapterReturning({ features: [{ properties: { state: 'West Bengal' } }] })
    expect(await adapter.suggest('somewhere')).toEqual([])
  })
})

describe('the district, from the PIN rather than the map', () => {
  it('reads the revenue district out of the postal directory', async () => {
    const { adapter } = adapterReturning([
      { Status: 'Success', PostOffice: [{ Name: 'Bidhanpark', District: 'Nadia' }] },
    ])
    expect(await adapter.districtForPincode('741235')).toBe('Nadia')
  })

  it('treats an unknown PIN as no answer rather than an error', async () => {
    // The real shape for 999999: a 200 response whose Status is 'Error'.
    const { adapter } = adapterReturning([{ Status: 'Error', PostOffice: null }])
    expect(await adapter.districtForPincode('999999')).toBeNull()
  })

  it('does not ask about something that is not a PIN code', async () => {
    const { adapter, fetchImpl } = adapterReturning([])
    expect(await adapter.districtForPincode('7412')).toBeNull()
    expect(await adapter.districtForPincode('not a pin')).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
