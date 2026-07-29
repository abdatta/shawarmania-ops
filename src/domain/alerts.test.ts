import { describe, expect, it } from 'vitest'

import { alertAttentionRank, canTransition, nextStatuses, type AlertStatus } from './alerts'

const ALL: AlertStatus[] = ['open', 'acknowledged', 'resolved', 'closed']

describe('the alert lifecycle', () => {
  it('walks open → acknowledged → resolved → closed', () => {
    expect(canTransition('open', 'acknowledged')).toBe(true)
    expect(canTransition('acknowledged', 'resolved')).toBe(true)
    expect(canTransition('resolved', 'closed')).toBe(true)
  })

  it('refuses to skip acknowledgement', () => {
    expect(canTransition('open', 'closed')).toBe(false)
    expect(canTransition('open', 'resolved')).toBe(false)
  })

  it('reopens from anything unfinished', () => {
    expect(canTransition('acknowledged', 'open')).toBe(true)
    expect(canTransition('resolved', 'open')).toBe(true)
  })

  it('makes closed terminal', () => {
    expect(nextStatuses('closed')).toHaveLength(0)
    for (const to of ALL) {
      expect(canTransition('closed', to)).toBe(false)
    }
  })

  it('refuses a transition to the status it is already in', () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false)
    }
  })

  it('sorts what has not been read above what has, and urgent above the rest', () => {
    const openNormal = alertAttentionRank({ status: 'open', priority: 'normal' })
    const resolvedUrgent = alertAttentionRank({ status: 'resolved', priority: 'urgent' })
    const openUrgent = alertAttentionRank({ status: 'open', priority: 'urgent' })

    expect(openUrgent).toBeLessThan(openNormal)
    expect(openNormal).toBeLessThan(resolvedUrgent)
  })
})
