// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { QUEUE_CONTRACT_VERSION, SendRefused } from './contracts.ts'
import type {
  CampaignQueue,
  ClaimResult,
  Clock,
  LinkConnection,
  LinkEnd,
  LinkHandlers,
  ReceiptListener,
  ReceiptReport,
  ReceiptStatus,
  TickResult,
  WhatsAppLink,
} from './contracts.ts'
import { memoryStore, newRehearsal, rehearsalQueue } from './rehearsal-queue.ts'
import type { RehearsalOptions, RehearsalRowKind, RehearsalState } from './rehearsal-queue.ts'
import { runSender } from './sending-loop.ts'
import type { SenderEnd, SenderEvent } from './sending-loop.ts'

// ── A clock the test moves by hand ──────────────────────────────────────────

/** Lets every promise that can settle without time passing do so. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

class FakeClock implements Clock {
  private at: number
  private timers: Array<{ due: number; fire: () => void }> = []

  constructor(startMs: number) {
    this.at = startMs
  }

  now = () => this.at

  sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve()
      const timer = {
        due: this.at + ms,
        fire: () => {
          this.timers = this.timers.filter((other) => other !== timer)
          signal.removeEventListener('abort', timer.fire)
          resolve()
        },
      }
      this.timers.push(timer)
      signal.addEventListener('abort', timer.fire, { once: true })
    })

  async advance(ms: number): Promise<void> {
    const target = this.at + ms
    for (;;) {
      await settle()
      const next = this.timers
        .filter((timer) => timer.due <= target)
        .sort((a, b) => a.due - b.due)[0]
      if (!next) break
      this.at = Math.max(this.at, next.due)
      next.fire()
    }
    this.at = target
    await settle()
  }
}

// ── A WhatsApp link the test opens, drops and halts ─────────────────────────

interface SentMessage {
  to: string
  text: string
  image: boolean
  at: number
  id: string
}

const never = new Promise<never>(() => {})

class FakeLink implements WhatsAppLink {
  holds = 0
  lookups: string[] = []
  mostInFlight = 0
  sendTakesMs = 0
  /** Given the attempt number, an error to throw in place of sending. */
  failSend: ((attempt: number) => Error | null) | null = null
  failLookup: ((phone: string) => Error | null) | null = null
  /** Runs after the message has gone and before `send` returns its id. */
  beforeSendReturns: ((id: string) => void) | null = null
  /** Receipts WhatsApp was holding, handed to the first listener of the next connection. */
  heldForNextOpen: Array<[string, ReceiptStatus]> = []

  private inFlight = 0
  private attempts = 0
  private handlers: LinkHandlers | null = null
  private finish: ((end: LinkEnd) => void) | null = null
  private listeners: ReceiptListener[] = []
  private live: object | null = null
  private readonly clock: FakeClock
  private readonly log: SentMessage[]
  private readonly absent: ReadonlySet<string>

  constructor(clock: FakeClock, log: SentMessage[], absent: ReadonlySet<string> = new Set()) {
    this.clock = clock
    this.log = log
    this.absent = absent
  }

  hold = (handlers: LinkHandlers, signal: AbortSignal) => {
    this.holds += 1
    this.handlers = handlers
    return new Promise<LinkEnd>((resolve) => {
      this.finish = resolve
      signal.addEventListener('abort', () => resolve({ kind: 'stopped' }), { once: true })
    })
  }

  open(): void {
    const token = {}
    this.live = token
    this.listeners = []
    let held = this.heldForNextOpen
    this.heldForNextOpen = []
    const connection: LinkConnection = {
      resolve: async (phone) => {
        if (this.live !== token) throw new Error('Connection Closed')
        this.lookups.push(phone)
        const failure = this.failLookup?.(phone)
        if (failure) throw failure
        return this.absent.has(phone) ? null : `${phone}@s.whatsapp.net`
      },
      send: async (address, message) => {
        if (this.live !== token) throw new Error('Connection Closed')
        this.attempts += 1
        const attempt = this.attempts
        this.inFlight += 1
        this.mostInFlight = Math.max(this.mostInFlight, this.inFlight)
        try {
          if (this.sendTakesMs > 0) {
            await this.clock.sleep(this.sendTakesMs, new AbortController().signal)
          }
          const failure = this.failSend?.(attempt)
          if (failure) throw failure
          const id = `wamid-${this.log.length + 1}`
          this.log.push({
            to: address.split('@')[0] ?? '',
            text: message.text,
            image: Boolean(message.image),
            at: this.clock.now(),
            id,
          })
          this.beforeSendReturns?.(id)
          return id
        } finally {
          this.inFlight -= 1
        }
      },
      onReceipt: (listener) => {
        this.listeners.push(listener)
        for (const [id, status] of held) listener(id, status)
        held = []
      },
    }
    this.handlers?.onOpen(connection)
  }

  drop(): void {
    this.live = null
    this.handlers?.onClose()
  }

  halt(reason: string): void {
    this.drop()
    this.finish?.({ kind: 'halted', reason })
  }

  end(end: LinkEnd): void {
    this.finish?.(end)
  }

  receipt(id: string, status: ReceiptStatus, code?: string): void {
    for (const listener of this.listeners) listener(id, status, code)
  }
}

