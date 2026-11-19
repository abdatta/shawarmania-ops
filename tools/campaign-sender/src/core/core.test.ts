// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PORTS } from '../../../../ports.ts'

import { reconnectDelayMs } from './backoff.ts'
import { authFolder, clearHalt, dataFolder, readHalt, writeHalt } from './data-folder.ts'
import { classifyDisconnect, HALT_EXPLANATIONS, RESTRICTED } from './disconnect.ts'
import { LINK_PAGE_PORT, serveLinkPage } from './link-page-server.ts'
import { fullPhoneNumber, lastFour } from './phone-number.ts'
import { linkedPage, qrPage, waitingPage } from './qr-page.ts'

describe('classifyDisconnect', () => {
  const refusedLogin = 'Connection Failure'
  const endedStream = 'Stream Errored (conflict)'

  it.each([
    [401, refusedLogin, 'logged_out'],
    [403, refusedLogin, 'forbidden'],
    [402, refusedLogin, 'refused'],
    [406, refusedLogin, 'refused'],
    [411, refusedLogin, 'refused'],
    [401, 'Stream Errored (device_removed)', 'logged_out'],
    [403, 'Stream Errored (unknown)', 'forbidden'],
    [440, endedStream, 'replaced'],
    [411, 'Multi-device beta not joined', 'multidevice_mismatch'],
    [401, 'Intentional Logout', 'logged_out'],
  ] as const)('halts on %i said as %j', (statusCode, message, reason) => {
    expect(classifyDisconnect({ statusCode, message })).toEqual({
      action: 'halt',
      haltReason: reason,
    })
    expect(HALT_EXPLANATIONS[reason]).toBeTruthy()
  })

  it('halts as restricted on the sender’s own close for a restriction, and on nothing WhatsApp words', () => {
    expect(classifyDisconnect(RESTRICTED)).toEqual({ action: 'halt', haltReason: 'restricted' })
    expect(HALT_EXPLANATIONS.restricted).toMatch(/do not run npm run restart/)
    // The same number from the network is still only the network.
    expect(classifyDisconnect({ statusCode: 463, message: 'WebSocket Error (463)' })).toEqual({
      action: 'reconnect',
    })
  })

  it('restarts when WhatsApp asks for a fresh connection after linking', () => {
    expect(
      classifyDisconnect({ statusCode: 515, message: 'Stream Errored (restart required)' }),
    ).toEqual({ action: 'restart' })
  })

  // The review finding this module was rewritten for: Baileys reports 500 for
  // any fault it cannot name, and a proxy's own 403 as 403. None is WhatsApp's
  // verdict, and none may halt a healthy link.
  it.each([
    [500, 'WebSocket Error (Unexpected server response: 302)'],
    [500, 'WebSocket Error (certificate is not yet valid)'],
    [403, 'WebSocket Error (Unexpected server response: 403)'],
    [401, 'WebSocket Error (Unexpected server response: 401)'],
    [411, 'WebSocket Error (Unexpected server response: 411)'],
    [440, 'WebSocket Error (Unexpected server response: 440)'],
    [408, 'WebSocket Error (getaddrinfo ENOTFOUND web.whatsapp.com)'],
    [408, 'Connection was lost'],
    [408, 'QR refs attempts ended'],
    [428, 'Connection Terminated'],
    [428, 'Connection Terminated by Server'],
    [401, undefined],
    [undefined, undefined],
  ] as const)('reconnects on %s from the network (%j)', (statusCode, message) => {
    expect(classifyDisconnect({ statusCode, message })).toEqual({ action: 'reconnect' })
  })

  it.each([
    [500, refusedLogin],
    [503, refusedLogin],
    [405, refusedLogin],
    [500, 'Stream Errored (unknown)'],
    [503, 'Stream Errored (unknown)'],
  ] as const)('reconnects when WhatsApp itself is unwell: %i %j', (statusCode, message) => {
    expect(classifyDisconnect({ statusCode, message })).toEqual({ action: 'reconnect' })
  })

  it('never tells the owner to unlink without first checking the phone', () => {
    for (const text of Object.values(HALT_EXPLANATIONS)) {
      if (/unlink/i.test(text)) expect(text).toMatch(/Linked devices/)
    }
  })
})

describe('reconnectDelayMs', () => {
  it('doubles from two seconds and stops at five minutes', () => {
    const none = () => 0
    expect(reconnectDelayMs(0, none)).toBe(2_000)
    expect(reconnectDelayMs(1, none)).toBe(4_000)
    expect(reconnectDelayMs(3, none)).toBe(16_000)
    expect(reconnectDelayMs(50, none)).toBe(300_000)
  })

  it('adds at most a quarter of jitter', () => {
    expect(reconnectDelayMs(0, () => 1)).toBe(2_500)
    expect(reconnectDelayMs(50, () => 1)).toBe(375_000)
  })
})

