import { billTotals, classifySync, lineTotalPaise, UNDO_WINDOW_MS } from '@/domain'

import {
  BillingActionError,
  type BillDraft,
  type BillingAdapter,
  type CounterBiller,
  type CounterShift,
  type CounterState,
  type QueuedBill,
} from '../adapters'
import type { Tables } from '../database.types'
import { liveAssignments } from '../adapters'
import { accountFixtures, assignmentFixtures } from './fixtures/accounts'

/**
 * Can this person hold a shift at this counter? A live `biller` assignment at
 * this outlet, which since multi-outlet-people is the question the database
 * asks too — `app_profile_has(biller_profile_id, 'biller', outlet_id)`.
 */
function billsAt(personId: string, outletId: string): boolean {
  return liveAssignments(assignmentFixtures[personId] ?? []).some(
    (assignment) => assignment.role === 'biller' && assignment.outletId === outletId,
  )
}
import { DEMO_BILLER_PIN, DEMO_COUNTER_DEVICE_ID } from './fixtures/billing'
import type { DemoStore } from './store'

/**
 * The mock counter: an in-memory queue that behaves the way the real one is
 * specified to, and is honest about being none of its durability.
 *
 * **This is not the outbox.** `src/outbox/` stays deliberately empty until
 * `counter-devices-and-offline` (#9), which brings IndexedDB, retry and real
 * exactly-once delivery. What this reproduces is the queue's *observable
 * states* — a bill waiting, a count climbing, an indicator escalating, a number
 * appearing only once the bill has landed — so the offline experience can be
 * reviewed before the machinery behind it exists.
 *
 * Four clauses of `openspec/specs/counter-billing/spec.md` are mirrored here on
 * purpose, each beside the sentence it comes from:
 *
 *  - a bill's identity is its **client-generated UUID**, and the same id twice
 *    stores one bill;
 *  - **bill numbers are assigned on send**, per outlet, sequentially — never by
 *    the client and never on enqueue;
 *  - a **cancelled** bill consumes no number, so the sequence has no gap;
 *  - a settled bill is **append-only**, which is why there is no update method
 *    anywhere below.
 *
 * Connectivity is the browser's own: online it drains, offline it accumulates.
 * A demo-only "pretend to be offline" control would be UI that ships and then
 * has to be removed, and it would reach the escalated state a different way from
 * the way a real tablet reaches it.
 */

/** How long a bill takes to "reach the server" once its undo window has closed. */
const SEND_LATENCY_MS = 400

/** How often the state is re-emitted while anything waits, for the age-based escalation. */
const TICK_MS = 1000

function nameOf(profileId: string): string {
  return accountFixtures.find((account) => account.id === profileId)?.full_name ?? 'Unknown biller'
}

function toShift(row: Tables<'shifts'>): CounterShift {
  return {
    id: row.id,
    outletId: row.outlet_id,
    billerProfileId: row.biller_profile_id,
    billerName: nameOf(row.biller_profile_id),
    businessDate: row.business_date,
    openedAt: row.opened_at,
  }
}

/**
 * What the queue holds: the bill as the counter made it, and what the screen
 * needs to say about it. The draft rides along because **an unsent bill is not
 * in the database** — it exists only here until it lands, which is why
 * cancelling one has nothing to clean up and burns no number.
 */
interface QueueEntry {
  queued: QueuedBill
  draft: BillDraft
}