// ── The queue, with places for a test to step in ────────────────────────────

type Method = keyof CampaignQueue

interface Hooks {
  before: Partial<Record<Method, (...args: unknown[]) => unknown>>
  after: Partial<Record<Method, (result: unknown, ...args: unknown[]) => unknown>>
}

/** Records every call, and lets a test fail one, hang one, or change its answer. */
function hooked(inner: CampaignQueue, calls: string[], hooks: Hooks): CampaignQueue {
  const wrap =
    (method: Method) =>
    async (...args: unknown[]) => {
      calls.push(method)
      await hooks.before[method]?.(...args)
      const result = await (inner[method] as (...given: unknown[]) => Promise<unknown>)(...args)
      const replaced = await hooks.after[method]?.(result, ...args)
      return replaced === undefined ? result : replaced
    }
  return {
    tick: wrap('tick'),
    claimNext: wrap('claimNext'),
    claimNextTest: wrap('claimNextTest'),
    finishNotices: wrap('finishNotices'),
    markFinishNotice: wrap('markFinishNotice'),
    report: wrap('report'),
    releaseStaleClaims: wrap('releaseStaleClaims'),
    reportReceipts: wrap('reportReceipts'),
    outstandingMessageIds: wrap('outstandingMessageIds'),
    pauseCampaign: wrap('pauseCampaign'),
  } as unknown as CampaignQueue
}

// ── One world per test ──────────────────────────────────────────────────────

/** 12:00 in India: inside the default 10:00 to 21:00 window. */
const NOON_IN_INDIA = Date.UTC(2026, 10, 18, 6, 30)
const MIN_GAP = 45
const MAX_GAP = 90
const BODY = 'Offer text 7Q2X for {position} of {total}'
const IMAGE_BYTES = Buffer.from('not really an image')

/** Numbers from the range kept for fiction, one per recipient, so "twice" can be counted. */
const phoneAt = (position: number) => `121355501${String(position).padStart(2, '0')}`

function world(
  kinds: readonly RehearsalRowKind[] = ['text', 'text', 'text', 'text'],
  startMs = NOON_IN_INDIA,
  extra: RehearsalOptions = {},
) {
  const clock = new FakeClock(startMs)
  const store = memoryStore(
    newRehearsal(kinds, {
      minGapSeconds: MIN_GAP,
      maxGapSeconds: MAX_GAP,
      body: BODY,
      imagePath: 'offer.jpg',
      ...extra,
    }),
  )
  const calls: string[] = []
  const hooks: Hooks = { before: {}, after: {} }
  const queue = hooked(
    rehearsalQueue(store, clock, (row) => phoneAt(row.position)),
    calls,
    hooks,
  )
  /** Every message that left, across every run in this world. */
  const sent: SentMessage[] = []
  const absent = new Set(
    kinds.flatMap((kind, index) => (kind === 'absent' ? [phoneAt(index + 1)] : [])),
  )
  const draws = [0, 0.999, 0.5, 0.25]
  let drawn = 0

  const newLink = () => new FakeLink(clock, sent, absent)

  /** Starts the loop as a freshly started process would. */
  const start = (link: FakeLink) => {
    const events: SenderEvent[] = []
    const ticks: TickResult[] = []
    const controls = { askNow: () => {} }
    const controller = new AbortController()
    const done: Promise<SenderEnd> = runSender({
      link,
      queue,
      clock,
      random: () => draws[drawn++ % draws.length] ?? 0,
      compose: async (recipient) =>
        recipient.imageUrl
          ? { text: recipient.body, image: IMAGE_BYTES }
          : { text: recipient.body },
      onEvent: (event) => events.push(event),
      onTick: (tick) => ticks.push(tick),
      onReady: (given) => {
        controls.askNow = given.askNow
      },
      signal: controller.signal,
    })
    const stop = async () => {
      controller.abort()
      await clock.advance(0)
      return done
    }
    return { events, ticks, controls, done, stop }
  }

  const edit = (change: (state: RehearsalState) => void) => {
    const state = store.load()
    change(state)
    store.save(state)
  }
  const states = () => store.load().recipients.map((row) => row.state)
  const timesSentTo = (position: number) =>
    sent.filter((message) => message.to === phoneAt(position)).length

  /** Moves time on in small steps until something is true. */
  const until = async (isTrue: () => boolean, limitMs = 6 * 60 * 60_000) => {
    for (let waited = 0; !isTrue(); waited += 5_000) {
      if (waited > limitMs) throw new Error('waited too long for the condition')
      await clock.advance(5_000)
    }
  }

  return {
    clock,
    store,
    calls,
    hooks,
    queue,
    sent,
    newLink,
    start,
    edit,
    states,
    timesSentTo,
    until,
  }
}

