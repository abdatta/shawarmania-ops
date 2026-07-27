import { describe, expect, it } from 'vitest'

import {
  formatBusinessDate,
  formatDate,
  formatDateTime,
  formatTime,
  resolveBusinessDate,
  shiftBusinessDate,
} from './datetime'

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

describe('resolveBusinessDate', () => {
  // Asserted against public.app_business_date in the same commit: the client
  // labelling a write with a different business day than the database would
  // put a check-in on a day nobody is looking at.
  it.each([
    ['2026-07-25T14:30:00Z', '04:00', '2026-07-25', 'an afternoon bill, 20:00 IST'],
    ['2026-07-25T18:50:00Z', '04:00', '2026-07-25', '00:20 IST — still the previous business day'],
    ['2026-07-25T22:25:00Z', '04:00', '2026-07-25', '03:55 IST — five minutes before cutover'],
    [
      '2026-07-25T22:30:00Z',
      '04:00',
      '2026-07-26',
      '04:00 IST — the cutover itself starts the new day',
    ],
    ['2026-07-25T22:35:00Z', '04:00', '2026-07-26', '04:05 IST — after cutover'],
    [
      '2026-07-25T18:50:00Z',
      '00:00',
      '2026-07-26',
      'with no cutover, IST midnight is the boundary',
    ],
    ['2026-07-25T14:30:00Z', '04:00:00', '2026-07-25', 'HH:MM:SS cutovers parse too'],
  ])('%s with cutover %s resolves to %s (%s)', (instant, cutover, expected) => {
    expect(resolveBusinessDate(instant, cutover)).toBe(expected)
  })

  it('accepts a Date as well as a string', () => {
    expect(resolveBusinessDate(new Date('2026-07-25T14:30:00Z'), '04:00')).toBe('2026-07-25')
  })

  it('does not read the device time zone', () => {
    // Same instant, expressed with a different offset: the answer is a property
    // of the instant and the outlet, never of the device that asked.
    expect(resolveBusinessDate('2026-07-26T00:20:00+05:30', '04:00')).toBe(
      resolveBusinessDate('2026-07-25T18:50:00Z', '04:00'),
    )
  })

  it('rejects a malformed cutover rather than guessing', () => {
    expect(() => resolveBusinessDate('2026-07-25T14:30:00Z', '4am')).toThrow(TypeError)
  })

  it('rejects an unparseable instant', () => {
    expect(() => resolveBusinessDate('not a date', '04:00')).toThrow(TypeError)
  })
})

describe('shiftBusinessDate', () => {
  it.each([
    ['2026-07-25', -1, '2026-07-24'],
    ['2026-07-25', 1, '2026-07-26'],
    ['2026-07-25', 0, '2026-07-25'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2026-01-01', -1, '2025-12-31'],
  ])('%s shifted by %d is %s', (from, days, expected) => {
    expect(shiftBusinessDate(from, days)).toBe(expected)
  })

  it('rejects anything that is not a business date', () => {
    expect(() => shiftBusinessDate('2026-07-25T00:00:00Z', 1)).toThrow(TypeError)
  })
})
