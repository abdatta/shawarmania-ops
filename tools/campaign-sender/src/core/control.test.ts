// @vitest-environment node
import { readFileSync } from 'node:fs'
import { request } from 'node:http'

import { describe, expect, it } from 'vitest'

import { PORTS } from '../../../../ports.ts'

import type { TickResult } from './contracts.ts'
import { CONTROL_PAGE_PORT, serveControlPage } from './control-page-server.ts'
import { controlPage } from './control-page.ts'
import { LINK_PAGE_PORT } from './link-page-server.ts'
import {
  STUCK_AFTER_MS,
  isStuck,
  startingView,
  viewAfterEnd,
  viewAfterEvent,
  viewAfterTick,
} from './sender-view.ts'
import type { SenderView, ViewContext } from './sender-view.ts'

const NOW = Date.UTC(2026, 10, 18, 6, 30)
const at = (ms = NOW): ViewContext => ({ now: ms, clockText: () => '14:05' })

const tick = (over: Partial<TickResult> = {}): TickResult => ({
  contractVersion: 1,
  standDown: false,
  minGapSeconds: 45,
  maxGapSeconds: 90,
  window: { open: true, opensAt: null },
  released: null,
  waitingForRelease: null,
  campaignsOpen: true,
  sentToday: 0,
  lastBatchFinishedAt: null,
  testsWaiting: 0,
  ...over,
})

const WAITING = { campaignId: 'c1', batchNo: 3, campaignName: 'Diwali offer', recipients: 100 }