const minutes = (count: number) => count * 60_000

// ── The loop ────────────────────────────────────────────────────────────────

describe('pacing', () => {
  it('sends to strictly one recipient at a time', async () => {
    const w = world()
    const link = w.newLink()
    link.sendTakesMs = 3_000
    let mostInHand = 0
    w.hooks.after.claimNext = () => {
      const inHand = w.store.load().recipients.filter((row) => row.state === 'sending').length
      mostInHand = Math.max(mostInHand, inHand)
    }
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(15))

    expect(w.states()).toEqual(['sent', 'sent', 'sent', 'sent'])
    expect(link.mostInFlight).toBe(1)
    expect(mostInHand).toBe(1)
    // Every claim is settled before the next is made.
    const claimsAndReports = w.calls.filter((call) => call === 'claimNext' || call === 'report')
    expect(claimsAndReports.slice(0, 8)).toEqual([
      'claimNext',
      'report',
      'claimNext',
      'report',
      'claimNext',
      'report',
      'claimNext',
      'report',
    ])
    expect(await run.stop()).toEqual({ kind: 'stopped' })
  })

  it('waits an uneven time between sends, inside the two gap settings', async () => {
    const w = world(['text', 'text', 'text', 'text', 'text'])
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(15))

    expect(w.sent).toHaveLength(5)
    const gaps = w.sent.slice(1).map((message, index) => message.at - w.sent[index]!.at)
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(MIN_GAP * 1000)
      expect(gap).toBeLessThanOrEqual(MAX_GAP * 1000)
    }
    expect(new Set(gaps).size).toBeGreaterThan(1)
    await run.stop()
  })

  it('waits a gap before its first message too, so a restart is never a quick second send', async () => {
    const w = world()
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(3))

    expect(w.sent[0]!.at - NOON_IN_INDIA).toBeGreaterThanOrEqual(MIN_GAP * 1000)
    await run.stop()
  })

  it('reports a number that is not on WhatsApp and moves on without waiting', async () => {
    const w = world(['text', 'absent', 'text'])
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(10))

    expect(w.states()).toEqual(['sent', 'not_on_whatsapp', 'sent'])
    expect(w.timesSentTo(2)).toBe(0)
    expect(link.lookups).toContain(phoneAt(2))
    // One gap between the two messages, not two.
    expect(w.sent[1]!.at - w.sent[0]!.at).toBeLessThanOrEqual(MAX_GAP * 1000)
    await run.stop()
  })

  it('sends the image with the text as its caption', async () => {
    const w = world(['text', 'image'])
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(5))

    expect(w.sent.map((message) => message.image)).toEqual([false, true])
    expect(w.sent[1]!.text).toBe('Offer text 7Q2X for 2 of 2')
    await run.stop()
  })
})

describe('the sending window', () => {
  /** 23:00 in India. */
  const NIGHT_IN_INDIA = Date.UTC(2026, 10, 18, 17, 30)
  /** 10:00 the next morning in India. */
  const OPENS = Date.UTC(2026, 10, 19, 4, 30)

  it('sends nothing outside it, asks for nobody, and says when it opens', async () => {
    const w = world(['text', 'text'], NIGHT_IN_INDIA)
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(180))

    expect(w.sent).toHaveLength(0)
    expect(w.calls).not.toContain('claimNext')
    expect(run.events).toContainEqual({ kind: 'outside_hours', opensAt: new Date(OPENS) })
    expect(w.store.load().sender.status).toBe('outside_hours')

    await w.clock.advance(OPENS - w.clock.now() + minutes(4))
    expect(w.sent).toHaveLength(2)
    expect(w.sent[0]!.at).toBeGreaterThanOrEqual(OPENS)
    await run.stop()
  })

  it('obeys the queue when the queue refuses, whatever the tick said', async () => {
    const w = world(['text', 'text'], NIGHT_IN_INDIA)
    // A tick that wrongly says the window is open: the claim is still refused.
    w.hooks.after.tick = (result) => ({
      ...(result as TickResult),
      window: { open: true, opensAt: null },
    })
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(30))

    expect(w.calls).toContain('claimNext')
    expect(w.sent).toHaveLength(0)
    expect(w.states()).toEqual(['waiting', 'waiting'])
    expect(run.events).toContainEqual({ kind: 'outside_hours', opensAt: new Date(OPENS) })
    await run.stop()
  })
})

