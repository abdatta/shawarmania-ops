import { describe, expect, it } from 'vitest'

import { formatBusinessDate, formatDate, formatDateTime, formatTime } from './datetime'

// 25 Jul 2026, 14:30 UTC == 20:00 IST the same day.
const AFTERNOON_UTC = '2026-07-25T14:30:00Z'

// 25 Jul 2026, 18:50 UTC == 00:20 IST on the 26th — the late-night bill that
// belongs to the previous business day. Only the *display* is asserted here;
// business-date resolution is a separate concern (data-model-and-tenancy).
const LATE_NIGHT_UTC = '2026-07-25T18:50:00Z'

describe('formatDate', () => {
  it('renders in Asia/Kolkata', () => {
    expect(formatDate(AFTERNOON_UTC)).toBe('25 Jul 2026')
  })

  it('rolls to the next calendar day when IST has already crossed midnight', () => {
    expect(formatDate(LATE_NIGHT_UTC)).toBe('26 Jul 2026')
  })

  it('accepts a Date as well as a string', () => {
    expect(formatDate(new Date(AFTERNOON_UTC))).toBe('25 Jul 2026')
  })

  it('rejects an unparseable value', () => {
    expect(() => formatDate('not a date')).toThrow(TypeError)
  })
})

describe('formatTime', () => {
  it('shifts UTC into IST', () => {
    expect(formatTime(AFTERNOON_UTC)).toMatch(/^08:00/)
    expect(formatTime(LATE_NIGHT_UTC)).toMatch(/^12:20/)
  })
})

describe('formatDateTime', () => {
  it('renders date and time together in IST', () => {
    expect(formatDateTime(AFTERNOON_UTC)).toMatch(/^25 Jul 2026/)
    expect(formatDateTime(AFTERNOON_UTC)).toMatch(/08:00/)
  })
})

describe('device time zone independence', () => {
  // The formatters pass timeZone explicitly, so a tablet set to another zone
  // still shows outlet-local time. Asserted by comparing against an
  // explicitly-UTC render of the same instant, which differs by +05:30.
  it('does not fall back to the runtime default zone', () => {
    const utcRendered = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(AFTERNOON_UTC))

    expect(utcRendered).toMatch(/^02:30/)
    expect(formatTime(AFTERNOON_UTC)).toMatch(/^08:00/)
  })
})

describe('formatBusinessDate', () => {
  it('renders a calendar label without applying an offset', () => {
    expect(formatBusinessDate('2026-07-25')).toBe('25 Jul 2026')
    expect(formatBusinessDate('2026-01-01')).toBe('01 Jan 2026')
  })

  it('rejects anything that is not a YYYY-MM-DD date', () => {
    expect(() => formatBusinessDate('2026-07-25T00:00:00Z')).toThrow(TypeError)
    expect(() => formatBusinessDate('25-07-2026')).toThrow(TypeError)
  })
})