describe('the sender, summed up for a person', () => {
  it('starts out connecting, with nothing asking for the owner', () => {
    expect(startingView(at())).toMatchObject({ mood: 'connecting', attention: null })
  })

  it('asks for the owner when a batch is waiting, with what he needs to decide', () => {
    let view = viewAfterTick(
      startingView(at()),
      tick({ waitingForRelease: WAITING, sentToday: 200, lastBatchFinishedAt: new Date(NOW) }),
      at(),
    )
    view = viewAfterEvent(view, { kind: 'idle', campaignsOpen: true, waiting: WAITING }, at())

    expect(view.mood).toBe('waiting_for_you')
    expect(view.headline).toBe('Batch 3 of “Diwali offer” is waiting for you')
    expect(view.attention).toEqual({
      id: 'waiting:c1:3',
      tone: 'action',
      title: 'Batch 3 is waiting for you',
      lines: ['“Diwali offer” · 100 people', 'Sent today: 200', 'Last batch finished at 14:05'],
    })
  })

  it('keeps the same card for the same batch, so putting it away sticks', () => {
    const first = viewAfterTick(startingView(at()), tick({ waitingForRelease: WAITING }), at())
    const later = viewAfterTick(
      first,
      tick({ waitingForRelease: WAITING, sentToday: 5 }),
      at(NOW + 60_000),
    )
    expect(later.attention?.id).toBe(first.attention?.id)
    expect(later.attention?.lines).toContain('Sent today: 5')
  })

  it('stops asking once the batch is released, and shows it sending', () => {
    let view = viewAfterTick(startingView(at()), tick({ waitingForRelease: WAITING }), at())
    const released = { campaignId: 'c1', batchNo: 3 }
    view = viewAfterTick(view, tick({ released }), at())
    view = viewAfterEvent(view, { kind: 'sent', batchNo: 3, position: 1 }, at())

    expect(view.attention).toBeNull()
    expect(view).toMatchObject({ mood: 'sending', headline: 'Sending batch 3' })
    expect(view.thisRun.sent).toBe(1)
  })

  it('says it is connected while it waits out the pause after connecting', () => {
    // A start or a reconnect is followed by a pause before the queue is next
    // asked; the sender is connected through it, not connecting.
    let view = viewAfterEvent(startingView(at()), { kind: 'gap', ms: 75_000 }, at())
    expect(view).toMatchObject({ mood: 'idle', headline: 'Connected to WhatsApp' })

    view = viewAfterEvent(view, { kind: 'waiting_for_whatsapp' }, at())
    view = viewAfterTick(view, tick({ waitingForRelease: WAITING }), at())
    view = viewAfterEvent(view, { kind: 'gap', ms: 63_000 }, at())
    expect(view).toMatchObject({
      mood: 'waiting_for_you',
      headline: 'Batch 3 of “Diwali offer” is waiting for you',
    })
  })

  it('tells a dropped connection being remade apart from starting up', () => {
    // Starting up, and the database out of reach before WhatsApp ever opened.
    let view = viewAfterEvent(startingView(at()), { kind: 'waiting_for_whatsapp' }, at())
    view = viewAfterEvent(view, { kind: 'database_unreachable', retryInMs: 5_000 }, at())
    view = viewAfterEvent(view, { kind: 'waiting_for_whatsapp' }, at())
    expect(view).toMatchObject({ mood: 'connecting', headline: 'Connecting to WhatsApp' })

    // Connected once in this run, then dropped: it is mending, not starting.
    view = viewAfterEvent(view, { kind: 'idle', campaignsOpen: false, waiting: null }, at())
    view = viewAfterEvent(view, { kind: 'waiting_for_whatsapp' }, at())
    expect(view).toMatchObject({ mood: 'reconnecting', headline: 'WhatsApp dropped. Reconnecting' })

    view = viewAfterEvent(view, { kind: 'gap', ms: 60_000 }, at())
    expect(view).toMatchObject({ mood: 'idle', headline: 'Connected to WhatsApp' })
  })

  it('counts as stuck once it has failed to reach WhatsApp or the database for ten minutes', () => {
    const start = startingView(at())
    expect(isStuck(start, NOW + STUCK_AFTER_MS - 1)).toBe(false)
    expect(isStuck(start, NOW + STUCK_AFTER_MS)).toBe(true)

    // Connected: the clock stops.
    let view = viewAfterEvent(
      start,
      { kind: 'idle', campaignsOpen: false, waiting: null },
      at(NOW + 60_000),
    )
    expect(view.troubleSince).toBeNull()
    expect(isStuck(view, NOW + 60 * 60_000)).toBe(false)

    // Dropped later: the clock starts from the drop, and the database going
    // too does not restart it.
    const dropped = NOW + 2 * 60 * 60_000
    view = viewAfterEvent(view, { kind: 'waiting_for_whatsapp' }, at(dropped))
    view = viewAfterEvent(
      view,
      { kind: 'database_unreachable', retryInMs: 60_000 },
      at(dropped + 5 * 60_000),
    )
    expect(view.troubleSince).toBe(new Date(dropped).toISOString())
    expect(isStuck(view, dropped + STUCK_AFTER_MS - 1)).toBe(false)
    expect(isStuck(view, dropped + STUCK_AFTER_MS)).toBe(true)

    // A halt is the owner's at once, and is not "stuck".
    const halted = viewAfterEnd(view, { kind: 'halted', reason: 'logged_out' }, 'x', at(dropped))
    expect(isStuck(halted, dropped + 2 * STUCK_AFTER_MS)).toBe(false)
  })

  it('says when it is sending to the test numbers', () => {
    const view = viewAfterEvent(startingView(at()), { kind: 'sent', batchNo: 0, position: 1 }, at())
    expect(view).toMatchObject({ mood: 'sending', headline: 'Sending to the test numbers' })
  })

  it('counts what this run did', () => {
    let view = startingView(at())
    for (const event of [
      { kind: 'sent', batchNo: 1, position: 1 },
      { kind: 'not_on_whatsapp', batchNo: 1, position: 2 },
      { kind: 'failed', batchNo: 1, position: 3, code: 'x' },
      { kind: 'unsure', count: 1 },
      { kind: 'sent', batchNo: 1, position: 5 },
    ] as const) {
      view = viewAfterEvent(view, event, at())
    }
    expect(view.thisRun).toEqual({ sent: 2, notOnWhatsApp: 1, failed: 1, unsure: 1 })
  })

  it('tells the news of a finished batch, and a new waiting batch takes its place', () => {
    let view = viewAfterEvent(startingView(at()), { kind: 'batch_finished', batchNo: 3 }, at())
    expect(view.attention).toMatchObject({ tone: 'done', title: 'Batch 3 is finished' })

    view = viewAfterTick(
      view,
      tick({ waitingForRelease: { ...WAITING, batchNo: 4 } }),
      at(NOW + 1_000),
    )
    expect(view.attention).toMatchObject({ id: 'waiting:c1:4', tone: 'action' })
  })

  it('puts an alarm ahead of everything, and a halt says why', () => {
    let view = viewAfterTick(startingView(at()), tick({ waitingForRelease: WAITING }), at())
    view = viewAfterEvent(
      view,
      { kind: 'paused_by_sender', campaignId: 'c1', reason: 'three_in_a_row' },
      at(),
    )
    expect(view.attention).toMatchObject({
      tone: 'alarm',
      title: 'The sender paused the campaign',
    })

    const halted = viewAfterEnd(
      view,
      { kind: 'halted', reason: 'restricted' },
      'WhatsApp says…',
      at(),
    )
    expect(halted).toMatchObject({ mood: 'halted', waiting: null })
    expect(halted.attention).toMatchObject({ tone: 'alarm', lines: ['WhatsApp says…'] })
  })

  it('says when the window opens, and that it has stopped', () => {
    const opens = new Date(NOW + 3_600_000)
    const view = viewAfterEvent(startingView(at()), { kind: 'outside_hours', opensAt: opens }, at())
    expect(view).toMatchObject({ mood: 'outside_hours', windowOpensAt: opens.toISOString() })
    expect(viewAfterEnd(view, { kind: 'stopped' }, '', at()).mood).toBe('stopped')
  })
})

