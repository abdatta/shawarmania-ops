import { describe, expect, it } from 'vitest'

import { COUNTER_TELEMETRY_FRESH_MS, isCounterTelemetryFresh } from './counter-telemetry'

describe('counter telemetry freshness', () => {
  const now = Date.parse('2026-08-29T10:00:00.000Z')

  it('keeps the exact thirty-minute boundary fresh', () => {
    expect(
      isCounterTelemetryFresh(new Date(now - COUNTER_TELEMETRY_FRESH_MS).toISOString(), now),
    ).toBe(true)
  })

  it('marks older, absent, and invalid reports out of touch', () => {
    expect(
      isCounterTelemetryFresh(new Date(now - COUNTER_TELEMETRY_FRESH_MS - 1).toISOString(), now),
    ).toBe(false)
    expect(isCounterTelemetryFresh(null, now)).toBe(false)
    expect(isCounterTelemetryFresh('not-a-timestamp', now)).toBe(false)
  })
})