describe('the owners’ own test numbers', () => {
  /** 23:00 in India: the sending window is shut. */
  const NIGHT_IN_INDIA = Date.UTC(2026, 10, 18, 17, 30)
  const tests = (w: ReturnType<typeof world>) =>
    (w.store.load().tests ?? []).map((test) => test.state)

  it('go out by themselves: no release, the window shut, and no customer asked for', async () => {
    const w = world(['text', 'text'], NIGHT_IN_INDIA, { waitForRelease: true, tests: 2 })
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(5))

    expect(tests(w)).toEqual(['sent', 'sent'])
    expect(w.timesSentTo(0)).toBe(2)
    expect(w.states()).toEqual(['waiting', 'waiting'])
    expect(w.calls).not.toContain('claimNext')
    // Paced like everything else, the first of a run included.
    expect(w.sent[0]!.at - NIGHT_IN_INDIA).toBeGreaterThanOrEqual(MIN_GAP * 1000)
    expect(w.sent[1]!.at - w.sent[0]!.at).toBeGreaterThanOrEqual(MIN_GAP * 1000)
    await run.stop()
  })

  it('go before the customers of a released batch, who follow', async () => {
    const w = world(['text', 'text'], NOON_IN_INDIA, { tests: 1 })
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(10))

    expect(w.sent.map((message) => message.to)).toEqual([phoneAt(0), phoneAt(1), phoneAt(2)])
    expect(tests(w)).toEqual(['sent'])
    expect(w.states()).toEqual(['sent', 'sent'])
    await run.stop()
  })

  it('carry the campaign’s picture', async () => {
    const w = world(['text'], NOON_IN_INDIA, { tests: 1 })
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.until(() => w.sent.length >= 1)

    expect(w.sent[0]).toMatchObject({ to: phoneAt(0), image: true })
    await run.stop()
  })

  it('left in hand by a crash become unsure, and are never sent again', async () => {
    const w = world(['text'], NIGHT_IN_INDIA, { waitForRelease: true, tests: 2 })
    w.hooks.before.report = (ref) =>
      (ref as { testId?: string }).testId === 'rehearsal-test-1' ? never : undefined
    const first = w.newLink()
    w.start(first)
    first.open()
    await w.clock.advance(minutes(3))
    expect(tests(w)).toEqual(['sending', 'waiting'])

    w.hooks.before = {}
    const second = w.newLink()
    const run = w.start(second)
    second.open()
    await w.clock.advance(minutes(5))

    expect(tests(w)).toEqual(['unsure', 'sent'])
    expect(w.timesSentTo(0)).toBe(2)
    await run.stop()
  })

  it('of a stopped campaign are sent nothing', async () => {
    const w = world(['text'], NOON_IN_INDIA, { tests: 1 })
    w.edit((state) => {
      state.campaign.state = 'stopped'
    })
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(10))

    expect(w.sent).toHaveLength(0)
    await run.stop()
  })
})

describe('a batch waiting for the owner', () => {
  it('is announced once, sends nothing, and starts when it is released', async () => {
    const w = world()
    w.edit((state) => {
      state.batch.state = 'waiting'
    })
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(30))

    const announced = run.events.filter((event) => event.kind === 'idle' && event.waiting)
    expect(announced).toEqual([
      {
        kind: 'idle',
        campaignsOpen: true,
        waiting: { campaignId: 'rehearsal', batchNo: 1, campaignName: 'Rehearsal', recipients: 4 },
      },
    ])
    expect(w.sent).toHaveLength(0)
    expect(w.calls).not.toContain('claimNext')

    w.edit((state) => {
      state.batch.state = 'released'
    })
    await w.clock.advance(minutes(8))
    expect(w.states()).toEqual(['sent', 'sent', 'sent', 'sent'])
    await run.stop()
  })
})

describe('what a page showing the sender is drawn from', () => {
  it('is told every answer the queue gives', async () => {
    const w = world(['text'])
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(3))

    expect(run.ticks.length).toBeGreaterThan(1)
    expect(run.ticks[0]).toMatchObject({ sentToday: 0, waitingForRelease: null })
    expect(run.ticks.at(-1)).toMatchObject({ sentToday: 1, released: null })
    await run.stop()
  })

  it('asks again at once when nudged, so a released batch does not wait out an idle minute', async () => {
    const w = world(['text', 'text'])
    w.edit((state) => {
      state.batch.state = 'waiting'
    })
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    // Long enough that the gap after connecting has passed and the loop is idling.
    await w.clock.advance(minutes(10) + 5_000)
    const before = run.ticks.length

    w.edit((state) => {
      state.batch.state = 'released'
    })
    run.controls.askNow()
    await w.clock.advance(1_000)

    expect(run.ticks.length).toBe(before + 1)
    expect(w.sent).toHaveLength(1)
    await run.stop()
  })
})