describe('the tray icon and the page', () => {
  // Every state the sender can be in, and `unreachable`, the tray's own word
  // for a sender that does not answer.
  const MOODS = [
    'connecting',
    'reconnecting',
    'idle',
    'waiting_for_you',
    'sending',
    'outside_hours',
    'held',
    'database_unreachable',
    'stood_down',
    'halted',
    'stopped',
  ]
  const tray = readFileSync(new URL('../../windows/tray.ps1', import.meta.url), 'utf8')
  const hex = (r: string, g: string, b: string) =>
    '#' + [r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
  const named = Object.fromEntries(
    [...tray.matchAll(/^\$(\w+)\s*=\s*\(Rgb (\d+) (\d+) (\d+)\)/gm)].map((m) => [
      m[1]!.toUpperCase(),
      hex(m[2]!, m[3]!, m[4]!),
    ]),
  )
  const table = (name: string) => {
    const from = tray.indexOf(`$${name} = @{`)
    const body = tray.slice(from, tray.indexOf('}', from))
    return Object.fromEntries(
      [...body.matchAll(/^\s+(\w+)\s*=\s*\$(\w+)/gm)].map((m) => [m[1]!, m[2]!.toUpperCase()]),
    )
  }
  const page = controlPage('t')
  const pageNamed = Object.fromEntries(
    [...page.matchAll(/(BLUE|GREEN|YELLOW|RED|GREY|BLACK) = '(#[0-9a-f]{6})'/g)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  )
  const pageTable = (name: string, value: RegExp) => {
    const from = page.indexOf(`const ${name} = {`)
    const body = page.slice(from, page.indexOf('}', from))
    return Object.fromEntries(
      [...body.matchAll(new RegExp(`(\\w+): ${value.source}`, 'g'))].map((m) => [m[1]!, m[2]!]),
    )
  }

  it('colours every state the same way, from a handful of colours', () => {
    const trayColours = Object.fromEntries(
      Object.entries(table('MoodColours')).map(([mood, colour]) => [mood, named[colour]]),
    )
    const pageColours = Object.fromEntries(
      Object.entries(pageTable('COLOURS', /(BLUE|GREEN|YELLOW|RED|GREY|BLACK)/)).map(
        ([mood, colour]) => [mood, pageNamed[colour]],
      ),
    )
    expect(Object.keys(pageColours).sort()).toEqual([...MOODS].sort())
    expect(Object.keys(trayColours).sort()).toEqual([...MOODS, 'unreachable'].sort())
    for (const mood of MOODS) expect(pageColours[mood], mood).toBe(trayColours[mood])
    expect(new Set(Object.values(trayColours)).size).toBeLessThanOrEqual(6)
  })

  it('pulses while something is worked on and blinks only when it waits on the owner', () => {
    const trayMotion = Object.fromEntries(
      Object.entries(table('MoodMotion')).map(([mood, motion]) => [mood, motion.toLowerCase()]),
    )
    const pageMotion = pageTable('MOTION', /'(pulse|blink)'/)
    expect(pageMotion).toEqual(trayMotion)
    expect(trayMotion).toEqual({
      sending: 'pulse',
      reconnecting: 'pulse',
      database_unreachable: 'pulse',
      halted: 'blink',
    })
    // Stuck mending blinks, on both.
    expect(tray).toMatch(/if \(\$stuck\) \{ \$Blink \}/)
    expect(page).toContain("view.stuck ? 'blink'")
  })
})

describe('the Send batch page', () => {
  it('carries its token, one button, and no way to be indexed', () => {
    const html = controlPage('tok-123')
    expect(html).toContain('"tok-123"')
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain('Send batch')
    expect(html).toMatch(/noindex/)
  })

  it('puts what it shows in as text, never as markup', () => {
    expect(controlPage('t')).not.toMatch(/innerHTML/)
  })
})

describe('the Send batch page server', () => {
  const view = (): SenderView => startingView(at())

  const serve = async (onRelease = async () => ({ ok: true, message: 'Released.' })) => {
    let presses = 0
    const server = await serveControlPage({
      token: 'secret',
      page: controlPage,
      state: () => ({ ...view(), rehearsal: true }),
      onRelease: () => {
        presses += 1
        return onRelease()
      },
      port: 0,
    })
    return { server, presses: () => presses }
  }

  /** A request with whatever Host header it likes, which `fetch` will not send. */
  const raw = (url: string, host: string, method = 'GET') =>
    new Promise<number>((resolve, reject) => {
      const target = new URL(url)
      const sent = request(
        { host: '127.0.0.1', port: target.port, path: target.pathname, method, headers: { host } },
        (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        },
      )
      sent.on('error', reject)
      sent.end()
    })

  it('serves the page and the state, and nothing may cache either', async () => {
    const { server } = await serve()
    try {
      const page = await fetch(server.url)
      expect(await page.text()).toContain('Send batch')
      expect(page.headers.get('cache-control')).toBe('no-store')
      const state = (await (await fetch(`${server.url}/state`)).json()) as { mood: string }
      expect(state).toMatchObject({ mood: 'connecting', rehearsal: true })
      expect((await fetch(`${server.url}/nothing`)).status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('releases a batch only for a press that carries the page’s token', async () => {
    const { server, presses } = await serve()
    try {
      const without = await fetch(`${server.url}/release`, { method: 'POST' })
      const wrong = await fetch(`${server.url}/release`, {
        method: 'POST',
        headers: { 'x-sender-token': 'guess' },
      })
      expect([without.status, wrong.status]).toEqual([403, 403])
      expect(presses()).toBe(0)

      const pressed = await fetch(`${server.url}/release`, {
        method: 'POST',
        headers: { 'x-sender-token': 'secret' },
      })
      expect(await pressed.json()).toEqual({ ok: true, message: 'Released.' })
      expect(presses()).toBe(1)
      // A GET never releases, token or not.
      expect((await fetch(`${server.url}/release`)).status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('says so when the batch could not be released', async () => {
    const { server } = await serve(async () => ({ ok: false, message: 'It is not waiting.' }))
    try {
      const pressed = await fetch(`${server.url}/release`, {
        method: 'POST',
        headers: { 'x-sender-token': 'secret' },
      })
      expect(pressed.status).toBe(409)
      expect(await pressed.json()).toEqual({ ok: false, message: 'It is not waiting.' })
    } finally {
      await server.close()
    }
  })

  it('shows the history only to the page that carries its token', async () => {
    const server = await serveControlPage({
      token: 'secret',
      page: controlPage,
      state: () => ({}),
      onRelease: async () => ({ ok: true, message: '' }),
      history: async () => ({ sent: [{ who: 'Asha Roy · +91 90000 00901' }] }),
      port: 0,
    })
    try {
      // Whole numbers: nobody without the page's token reads them.
      expect((await fetch(`${server.url}/history`)).status).toBe(403)
      const wrong = await fetch(`${server.url}/history`, { headers: { 'x-sender-token': 'guess' } })
      expect(wrong.status).toBe(403)
      const right = await fetch(`${server.url}/history`, {
        headers: { 'x-sender-token': 'secret' },
      })
      expect(right.status).toBe(200)
      expect(right.headers.get('cache-control')).toBe('no-store')
      expect(await right.json()).toEqual({ sent: [{ who: 'Asha Roy · +91 90000 00901' }] })
      // And the summary the tray reads still carries no number.
      expect(await (await fetch(`${server.url}/state`)).text()).not.toMatch(/\d{6}/)
    } finally {
      await server.close()
    }
  })

  it('says so when the history cannot be read just now, and has none in a rehearsal', async () => {
    const failing = await serveControlPage({
      token: 'secret',
      page: controlPage,
      state: () => ({}),
      onRelease: async () => ({ ok: true, message: '' }),
      history: async () => {
        throw new Error('offline')
      },
      port: 0,
    })
    const none = await serveControlPage({
      token: 'secret',
      page: controlPage,
      state: () => ({}),
      onRelease: async () => ({ ok: true, message: '' }),
      port: 0,
    })
    try {
      const headers = { 'x-sender-token': 'secret' }
      expect((await fetch(`${failing.url}/history`, { headers })).status).toBe(503)
      expect((await fetch(`${none.url}/history`, { headers })).status).toBe(404)
    } finally {
      await failing.close()
      await none.close()
    }
  })

  it('answers nobody who reached it under another name', async () => {
    const { server, presses } = await serve()
    try {
      const port = new URL(server.url).port
      expect(await raw(server.url, `127.0.0.1:${port}`)).toBe(200)
      expect(await raw(server.url, `localhost:${port}`)).toBe(200)
      expect(await raw(server.url, `evil.example:${port}`)).toBe(403)
      expect(await raw(`${server.url}/release`, 'evil.example', 'POST')).toBe(403)
      expect(presses()).toBe(0)
    } finally {
      await server.close()
    }
  })

  it('has a port of its own, apart from the page that is sometimes made public', () => {
    expect(CONTROL_PAGE_PORT).toBe(PORTS.campaignSender)
    expect(CONTROL_PAGE_PORT).not.toBe(LINK_PAGE_PORT)
  })
})
