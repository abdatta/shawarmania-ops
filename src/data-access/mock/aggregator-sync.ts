import type {
  AggregatorSyncAdapter,
  AggregatorSyncEventRow,
  AggregatorSyncHealth,
  HyperpureHealth,
} from '../adapters'
import type { Role } from '@/session/session'
import type { DemoStore } from './store'

/**
 * The Zomato sync, mocked well enough to be argued with.
 *
 * This adapter exists so the owner can walk the whole experience — start a run,
 * watch a figure move, lose the session, repair it, resolve a week that will not
 * add up — before any of it touches a live merchant credential. That order is
 * the repo's delivery model (`docs/DEMO_MODE.md`), and it matters more here than
 * usual for a reason particular to this surface: **the states worth designing for
 * are the ones the live account will not produce on cue.** A disputed week
 * happened once in eight cycles. Waiting for a real one in order to find out
 * whether the screen makes sense would mean shipping the screen first.
 *
 * What is faked and what is not:
 *
 *  - **Faked**: the reader, the network, the GitHub run, Zomato itself, and the
 *    one-time password, which is accepted whatever is typed.
 *  - **Not faked**: the shapes. Every figure here is integer paise, every event
 *    is one the real write contract can produce, and the state machine is the
 *    one the database enforces — `provisional → settled`, `provisional →
 *    disputed`, `disputed → settled`, and settled is final. A demo that could
 *    reach a state the database refuses would be teaching the wrong screen.
 *
 * Timings are short but not instant. A run that resolved immediately would hide
 * the question the surface has to answer — what the owner looks at while it is
 * working — which is the same reason `requestRun` resolves on *asking* rather
 * than on finishing.
 */

/** Long enough to see, short enough to sit through. */
const RUN_MILLISECONDS = 2_400
const OTP_VALID_MILLISECONDS = 5 * 60 * 1000

let nextEventId = 0

function eventId(): string {
  nextEventId += 1
  return `sync-event-${nextEventId}`
}

interface OutletSyncState {
  health: AggregatorSyncHealth
  events: AggregatorSyncEventRow[]
  /** Set while a repair is under way, so the code field knows what to expect. */
  pendingLogin: boolean
}

/**
 * The demo's starting position, chosen so that every state the surface can show
 * is on screen at once rather than reachable only by a sequence of taps.
 *
 * One outlet is healthy and has a revised day to explain; the other has lost its
 * session and carries a week that will not reconcile. Between them they cover
 * the six event kinds, both failure classes a person can act on, and the two
 * decisions the surface offers.
 */
function seedFor(
  outletId: string,
  healthy: boolean,
  at: (minutesAgo: number) => string,
  day: (daysAgo: number) => string,
) {
  const events: AggregatorSyncEventRow[] = []
  const push = (minutesAgo: number, event: AggregatorSyncEventRow['event']) => {
    events.push({ id: eventId(), outletId, at: at(minutesAgo), event, resolvedAt: null })
  }

  if (healthy) {
    push(40, { kind: 'days-written', days: 7, from: day(7), to: day(1) })
    push(38, { kind: 'week-settled', from: day(14), to: day(8), netPaise: 1_516_759 })
    // The cancellation-refund case: a day that legitimately grew after its week
    // paid. The one movement the owner is most likely to read as a bug.
    push(38, {
      kind: 'day-revised',
      businessDate: day(12),
      fromNetPaise: 210_000,
      toNetPaise: 217_915,
    })
    // Deliberately not an exact match, because a real one rarely is. The owner
    // typed a round number off the delivery slip on the day they noticed it;
    // Zomato reports the invoice to the paisa, dated to the purchase. A fixture
    // where both sides agreed would demonstrate a case that does not happen and
    // hide the one that does.
    push(36, {
      kind: 'possible-duplicate-expense',
      typed: {
        businessDate: day(15),
        amountPaise: 375_000,
        note: 'Hyperpure, paid online',
        expenseId: 'demo-expense-typed-hyperpure',
      },
      synced: {
        businessDate: day(16),
        amountPaise: 374_777,
        note: 'Hyperpure invoice HP-88213',
        expenseId: 'demo-expense-synced-hyperpure',
      },
    })
  } else {
    push(20, {
      kind: 'week-disputed',
      from: day(28),
      to: day(22),
      computedPaise: 1_508_844,
      statedPayoutPaise: 1_516_759,
      differencePaise: -7_915,
    })
    push(15, {
      kind: 'session-lapsed',
      detail: 'Zomato signed this account out. It needs a one time password to get back in.',
    })
  }

  return events
}

