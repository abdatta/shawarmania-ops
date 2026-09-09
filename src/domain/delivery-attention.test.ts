import { expect, it } from 'vitest'
import { deliveryAttentionTotal, integrationNeedsAttention } from './delivery-attention'

it('counts one connection issue across outlets while retaining distinct work', () => {
  expect(
    deliveryAttentionTotal([
      { needing: 3, integrationIssue: true },
      { needing: 1, integrationIssue: true },
    ]),
  ).toBe(3)
  expect(
    deliveryAttentionTotal([
      { needing: 1, integrationIssue: true },
      { needing: 1, integrationIssue: true },
    ]),
  ).toBe(1)
})
it('distinguishes normal runs, expired credentials, broken parsers and abandoned runs', () => {
  const now = Date.now()
  const healthy = {
    hasSession: true,
    running: false,
    lastRunAt: new Date(now).toISOString(),
    lastOutcome: 'ok',
  }
  expect(integrationNeedsAttention(healthy, now)).toBe(false)
  expect(integrationNeedsAttention({ ...healthy, hasSession: false }, now)).toBe(true)
  expect(integrationNeedsAttention({ ...healthy, lastOutcome: 'shape_changed' }, now)).toBe(true)
  expect(
    integrationNeedsAttention({ ...healthy, running: true, lastOutcome: 'session_lapsed' }, now),
  ).toBe(false)
  expect(
    integrationNeedsAttention(
      { ...healthy, running: true, lastRunAt: new Date(now - 31 * 60_000).toISOString() },
      now,
    ),
  ).toBe(true)
  expect(integrationNeedsAttention({ ...healthy, lastRunAt: null, hasSession: false }, now)).toBe(
    false,
  )
})

it('handles OTP, exact expiry and run timeout boundaries without inventing unconfigured work', () => {
  const now = Date.parse('2026-09-08T12:00:00Z')
  const health = {
    running: false,
    hasSession: true,
    lastOutcome: 'ok',
    lastRunAt: new Date(now).toISOString(),
  }
  expect(integrationNeedsAttention({ ...health, awaitingOneTimePassword: true }, now)).toBe(true)
  expect(
    integrationNeedsAttention({ ...health, sessionExpiresAt: new Date(now).toISOString() }, now),
  ).toBe(true)
  expect(
    integrationNeedsAttention(
      { ...health, sessionExpiresAt: new Date(now + 1).toISOString() },
      now,
    ),
  ).toBe(false)
  expect(
    integrationNeedsAttention(
      { ...health, running: true, lastRunAt: new Date(now - 1_800_000).toISOString() },
      now,
    ),
  ).toBe(false)
  expect(
    integrationNeedsAttention(
      { ...health, running: true, lastRunAt: new Date(now - 1_800_001).toISOString() },
      now,
    ),
  ).toBe(true)
  expect(
    integrationNeedsAttention(
      { ...health, hasSession: false, lastRunAt: null, lastOutcome: 'session_lapsed' },
      now,
    ),
  ).toBe(false)
  expect(
    integrationNeedsAttention(
      { ...health, hasSession: false, lastRunAt: null, syncedFrom: '2026-09-01' },
      now,
    ),
  ).toBe(true)
})
