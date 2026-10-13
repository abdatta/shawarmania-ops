import { describe, expect, it } from 'vitest'

import type { DeviceHealthReading } from '@/data-access/adapters'

import { HEALTH_STALE_AFTER_MS, tabletState } from './tablet-state'

const NOW = new Date('2026-10-12T16:00:00Z')

function reading(overrides: Partial<DeviceHealthReading> = {}): DeviceHealthReading {
  return {
    deviceId: 'tablet',
    label: 'Counter tablet',
    kind: 'counter',
    outletId: 'outlet',
    outletName: 'Kalyani Cafe',
    build: '1a2b3c4',
    bootedGates: ['probe'],
    requests: 30,
    failed: 0,
    slowestMs: 400,
    reportedAt: new Date(NOW.getTime() - 20_000).toISOString(),
    ...overrides,
  }
}

const probe = (enabled: boolean) => ({ key: 'probe', enabled })

describe('what a change gate’s page says about a tablet', () => {
  it('reads running when the tablet loaded with the gate as it is now', () => {
    expect(tabletState(reading(), probe(true), NOW).follows).toBe('running')
    expect(tabletState(reading({ bootedGates: [] }), probe(false), NOW).follows).toBe('running')
  })

  it('reads waiting when the gate turned after the tablet loaded', () => {
    expect(tabletState(reading(), probe(false), NOW).follows).toBe('waiting')
    expect(tabletState(reading({ bootedGates: [] }), probe(true), NOW).follows).toBe('waiting')
  })

  it('marks a tablet failing on any failed request in the last minute', () => {
    expect(tabletState(reading({ failed: 1 }), probe(true), NOW)).toEqual({
      follows: 'running',
      health: 'failing',
    })
  })

  it('marks a tablet silent after two minutes without a report, failures or not', () => {
    const quiet = reading({
      failed: 4,
      reportedAt: new Date(NOW.getTime() - HEALTH_STALE_AFTER_MS - 1).toISOString(),
    })
    expect(tabletState(quiet, probe(true), NOW).health).toBe('stale')
    const justInTime = reading({
      reportedAt: new Date(NOW.getTime() - HEALTH_STALE_AFTER_MS).toISOString(),
    })
    expect(tabletState(justInTime, probe(true), NOW).health).toBe('ok')
  })
})
