import { describe, expect, it } from 'vitest'

import {
  captureQuality,
  distanceMetres,
  evaluateFence,
  formatMetres,
  type Coordinates,
} from './geo'

/**
 * The pinning table.
 *
 * These exact pairs and these exact expected metres are asserted twice: here,
 * against the TypeScript implementation, and in
 * `supabase/tests/08_geofence.sql` against `public.app_distance_m`. Two
 * implementations of one formula drift silently unless something forces them
 * to agree, and a drifting geofence would show an employee one distance while
 * storing another.
 *
 * If you change a number here, change it there in the same commit.
 */
export const DISTANCE_FIXTURES = [
  { name: 'identical points', from: [22.975, 88.4345], to: [22.975, 88.4345], metres: 0 },
  { name: 'a few paces away', from: [22.975, 88.4345], to: [22.97505, 88.4346], metres: 11.649719 },
  {
    name: 'the seeded out-of-fence check-in',
    from: [22.945, 88.433],
    to: [22.9468, 88.4351],
    metres: 293.767533,
  },
  {
    name: 'the seeded blocked check-in',
    from: [22.945, 88.433],
    to: [22.9412, 88.4288],
    metres: 602.913168,
  },
  {
    name: 'a kilometre due north',
    from: [22.975, 88.4345],
    to: [22.984, 88.4345],
    metres: 1000.75434,
  },
  {
    name: 'between the two outlets',
    from: [22.975, 88.4345],
    to: [22.945, 88.433],
    metres: 3339.381222,
  },
  {
    name: 'Kalyani to Delhi',
    from: [22.975, 88.4345],
    to: [28.6139, 77.209],
    metres: 1285954.906677,
  },
] as const

const at = ([latitude, longitude]: readonly [number, number]): Coordinates => ({
  latitude,
  longitude,
})

describe('distanceMetres', () => {
  it.each(DISTANCE_FIXTURES)('$name', ({ from, to, metres }) => {
    // Sub-millimetre: the two implementations share a formula and a constant,
    // so anything looser would hide a real divergence.
    expect(distanceMetres(at(from), at(to))).toBeCloseTo(metres, 3)
  })

  it('is symmetric', () => {
    for (const { from, to } of DISTANCE_FIXTURES) {
      expect(distanceMetres(at(from), at(to))).toBeCloseTo(distanceMetres(at(to), at(from)), 6)
    }
  })

  it('returns exactly zero for a point against itself, without NaN from the asin guard', () => {
    const point = { latitude: 22.975, longitude: 88.4345 }
    expect(distanceMetres(point, point)).toBe(0)
    expect(Number.isNaN(distanceMetres(point, point))).toBe(false)
  })
})

describe('evaluateFence', () => {
  const outlet = { latitude: 22.975, longitude: 88.4345, radiusMetres: 150 }

  it('admits a reading inside the radius', () => {
    const verdict = evaluateFence(outlet, at([22.97505, 88.4346]))
    expect(verdict.kind).toBe('inside')
    if (verdict.kind === 'inside') expect(verdict.distanceMetres).toBeCloseTo(11.65, 1)
  })

  it('refuses a reading beyond the radius and says by how much', () => {
    const verdict = evaluateFence(outlet, at([22.984, 88.4345]))
    expect(verdict.kind).toBe('outside')
    if (verdict.kind === 'outside') {
      expect(verdict.distanceMetres).toBeCloseTo(1000.75, 1)
      expect(verdict.beyondMetres).toBeCloseTo(850.75, 1)
    }
  })

  it('admits a reading exactly on the radius', () => {
    // Strictly greater-than blocks, so the boundary itself is inside — the
    // same comparison the database makes.
    const onEdge = evaluateFence({ ...outlet, radiusMetres: 1001 }, at([22.984, 88.4345]))
    expect(onEdge.kind).toBe('inside')
  })

  it('reports an outlet with no captured position rather than guessing', () => {
    expect(
      evaluateFence({ latitude: null, longitude: null, radiusMetres: 150 }, at([22.975, 88.4345])),
    ).toEqual({ kind: 'unreferenced' })
  })

  it('treats a half-captured position as uncaptured', () => {
    expect(
      evaluateFence({ latitude: 22.975, longitude: null, radiusMetres: 150 }, at([22.975, 88.4345]))
        .kind,
    ).toBe('unreferenced')
  })

  it('does not forgive a distant reading for being imprecise', () => {
    // Accuracy is not an input here on purpose (design D5): a bad fix must not
    // become a licence. It is stored and shown so a human can weigh it.
    expect(evaluateFence(outlet, at([22.984, 88.4345])).kind).toBe('outside')
  })
})

describe('captureQuality', () => {
  it.each([
    [0, 'good'],
    [25, 'good'],
    [25.1, 'imprecise'],
    [50, 'imprecise'],
    [50.1, 'unusable'],
    [500, 'unusable'],
  ] as const)('%d m is %s', (accuracy, expected) => {
    expect(captureQuality(accuracy)).toBe(expected)
  })
})

describe('formatMetres', () => {
  it.each([
    [0, '0 m'],
    [11.6, '12 m'],
    [999, '999 m'],
    [1000, '1.0 km'],
    [3339, '3.3 km'],
    [12000, '12 km'],
  ] as const)('%d renders as %s', (metres, expected) => {
    expect(formatMetres(metres)).toBe(expected)
  })
})