describe('pause and stop', () => {
  it('sends nothing more once paused, and carries on when resumed', async () => {
    const w = world()
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.until(() => w.sent.length === 2)
    w.edit((state) => {
      state.campaign.state = 'paused'
    })
    await w.clock.advance(minutes(30))
    expect(w.sent).toHaveLength(2)

    w.edit((state) => {
      state.campaign.state = 'scheduled'
    })
    await w.clock.advance(minutes(5))
    expect(w.states()).toEqual(['sent', 'sent', 'sent', 'sent'])
    await run.stop()
  })

  it('lets at most the message already in hand go when paused mid-send', async () => {
    const w = world()
    let claims = 0
    w.hooks.after.claimNext = () => {
      claims += 1
      if (claims === 2) {
        w.edit((state) => {
          state.campaign.state = 'paused'
        })
      }
    }
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(30))

    expect(w.states()).toEqual(['sent', 'sent', 'waiting', 'waiting'])
    await run.stop()
  })

  it('is refused its next recipient when paused between the question and the claim', async () => {
    const w = world()
    w.hooks.after.tick = () => {
      // The question asked once the gap has passed: its answer says "released",
      // and the campaign is paused before the claim that follows it.
      if (w.sent.length === 1 && w.clock.now() - w.sent[0]!.at >= MIN_GAP * 1000) {
        w.edit((state) => {
          state.campaign.state = 'paused'
        })
      }
    }
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(30))

    expect(w.states()).toEqual(['sent', 'waiting', 'waiting', 'waiting'])
    expect(run.events).toContainEqual({ kind: 'held', why: 'paused' })
    await run.stop()
  })

  it('never sends again for a stopped campaign', async () => {
    const w = world()
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.until(() => w.sent.length === 1)
    w.edit((state) => {
      state.campaign.state = 'stopped'
    })
    await w.clock.advance(minutes(120))

    expect(w.states()).toEqual(['sent', 'waiting', 'waiting', 'waiting'])
    await run.stop()
  })
})

describe('resuming', () => {
  it('turns a claim left by an earlier run into unsure before claiming, and never sends to it', async () => {
    const w = world()
    w.edit((state) => {
      state.recipients[0]!.state = 'sending'
    })
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(10))

    expect(w.calls.indexOf('releaseStaleClaims')).toBeGreaterThanOrEqual(0)
    expect(w.calls.indexOf('releaseStaleClaims')).toBeLessThan(w.calls.indexOf('claimNext'))
    expect(w.states()).toEqual(['unsure', 'sent', 'sent', 'sent'])
    expect(w.timesSentTo(1)).toBe(0)
    expect(run.events).toContainEqual({ kind: 'unsure', count: 1 })
    await run.stop()
  })

  it('releases stale claims again after every reconnect, before the next claim', async () => {
    const w = world()
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.until(() => w.sent.length === 1)

    link.drop()
    await w.clock.advance(minutes(2))
    expect(w.sent).toHaveLength(1)
    const before = w.calls.length
    link.open()
    await w.until(() => w.sent.length === 2)

    const after = w.calls.slice(before)
    expect(after.indexOf('releaseStaleClaims')).toBeGreaterThanOrEqual(0)
    expect(after.indexOf('releaseStaleClaims')).toBeLessThan(after.indexOf('claimNext'))
    await run.stop()
  })

  it('carries on at the next recipient after a drop between two sends, losing nobody', async () => {
    const w = world()
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.until(() => w.sent.length === 2)
    link.drop()
    await w.clock.advance(minutes(60))
    const reopenedAt = w.clock.now()
    link.open()
    await w.clock.advance(minutes(10))

    expect(w.states()).toEqual(['sent', 'sent', 'sent', 'sent'])
    for (const position of [1, 2, 3, 4]) expect(w.timesSentTo(position)).toBe(1)
    // A reconnect is not a licence to send at once.
    expect(w.sent[2]!.at - reopenedAt).toBeGreaterThanOrEqual(MIN_GAP * 1000)
    await run.stop()
  })

  it('does not ask for anybody while WhatsApp is disconnected', async () => {
    const w = world()
    const link = w.newLink()
    const run = w.start(link)
    await w.clock.advance(minutes(30))

    expect(w.calls).not.toContain('claimNext')
    expect(run.events).toContainEqual({ kind: 'waiting_for_whatsapp' })
    await run.stop()
  })

  // The three places a process can die inside one recipient's send. The first
  // run is cut off by a call that never returns, as a killed process is, and a
  // second run starts on what the queue then holds.
  describe.each([
    ['after the claim, before anything is sent', 'unsure', 0],
    ['after the message went, before it was recorded', 'unsure', 1],
    ['after it was recorded', 'sent', 1],
  ] as const)('a crash %s', (point, stateOfSecond, messagesToSecond) => {
    it('sends nobody twice', async () => {
      const w = world()
      const isSecond = (ref: unknown) => (ref as { position: number }).position === 2
      if (point.startsWith('after the claim')) {
        w.hooks.after.claimNext = (result) => {
          const claim = result as ClaimResult
          return claim.kind === 'claimed' && isSecond(claim.recipient.ref) ? never : undefined
        }
      } else if (point.startsWith('after the message went')) {
        w.hooks.before.report = (ref) => (isSecond(ref) ? never : undefined)
      } else {
        w.hooks.after.report = (_result, ref) => (isSecond(ref) ? never : undefined)
      }

      const first = w.newLink()
      w.start(first)
      first.open()
      await w.clock.advance(minutes(10))
      expect(w.states().slice(2)).toEqual(['waiting', 'waiting'])

      // The process is gone. Whatever it was waiting on never comes back.
      w.hooks.before = {}
      w.hooks.after = {}
      const second = w.newLink()
      const run = w.start(second)
      second.open()
      await w.clock.advance(minutes(10))

      expect(w.states()).toEqual(['sent', stateOfSecond, 'sent', 'sent'])
      expect(w.timesSentTo(2)).toBe(messagesToSecond)
      for (const position of [1, 3, 4]) expect(w.timesSentTo(position)).toBe(1)
      expect(w.states().filter((state) => state === 'unsure').length).toBeLessThanOrEqual(1)
      await run.stop()
    })
  })
})