export function createMockBillingAdapter(store: DemoStore): BillingAdapter {
  const listeners = new Set<() => void>()
  /** Queue entries by client id — the mock's stand-in for the outbox's key. */
  const queue = new Map<string, QueueEntry>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let tick: ReturnType<typeof setInterval> | null = null

  // Rebuilt only when something actually changes, so `useSyncExternalStore`
  // sees a stable snapshot and does not loop.
  let snapshot: CounterState = buildSnapshot()

  function openShiftRow(): Tables<'shifts'> | undefined {
    return store.shifts.find((row) => row.closed_at === null)
  }

  function buildSnapshot(): CounterState {
    // The queue holds what has **not** gone. A delivered bill leaves it, because
    // by then it is a row in `bills` and an outbox that never empties is not an
    // outbox — it is a log with a misleading name.
    const queued = [...queue.values()]
      .map((entry) => entry.queued)
      .sort((a, b) => a.queuedAt - b.queuedAt)
    const row = openShiftRow()

    return {
      shift: row ? toShift(row) : null,
      queued,
      sync: {
        pending: queued.length,
        kind: classifySync({
          pending: queued.length,
          oldestQueuedAt: queued[0]?.queuedAt ?? null,
          now: Date.now(),
        }),
      },
    }
  }

  function emit() {
    snapshot = buildSnapshot()
    for (const listener of listeners) listener()
  }

  /**
   * Keep re-emitting while bills wait, so the indicator can escalate on age as
   * well as on count — a single bill stuck for two minutes is the case a
   * count-only rule would never notice.
   *
   * Only while something is actually watching. An interval that outlived the
   * screen it feeds would tick for the life of the tab, holding the whole queue
   * alive behind it.
   */
  function syncTicker() {
    const waiting = queue.size > 0 && listeners.size > 0
    if (waiting && tick === null) {
      tick = setInterval(emit, TICK_MS)
    } else if (!waiting && tick !== null) {
      clearInterval(tick)
      tick = null
    }
  }

  /**
   * Connectivity is watched only while somebody is subscribed, and the handlers
   * come off again when the last of them leaves. A demo session that is
   * navigated away from must not leave listeners on `window` — four role
   * switches would otherwise accumulate eight.
   */
  const onOnline = () => {
    drain()
    emit()
  }
  const onOffline = () => {
    // Whatever had not gone stops trying. The counter carries on regardless;
    // that is the entire point of the queue.
    for (const [clientId, timer] of timers) {
      clearTimeout(timer)
      timers.delete(clientId)
    }
    emit()
    syncTicker()
  }

  function watchConnectivity(on: boolean) {
    if (typeof window === 'undefined') return
    if (on) {
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
    } else {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }

  function isOnline(): boolean {
    // `navigator.onLine` reports link state rather than reachability, which is
    // a weak signal — and exactly the right strength for a mock whose only job
    // is to reach three visual states the way a real tablet reaches them.
    return typeof navigator === 'undefined' || navigator.onLine !== false
  }

  /**
   * Deliver one queued bill: insert it, number it as the server would, and
   * snapshot its lines.
   *
   * This is the only place a bill row is created, and the only place a number is
   * spent — so a bill cancelled inside the undo window never existed and left no
   * gap in the outlet's sequence.
   */
  function send(clientId: string) {
    // Cleared in every path, including the ones that give up: a timer entry left
    // behind would make `drain` skip this bill for ever, because it would look
    // like one that is already on its way.
    timers.delete(clientId)

    const entry = queue.get(clientId)
    if (!entry || !isOnline()) return

    const { draft } = entry
    // Always present: `settleBill` refuses a draft whose shift is not open, and
    // a closed shift stays on the store rather than being removed — a bill that
    // outlived its shift still has to be attributed to whoever rang it.
    const shift = store.shifts.find((row) => row.id === draft.shiftId)
    if (!shift) throw new Error(`Queued bill ${draft.clientId} has no shift to attribute to.`)

    const totals = billTotals(
      draft.lines.map((line) => ({
        unitPricePaise: line.unitPricePaise,
        quantity: line.quantity,
      })),
    )

    const next = (store.billNumbers.get(draft.outletId) ?? 0) + 1
    store.billNumbers.set(draft.outletId, next)

    store.bills.push({
      id: draft.clientId,
      outlet_id: draft.outletId,
      bill_number: next,
      biller_profile_id: shift.biller_profile_id,
      counter_device_id: shift.counter_device_id,
      shift_id: draft.shiftId,
      counter_shift_id: null,
      order_id: null,
      business_date: draft.businessDate,
      created_at: new Date(entry.queued.queuedAt).toISOString(),
      ordered_at: new Date(entry.queued.queuedAt).toISOString(),
      paid_at: new Date(entry.queued.queuedAt).toISOString(),
      payment_business_date: draft.businessDate,
      synced_at: new Date().toISOString(),
      customer_id: null,
      customer_name: draft.customerName?.trim() || null,
      customer_phone: draft.customerPhone?.trim() || null,
      payment_method: draft.paymentMethod,
      pricing_mode: 'no_tax',
      status: 'settled',
      subtotal_paise: totals.subtotalPaise,
      discount_paise: totals.discountPaise,
      tax_paise: totals.taxPaise,
      total_paise: totals.totalPaise,
      void_reason: null,
      voided_at: null,
      voided_by: null,
    })

    for (const [index, line] of draft.lines.entries()) {
      store.billItems.push({
        id: `${draft.clientId}-${index}`,
        bill_id: draft.clientId,
        menu_item_id: line.menuItemId,
        // The snapshot the counter took when the line was created, carried
        // through untouched — never re-read from the live menu.
        item_name: line.itemName,
        unit_price_paise: line.unitPricePaise,
        quantity: line.quantity,
        line_total_paise: lineTotalPaise(line.unitPricePaise, line.quantity),
      })
    }

    queue.delete(clientId)
    emit()
    syncTicker()
  }

  /** Try to send everything still waiting — what reconnecting does. */
  function drain() {
    if (!isOnline()) return
    for (const [clientId, entry] of queue) {
      if (timers.has(clientId)) continue
      const elapsed = Date.now() - entry.queued.queuedAt
      const remaining = Math.max(0, UNDO_WINDOW_MS - elapsed)
      timers.set(
        clientId,
        setTimeout(() => send(clientId), remaining + SEND_LATENCY_MS),
      )
    }
  }

  return {
    getCounterState() {
      return snapshot
    },

    subscribeCounter(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) watchConnectivity(true)
      syncTicker()

      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          watchConnectivity(false)
          syncTicker()
        }
      }
    },

    async listBillers(outletId: string): Promise<CounterBiller[]> {
      return accountFixtures
        .filter((account) => account.is_active && billsAt(account.id, outletId))
        .map((account) => ({ profileId: account.id, fullName: account.full_name }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
    },

    async openShift({ outletId, billerProfileId, pin }) {
      const biller = accountFixtures.find(
        (account) =>
          account.id === billerProfileId && account.is_active && billsAt(account.id, outletId),
      )

      // One refusal for both failures, deliberately. Telling a wrong PIN apart
      // from an unknown biller would confirm which names are real, on a device
      // that lives on a counter anyone can reach across.
      if (!biller || pin !== DEMO_BILLER_PIN) {
        throw new BillingActionError('unlock_failed', 'That did not unlock. Check the PIN.')
      }

      if (openShiftRow()) {
        throw new BillingActionError(
          'shift_open',
          'A shift is already open. Close it before opening another.',
        )
      }

      const row: Tables<'shifts'> = {
        id: `d6000000-0000-4000-b000-${String(store.shifts.length + 1).padStart(12, '0')}`,
        outlet_id: outletId,
        biller_profile_id: billerProfileId,
        counter_device_id: DEMO_COUNTER_DEVICE_ID,
        business_date: store.today,
        opened_at: new Date().toISOString(),
        closed_at: null,
      }
      store.shifts.push(row)
      emit()
      return toShift(row)
    },

    async closeShift(shiftId: string) {
      const row = store.shifts.find((candidate) => candidate.id === shiftId)
      if (!row || row.closed_at !== null) {
        throw new BillingActionError('no_shift', 'That shift is not open.')
      }
      row.closed_at = new Date().toISOString()
      emit()
    },

    async settleBill(draft: BillDraft) {
      const shift = store.shifts.find((row) => row.id === draft.shiftId && row.closed_at === null)
      if (!shift) {
        throw new BillingActionError(
          'no_shift',
          'No shift is open, so there is nobody to attribute this bill to.',
        )
      }
      if (draft.lines.length === 0) {
        throw new BillingActionError('empty_bill', 'There is nothing on this bill.')
      }

      // Idempotent by client identity: the same id twice stores one bill, and
      // the second attempt is reported as a duplicate rather than creating a
      // second row (spec: counter writes are idempotent by client identity).
      if (queue.has(draft.clientId) || store.bills.some((row) => row.id === draft.clientId)) {
        throw new BillingActionError('duplicate', 'That bill has already been recorded.')
      }

      const totals = billTotals(
        draft.lines.map((line) => ({
          unitPricePaise: line.unitPricePaise,
          quantity: line.quantity,
        })),
      )

      queue.set(draft.clientId, {
        draft: structuredClone(draft),
        queued: {
          clientId: draft.clientId,
          totalPaise: totals.totalPaise,
          businessDate: draft.businessDate,
          queuedAt: Date.now(),
        },
      })

      drain()
      emit()
      syncTicker()
    },

    async cancelQueuedBill(clientId: string) {
      const entry = queue.get(clientId)
      if (!entry) {
        // Either it has already gone, or it never existed. Both come to the same
        // thing from here: past delivery the only correction is a void, which
        // is #10's — a settled bill is append-only and this adapter offers no
        // way to change one.
        throw new BillingActionError(
          'not_queued',
          'That bill has already gone, so there is nothing left to undo. It can only be voided now.',
        )
      }
      const timer = timers.get(clientId)
      if (timer) clearTimeout(timer)
      timers.delete(clientId)
      // Nothing else to undo: the bill was never inserted, so no number was
      // spent and no correcting row is needed.
      queue.delete(clientId)

      emit()
      syncTicker()
    },
  }
}