describe('fullPhoneNumber', () => {
  it('accepts a full number however it is spaced', () => {
    expect(fullPhoneNumber('+91 98123-45678')).toEqual({ ok: true, digits: '919812345678' })
    expect(fullPhoneNumber('1 (213) 555 0100')).toEqual({ ok: true, digits: '12135550100' })
  })

  it('refuses ten digits rather than guessing the country', () => {
    const result = fullPhoneNumber('9812345678')
    expect(result.ok).toBe(false)
  })

  it.each(['', 'abc', '0919812345678', '12345', '1234567890123456'])('refuses %j', (input) => {
    expect(fullPhoneNumber(input).ok).toBe(false)
  })
})

describe('what is shown', () => {
  it('never shows more than the last four digits of a number', () => {
    expect(lastFour('919812345678')).toBe('••••5678')
    expect(lastFour('919812345678:12@s.whatsapp.net')).toBe('••••5678')
    expect(lastFour('12')).toBe('••••')
  })
})

describe('the page a QR code is shown on', () => {
  const svg = '<svg data-test="the-code"></svg>'

  it('shows the code, says which it is, and reloads itself to keep up', () => {
    const html = qrPage(svg, 3, '11:02')
    expect(html).toContain(svg)
    expect(html).toContain('Code 3, shown 11:02')
    expect(html).toMatch(/http-equiv="refresh" content="2"/)
    expect(html).toMatch(/Linked devices/)
  })

  it('holds no code and stops reloading once the link is made', () => {
    const html = linkedPage()
    expect(html).toContain('Linked.')
    expect(html).not.toContain('<svg')
    expect(html).not.toMatch(/http-equiv="refresh"/)
  })

  it('asks not to be indexed, since whoever scans it links their own account', () => {
    expect(qrPage(svg, 1, '11:00')).toMatch(/noindex/)
  })

  it('waits, reloading, while there is no code to show', () => {
    const html = waitingPage()
    expect(html).not.toContain('<svg')
    expect(html).toMatch(/http-equiv="refresh"/)
  })
})

describe('the linking page server', () => {
  it('serves what it was last told to show, at / only, and lets nothing cache it', async () => {
    const page = await serveLinkPage('<p>first</p>', 0)
    try {
      expect(page.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      const first = await fetch(page.url)
      expect(await first.text()).toBe('<p>first</p>')
      expect(first.headers.get('cache-control')).toBe('no-store')

      page.show('<p>second</p>')
      expect(await (await fetch(page.url)).text()).toBe('<p>second</p>')

      expect((await fetch(`${page.url}/anything-else`)).status).toBe(404)
      expect((await fetch(page.url, { method: 'POST' })).status).toBe(404)
    } finally {
      await page.close()
    }
  })

  it('refuses a port that is taken, so two windows cannot both be linking', async () => {
    const first = await serveLinkPage('one', 0)
    try {
      const port = Number(new URL(first.url).port)
      await expect(serveLinkPage('two', port)).rejects.toThrow()
    } finally {
      await first.close()
    }
  })

  it('uses the port the repository keeps for it', () => {
    expect(LINK_PAGE_PORT).toBe(PORTS.campaignSenderLink)
  })
})

describe('the data folder and the halt record', () => {
  let folder: string

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'campaign-sender-'))
  })

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true })
  })

  it('prefers an override, then LOCALAPPDATA', () => {
    expect(dataFolder({ CAMPAIGN_SENDER_DATA_DIR: 'X:/here' })).toBe('X:/here')
    expect(dataFolder({ LOCALAPPDATA: join('C:', 'Local') })).toBe(
      join('C:', 'Local', 'shawarmania-campaign-sender'),
    )
    expect(authFolder(folder)).toBe(join(folder, 'whatsapp-auth'))
  })

  it('has no halt until one is written, and none after it is cleared', () => {
    expect(readHalt(folder)).toBeNull()
    const written = writeHalt(folder, 'forbidden', new Date('2026-11-17T10:00:00Z'))
    expect(written).toEqual({ reason: 'forbidden', at: '2026-11-17T10:00:00.000Z' })
    expect(readHalt(folder)).toEqual(written)
    clearHalt(folder)
    expect(readHalt(folder)).toBeNull()
  })

  it('writes the halt even when the folder does not exist yet', () => {
    const fresh = join(folder, 'not', 'made')
    writeHalt(fresh, 'logged_out')
    expect(readHalt(fresh)?.reason).toBe('logged_out')
  })

  it('treats an unreadable halt file as a halt', () => {
    writeFileSync(join(folder, 'halted.json'), '{ not json', 'utf8')
    expect(readHalt(folder)?.reason).toBe('unreadable_record')
  })
})