export function createMockAggregatorSyncAdapter(
  store: DemoStore,
  role: Role,
  outletIds: readonly string[],
): AggregatorSyncAdapter {
  const now = () => new Date()
  const day = (daysAgo: number) => store.businessDate(daysAgo)
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()

  const states = new Map<string, OutletSyncState>()

  // Hyperpure is account-level, and the demo starts it with a lapsed session — the
  // state the owner is actually in until the first reconnect captures it. It shows
  // the reconnect this line now carries; the repair ladder heals it, silently when
  // the parent is warm and alongside the code flow when it is not (Model A).
  const hyperpure: HyperpureHealth = {
    lastRunAt: at(3 * 60),
    lastOutcome: 'session_lapsed',
    running: false,
    hasSession: false,
    sessionExpiresAt: null,
  }

  /** The capture landed or the login completed: the child rides the parent back to quiet. */
  function healHyperpure(): void {
    hyperpure.running = false
    hyperpure.hasSession = true
    hyperpure.lastOutcome = 'ok'
    hyperpure.lastRunAt = new Date().toISOString()
    hyperpure.sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  }

  for (const [index, outletId] of outletIds.entries()) {
    const healthy = index === 0
    states.set(outletId, {
      health: {
        outletId,
        lastRunAt: at(healthy ? 36 : 15),
        lastOutcome: healthy ? 'ok' : 'session_lapsed',
        running: false,
        awaitingOneTimePassword: null,
        syncedFrom: day(16),
      },
      events: seedFor(outletId, healthy, at, day),
      pendingLogin: false,
    })
  }

  /**
   * The owner is the only reader.
   *
   * Mirrors the policies exactly: these tables carry settlement money and the
   * decisions taken about it, and no outlet role reaches them at any outlet
   * including their own. The mock refuses rather than returning an empty list,
   * because an empty list is what a healthy sync with nothing to report also
   * looks like, and the two must not be confusable while the screen is being
   * designed.
   */
  function refuse(): void {
    if (role !== 'super_admin') {
      throw new Error('Only the owner reads the aggregator sync.')
    }
  }

  function stateFor(outletId: string): OutletSyncState {
    refuse()
    const state = states.get(outletId)
    if (!state) throw new Error(`No aggregator sync state for outlet ${outletId}.`)
    return state
  }

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  return {
    async getHealth(outletId) {
      return { ...stateFor(outletId).health }
    },

    async getHyperpureHealth() {
      refuse()
      return { ...hyperpure }
    },

    async listEvents(outletId) {
      // Newest first: the thing that just happened is the thing being looked for.
      return [...stateFor(outletId).events].sort((a, b) => b.at.localeCompare(a.at))
    },

    async markNotDuplicate(outletId, eventId) {
      const state = stateFor(outletId)
      const row = state.events.find((candidate) => candidate.id === eventId)
      if (!row || row.event.kind !== 'possible-duplicate-expense') {
        throw new Error('No possible duplicate to settle here.')
      }

      state.events = state.events.map((candidate) =>
        candidate.id === eventId
          ? { ...candidate, resolvedAt: now().toISOString(), resolution: 'not-a-duplicate' }
          : candidate,
      )
    },

    async countNeedsOwner() {
      refuse()
      return [...states.entries()].map(([outletId, state]) => ({
        outletId,
        // The same rule the surface groups by. A count of something other than
        // what the page lists is worse than no count: it sends somebody looking
        // for work that is not there, or hides work that is.
        needing: state.events.filter(
          (row) =>
            row.resolvedAt === null &&
            (row.event.kind === 'week-disputed' ||
              row.event.kind === 'session-lapsed' ||
              row.event.kind === 'possible-duplicate-expense'),
        ).length,
      }))
    },

    async requestRun(outletId) {
      const state = stateFor(outletId)
      if (state.health.running) return

      state.health = { ...state.health, running: true }

      // Deliberately not awaited: the call resolves on asking, and the surface
      // follows the health from there. Awaiting it here would reintroduce the
      // exact confusion the split exists to prevent.
      void wait(RUN_MILLISECONDS).then(() => {
        const lapsed = state.health.lastOutcome === 'session_lapsed'
        if (lapsed) {
          // A run that cannot sign in writes nothing and says so. It never
          // writes a zero, because a zero and "no orders" are the same figure.
          state.health = { ...state.health, running: false, lastRunAt: now().toISOString() }
          return
        }

        state.health = {
          ...state.health,
          running: false,
          lastRunAt: now().toISOString(),
          lastOutcome: 'ok',
        }
        state.events.push({
          id: eventId(),
          outletId,
          at: now().toISOString(),
          resolvedAt: null,
          event: { kind: 'days-written', days: 2, from: day(1), to: day(0) },
        })
      })
    },

    async answerOneTimePassword(outletId, code) {
      const state = stateFor(outletId)
      if (!state.health.awaitingOneTimePassword) {
        throw new Error('Nothing is waiting for a code at this outlet.')
      }
      // Any code is accepted here. Checking one would mean faking Zomato's own
      // answer, which teaches nothing about the screen and would have to be
      // thrown away when the real login lands.
      if (code.trim() === '') throw new Error('Enter the code Zomato sent you.')

      state.health = { ...state.health, awaitingOneTimePassword: null, running: true }
      state.pendingLogin = false

      // The session is back, so the row that asked for it stops asking. Kept on
      // the page rather than removed: "Zomato signed us out on Tuesday" is worth
      // being able to find later, and it is the same record either way.
      state.events = state.events.map((row) =>
        row.event.kind === 'session-lapsed' && row.resolvedAt === null
          ? { ...row, resolvedAt: now().toISOString() }
          : row,
      )

      void wait(RUN_MILLISECONDS).then(() => {
        state.health = {
          ...state.health,
          running: false,
          lastRunAt: now().toISOString(),
          lastOutcome: 'ok',
        }
        state.events.push({
          id: eventId(),
          outletId,
          at: now().toISOString(),
          resolvedAt: null,
          event: { kind: 'days-written', days: 7, from: day(7), to: day(1) },
        })
        // Model A: one sign-in restores both channels, so the child heals with
        // the parent instead of staying lapsed behind a healthy Zomato.
        healHyperpure()
      })
    },

    async requestReconnect(outletId, channel = 'zomato') {
      const state = stateFor(outletId)

      if (channel === 'hyperpure') {
        // The ladder, as the demo can walk it. The Hyperpure line starts
        // lapsed, so its Reconnect exercises whichever rung this outlet's
        // parent earns: a warm Zomato dispatches the silent capture-only
        // repair; a cold one needs the full login and its code — after which
        // both channels come back together.
        if (hyperpure.hasSession && hyperpure.lastOutcome === 'ok') {
          return { outcome: 'still_signed_in' }
        }

        const parentCold = state.health.lastOutcome === 'session_lapsed'
        hyperpure.running = true
        if (!parentCold) {
          void wait(RUN_MILLISECONDS).then(() => {
            healHyperpure()
          })
          return { outcome: 'dispatched' }
        }

        // Full-login rung: the code card appears (the runner opened the mailbox
        // when the login asked for it), and answering it heals both channels.
        state.pendingLogin = true
        state.health = { ...state.health, running: true }
        void wait(1_200).then(() => {
          state.health = {
            ...state.health,
            running: false,
            awaitingOneTimePassword: {
              requestedAt: now().toISOString(),
              expiresAt: new Date(Date.now() + OTP_VALID_MILLISECONDS).toISOString(),
            },
          }
        })
        return { outcome: 'dispatched' }
      }

      // The Zomato line's own reconnect keeps its shape: a lapsed session runs
      // the full login and asks for a code; a healthy one has nothing to
      // repair, and the ladder says so instead of dispatching a runner.
      if (state.health.lastOutcome !== 'session_lapsed' || state.health.awaitingOneTimePassword) {
        return { outcome: 'still_signed_in' }
      }
      state.pendingLogin = true
      state.health = { ...state.health, running: true }
      void wait(1_200).then(() => {
        state.health = {
          ...state.health,
          running: false,
          awaitingOneTimePassword: {
            requestedAt: now().toISOString(),
            expiresAt: new Date(Date.now() + OTP_VALID_MILLISECONDS).toISOString(),
          },
        }
      })
      return { outcome: 'dispatched' }
    },

    async recheckWeek(outletId, from, to) {
      const state = stateFor(outletId)
      state.health = { ...state.health, running: true }

      void wait(RUN_MILLISECONDS).then(() => {
        state.health = {
          ...state.health,
          running: false,
          lastRunAt: now().toISOString(),
          lastOutcome: 'ok',
        }
        // The optimistic case, and the common one: Zomato's own figures move
        // after a payout, so most disputes clear without anybody deciding
        // anything. The disputed row is replaced rather than joined, because a
        // resolved week that stayed on the list would read as still open.
        state.events = state.events.map((row) =>
          row.event.kind === 'week-disputed' && row.event.from === from
            ? { ...row, resolvedAt: now().toISOString() }
            : row,
        )
        state.events.push({
          id: eventId(),
          outletId,
          at: now().toISOString(),
          resolvedAt: null,
          event: { kind: 'week-settled', from, to, netPaise: 1_516_759 },
        })
      })
    },

    async acceptDifference(outletId, from, to) {
      const state = stateFor(outletId)
      const disputed = state.events.find(
        (row) => row.event.kind === 'week-disputed' && row.event.from === from,
      )
      const difference =
        disputed?.event.kind === 'week-disputed' ? disputed.event.differencePaise : 0

      state.events = state.events.map((row) =>
        row.event.kind === 'week-disputed' && row.event.from === from
          ? { ...row, resolvedAt: now().toISOString() }
          : row,
      )
      state.events.push({
        id: eventId(),
        outletId,
        at: now().toISOString(),
        resolvedAt: null,
        event: { kind: 'week-settled', from, to, netPaise: 1_516_759 + difference },
      })
      state.health = { ...state.health, lastOutcome: 'ok' }
    },

    async uploadStatement(file) {
      refuse()
      // The demo does not parse a real file — there is nothing behind it to write
      // to — so it recognises the shape from the filename it was handed and
      // answers as the real path would, which is what the surface is built
      // against. A file it cannot place is refused with the same message.
      const name = file.filename.toLowerCase()
      const kind = name.includes('order_history')
        ? ('zomato-order-history' as const)
        : name.includes('soa') || name.includes('hyperpure')
          ? ('hyperpure-statement' as const)
          : name.includes('settlement')
            ? ('zomato-settlement' as const)
            : null
      if (!kind) {
        throw new Error(
          'This file matches no known statement shape. Upload a Zomato order history, a Zomato settlement, or a Hyperpure statement.',
        )
      }
      return {
        kind,
        wrote:
          kind === 'hyperpure-statement'
            ? ['Kanchrapara · supply costs updated from the statement']
            : ['Kalyani · figures updated', 'Kanchrapara · figures updated'],
      }
    },
  }
}