describe('when a send goes wrong', () => {
  it('records a clear refusal as failed, with its code, and moves on', async () => {
    const w = world()
    const link = w.newLink()
    link.failSend = (attempt) => (attempt === 2 ? new SendRefused('media_upload_failed') : null)
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(15))

    expect(w.states()).toEqual(['sent', 'failed', 'sent', 'sent'])
    expect(w.store.load().recipients[1]!.failureCode).toBe('media_upload_failed')
    expect(w.timesSentTo(2)).toBe(0)
    await run.stop()
  })

  it('pauses the campaign after three in a row, and says so', async () => {
    const w = world(['text', 'text', 'text', 'text', 'text'])
    const link = w.newLink()
    link.failSend = () => new SendRefused('refused_by_whatsapp')
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(60))

    expect(w.states()).toEqual(['failed', 'failed', 'failed', 'waiting', 'waiting'])
    expect(w.store.load().campaign).toMatchObject({
      state: 'paused',
      pausedBecause: 'three_in_a_row',
    })
    expect(w.calls.filter((call) => call === 'pauseCampaign')).toHaveLength(1)
    expect(run.events).toContainEqual({
      kind: 'paused_by_sender',
      campaignId: 'rehearsal',
      reason: 'three_in_a_row',
    })
    await run.stop()
  })

  it('does not pause for failures with a success between them', async () => {
    const w = world(['text', 'text', 'text', 'text', 'text'])
    const link = w.newLink()
    link.failSend = (attempt) => (attempt === 3 ? null : new SendRefused('refused_by_whatsapp'))
    const run = w.start(link)
    link.open()
    await w.until(() => w.states()[3] !== 'waiting')

    expect(w.states().slice(0, 4)).toEqual(['failed', 'failed', 'sent', 'failed'])
    expect(w.store.load().campaign.state).toBe('scheduled')
    await run.stop()
  })

  it('counts a message WhatsApp refuses after accepting it', async () => {
    const w = world(['text', 'text', 'text', 'text', 'text'])
    const link = w.newLink()
    // WhatsApp's verdict on a message arrives a moment after `send` has returned.
    link.beforeSendReturns = (id) => {
      void w.clock
        .sleep(1_000, new AbortController().signal)
        .then(() => link.receipt(id, 'rejected', '463'))
    }
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(60))

    expect(w.states()).toEqual(['failed', 'failed', 'failed', 'waiting', 'waiting'])
    expect(w.store.load().recipients[0]!.failureCode).toBe('463')
    expect(w.store.load().campaign.state).toBe('paused')
    await run.stop()
  })

  it('leaves a recipient unsure when nobody can say whether the message went, and never retries', async () => {
    const w = world()
    const link = w.newLink()
    link.failSend = (attempt) => (attempt === 2 ? new Error('socket hang up') : null)
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(15))

    expect(w.states()).toEqual(['sent', 'unsure', 'sent', 'sent'])
    expect(link.lookups.filter((phone) => phone === phoneAt(2))).toHaveLength(1)
    expect(run.events).toContainEqual({ kind: 'send_unclear', batchNo: 1, position: 2 })
    await run.stop()
  })

  it('records a failed lookup as failed, since nothing was sent', async () => {
    const w = world(['text', 'text'])
    const link = w.newLink()
    link.failLookup = (phone) => (phone === phoneAt(1) ? new Error('Timed Out') : null)
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(5))

    expect(w.states()).toEqual(['failed', 'sent'])
    expect(w.store.load().recipients[0]!.failureCode).toBe('lookup_failed')
    await run.stop()
  })
})

