import { describe, expect, it, vi } from 'vitest'
import {
  readOverviewOutletCountHint,
  rememberOverviewOutletCount,
} from './overview-outlet-count-hint'

describe('Overview outlet-count hint', () => {
  it('defaults to one placeholder with no remembered count', () => {
    expect(readOverviewOutletCountHint()).toBe(1)
  })

  it('uses the last successful count across the browser', () => {
    rememberOverviewOutletCount(3)
    expect(readOverviewOutletCountHint()).toBe(3)
  })

  it('still reserves one placeholder after a successful zero-outlet result', () => {
    rememberOverviewOutletCount(0)
    expect(localStorage.getItem('shawarmania.overview-outlet-count')).toBe('0')
    expect(readOverviewOutletCountHint()).toBe(1)
  })

  it.each(['not-a-number', '-2', '2.5'])('ignores an invalid stored value of %s', (value) => {
    localStorage.setItem('shawarmania.overview-outlet-count', value)
    expect(readOverviewOutletCountHint()).toBe(1)
  })

  it('caps an excessive placeholder count without changing the stored fact', () => {
    rememberOverviewOutletCount(100)
    expect(localStorage.getItem('shawarmania.overview-outlet-count')).toBe('100')
    expect(readOverviewOutletCountHint()).toBe(24)
  })

  it('falls back safely when browser storage cannot be read or written', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked')
      }),
    } as unknown as Storage
    expect(readOverviewOutletCountHint(storage)).toBe(1)
    expect(() => rememberOverviewOutletCount(2, storage)).not.toThrow()
  })
})