describe('when the database cannot be reached', () => {
  it('keeps a result it could not record and records it before anything else', async () => {
    const w = world()
    let refusals = 3
    w.hooks.before.report = () => {
      if (w.sent.length === 2 && refusals > 0) {
        refusals -= 1
        throw new Error('fetch failed')
      }
    }
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(20))

    // Sent once, recorded as sent, and never mistaken for a stale claim.
    expect(w.states()).toEqual(['sent', 'sent', 'sent', 'sent'])
    for (const position of [1, 2, 3, 4]) expect(w.timesSentTo(position)).toBe(1)
    expect(run.events.some((event) => event.kind === 'database_unreachable')).toBe(true)
    expect(run.events.some((event) => event.kind === 'unsure')).toBe(false)
    await run.stop()
  })

  it('treats a claim whose answer was lost as one it does not hold', async () => {
    const w = world()
    let lost = false
    w.hooks.after.claimNext = () => {
      if (!lost) {
        lost = true
        throw new Error('fetch failed')
      }
    }
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(15))

    expect(w.states()).toEqual(['unsure', 'sent', 'sent', 'sent'])
    expect(w.timesSentTo(1)).toBe(0)
    await run.stop()
  })

  it('sends nothing while it is down', async () => {
    const w = world()
    w.hooks.before.tick = () => {
      throw new Error('fetch failed')
    }
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(30))

    expect(w.sent).toHaveLength(0)
    expect(w.calls).not.toContain('claimNext')
    await run.stop()
  })
})

describe('a halt', () => {
  it('stops the loop for good, says so to the queue, and is not retried', async () => {
    const w = world()
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.until(() => w.sent.length === 1)

    link.halt('logged_out')
    await w.clock.advance(0)
    expect(await run.done).toEqual({ kind: 'halted', reason: 'logged_out' })

    await w.clock.advance(minutes(120))
    expect(link.holds).toBe(1)
    expect(w.sent).toHaveLength(1)
    expect(w.states()).toEqual(['sent', 'waiting', 'waiting', 'waiting'])
    expect(w.store.load().sender).toMatchObject({ status: 'halted', haltReason: 'logged_out' })
  })

  it('ends without sending when there is no link to hold', async () => {
    const w = world()
    const link = w.newLink()
    const run = w.start(link)
    link.end({ kind: 'unusable', why: 'not_linked' })
    await w.clock.advance(minutes(5))

    expect(await run.done).toEqual({ kind: 'unusable', why: 'not_linked' })
    expect(w.sent).toHaveLength(0)
  })
})

describe('what the queue says about the sender itself', () => {
  it('stops and asks to be updated when the queue speaks a newer contract', async () => {
    const w = world()
    w.hooks.after.tick = (result) => ({
      ...(result as TickResult),
      contractVersion: QUEUE_CONTRACT_VERSION + 1,
    })
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(5))

    expect(await run.done).toEqual({ kind: 'needs_update' })
    expect(w.sent).toHaveLength(0)
  })

  it('stands down while another sender is the one in use', async () => {
    const w = world()
    w.hooks.after.tick = (result) => ({ ...(result as TickResult), standDown: true })
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(30))

    expect(w.sent).toHaveLength(0)
    expect(w.calls).not.toContain('claimNext')
    expect(run.events).toContainEqual({ kind: 'stood_down' })
    await run.stop()
  })
})

describe('receipts', () => {
  const reported = (w: ReturnType<typeof world>, calls: ReceiptReport[][]) => {
    w.hooks.before.reportReceipts = (receipts) => {
      calls.push([...(receipts as ReceiptReport[])])
    }
  }

  it('reports those for campaign messages and drops every other on the laptop', async () => {
    const w = world(['text', 'text'])
    const batches: ReceiptReport[][] = []
    reported(w, batches)
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.until(() => w.sent.length === 2)

    link.receipt(w.sent[0]!.id, 'delivered')
    link.receipt('somebody-elses-message', 'read')
    link.receipt(w.sent[0]!.id, 'read')
    link.receipt('another-chat-entirely', 'delivered')
    link.receipt(w.sent[1]!.id, 'delivered')
    await w.clock.advance(minutes(6))

    const all = batches.flat()
    expect(all.map((receipt) => receipt.messageId).sort()).toEqual(
      [w.sent[0]!.id, w.sent[1]!.id].sort(),
    )
    const rows = w.store.load().recipients
    expect(rows[0]!.readAt).not.toBeNull()
    expect(rows[1]!.deliveredAt).not.toBeNull()
    expect(rows[1]!.readAt).toBeNull()
    await run.stop()
  })

  it('matches one that arrives in a later run, for a message sent in an earlier one', async () => {
    const w = world(['text'])
    const first = w.newLink()
    const firstRun = w.start(first)
    first.open()
    await w.until(() => w.sent.length === 1)
    await firstRun.stop()

    const batches: ReceiptReport[][] = []
    reported(w, batches)
    const second = w.newLink()
    // WhatsApp hands these over the moment the next connection is made.
    second.heldForNextOpen = [
      [w.sent[0]!.id, 'delivered'],
      ['not-a-campaign-message', 'read'],
    ]
    const run = w.start(second)
    second.open()
    await w.clock.advance(minutes(6))

    expect(batches.flat()).toEqual([{ messageId: w.sent[0]!.id, status: 'delivered' }])
    expect(w.store.load().recipients[0]!.deliveredAt).not.toBeNull()
    await run.stop()
  })

  it('matches one that arrives before the send has returned its id', async () => {
    const w = world(['text'])
    const batches: ReceiptReport[][] = []
    reported(w, batches)
    const link = w.newLink()
    link.beforeSendReturns = (id) => link.receipt(id, 'delivered')
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(6))

    expect(batches.flat()).toEqual([{ messageId: w.sent[0]!.id, status: 'delivered' }])
    await run.stop()
  })

  it('hands over what it holds when it is stopped', async () => {
    const w = world(['text'])
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.until(() => w.sent.length === 1)
    link.receipt(w.sent[0]!.id, 'delivered')
    await run.stop()

    expect(w.store.load().recipients[0]!.deliveredAt).not.toBeNull()
  })
})

describe('a finished campaign', () => {
  const NOTICE = {
    campaignId: 'c-done',
    campaignName: 'Diwali offer',
    phone: phoneAt(9),
    counts: { recipients: 4, sent: 3, notOnWhatsapp: 1, failed: 0, unsure: 0, stopped: 0 },
  }

  it('sends its totals to the owner who submitted it, once, when nothing else is going', async () => {
    const w = world(['text', 'text'])
    let asked = 0
    const marked: string[] = []
    w.hooks.after.finishNotices = () => {
      asked += 1
      return asked === 1 ? [NOTICE] : []
    }
    w.hooks.before.markFinishNotice = (id) => {
      marked.push(id as string)
    }
    const link = w.newLink()
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(10))

    // Not while the batch was out: once it had finished.
    expect(asked).toBe(1)
    expect(w.timesSentTo(9)).toBe(1)
    expect(w.sent.at(-1)!.text).toBe(
      'Shawarmania campaign *Diwali offer* is finished. Sent to 3 of 4. 1 not on WhatsApp.',
    )
    expect(marked).toEqual(['c-done'])
    // The customers went first.
    expect(w.states()).toEqual(['sent', 'sent'])
    expect(run.events).toContainEqual({ kind: 'finish_notice', sent: true })
    await run.stop()
  })

  it('is not marked told when the owner could not be sent it', async () => {
    const w = world(['text'], NOON_IN_INDIA, { waitForRelease: true })
    const marked: string[] = []
    w.hooks.after.finishNotices = () => [NOTICE]
    w.hooks.before.markFinishNotice = (id) => {
      marked.push(id as string)
    }
    const link = w.newLink()
    link.failSend = () => new SendRefused('refused_by_whatsapp')
    const run = w.start(link)
    link.open()
    await w.clock.advance(minutes(3))

    expect(marked).toEqual([])
    expect(run.events).toContainEqual({ kind: 'finish_notice', sent: false })
    await run.stop()
  })
})

describe('privacy', () => {
  it('says nothing that holds a number, a name or a message', async () => {
    const w = world(['text', 'absent', 'image', 'text'])
    const link = w.newLink()
    link.failSend = (attempt) => (attempt === 3 ? new Error('socket hang up') : null)
    const run = w.start(link)
    link.open()
    await w.until(() => w.sent.length === 2)
    link.receipt(w.sent[0]!.id, 'read')
    await w.clock.advance(minutes(10))
    await run.stop()

    const said = JSON.stringify(run.events)
    expect(run.events.length).toBeGreaterThan(5)
    for (const position of [1, 2, 3, 4]) expect(said).not.toContain(phoneAt(position))
    expect(said).not.toContain('1213555')
    expect(said).not.toContain('7Q2X')
    expect(said).not.toContain('s.whatsapp.net')
    expect(said).not.toContain('wamid')
  })

  it('has no way to print or to write a file', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./sending-loop.ts', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/\bconsole\.\w/)
    expect(source).not.toMatch(/from 'node:/)
    expect(source).not.toMatch(/\bprocess\.\w/)
  })
})
