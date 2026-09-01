import type { NewExpense } from '@/data-access/adapters'

import { BillingDeliveryDatabase, type CounterExpenseEnvelopeRecord } from './schema'

/**
 * A queued counter expense, normalised.
 *
 * `pending` is waiting for a send that has not succeeded yet. `needs_attention`
 * is a send the server *answered*, refusing it — a broken category, a
 * constraint, a policy that no longer admits this tablet for that date. The
 * distinction is the whole point of this module: a refusal retried on a loop is
 * indistinguishable from an outage, and it would keep Finish Day blocked
 * forever while saying only that something was "still sending".
 */
export type CounterExpenseState = 'pending' | 'needs_attention'

export interface QueuedCounterExpense {
  id: string
  tabletId: string
  shiftId: string
  createdAtMs: number
  state: CounterExpenseState
  attemptCount: number
  /** The server's own words for a refusal, kept for the operator to read. */
  lastRefusal: string | null
  input: NewExpense
}

/**
 * PostgREST codes that mean *this row*, not *this moment*. Retrying any of them
 * produces the identical refusal, so the envelope stops rather than spinning.
 * Anything not listed — a network failure, a 5xx, an unrecognised code — is
 * treated as transient and keeps its place in the queue.
 */
const PERMANENT_REFUSAL_CODES = new Set([
  '22P02', // invalid text representation
  '23502', // not null violation
  '23503', // foreign key violation
  '23514', // check constraint
  '42501', // insufficient privilege — RLS refused this insert
  'P0001', // raise exception from a trigger or guard
])

/** The server already holds this exact row: the identity replayed, not a clash. */
const ALREADY_LANDED = '23505'

export interface ExpenseInsertRefusal {
  code?: string
  message?: string
}

export type ExpenseInsertOutcome = { error: ExpenseInsertRefusal | null }

function normalise(row: CounterExpenseEnvelopeRecord): QueuedCounterExpense {
  // A compatibility reader, in the manner of the envelope upgraders: rows
  // written before this module gained a state are pending and untried. Nothing
  // sweeps or rewrites them, so no delivery evidence is touched to read one.
  return {
    id: row.id,
    tabletId: row.tabletId,
    shiftId: row.shiftId,
    createdAtMs: row.createdAtMs,
    state: row.state === 'needs_attention' ? 'needs_attention' : 'pending',
    attemptCount: row.attemptCount ?? 0,
    lastRefusal: row.lastRefusal ?? null,
    input: row.input,
  }
}

export async function listCounterExpenses(
  database: BillingDeliveryDatabase,
  tabletId: string,
): Promise<QueuedCounterExpense[]> {
  const rows = await database.expenseEnvelopes.where('tabletId').equals(tabletId).toArray()
  return rows.map(normalise).sort((left, right) => right.createdAtMs - left.createdAtMs)
}

export async function enqueueCounterExpense(
  database: BillingDeliveryDatabase,
  entry: { id: string; tabletId: string; shiftId: string; createdAtMs: number; input: NewExpense },
): Promise<void> {
  await database.expenseEnvelopes.add({
    ...entry,
    state: 'pending',
    attemptCount: 0,
    lastRefusal: null,
    input: structuredClone(entry.input),
  })
}

/** Discard a refused expense. Only `needs_attention` may be discarded. */
export async function discardCounterExpense(
  database: BillingDeliveryDatabase,
  id: string,
): Promise<void> {
  await database.transaction('rw', database.expenseEnvelopes, async () => {
    const row = await database.expenseEnvelopes.get(id)
    if (!row || normalise(row).state !== 'needs_attention') return
    await database.expenseEnvelopes.delete(id)
  })
}

/**
 * Send every pending expense, oldest first.
 *
 * Ordering is preserved on a transient failure: the drain stops rather than
 * skipping ahead, so the queue reaches the server in the order the counter
 * made it. A permanent refusal does not stop the drain — it is parked as
 * `needs_attention` and the queue moves on, because one bad category must not
 * strand every expense behind it.
 *
 * The insert carries the envelope's own id, so a lost response replays into
 * `23505` and resolves as delivered rather than as a second expense.
 */
export async function drainCounterExpenses(
  database: BillingDeliveryDatabase,
  tabletId: string,
  insert: (entry: QueuedCounterExpense) => Promise<ExpenseInsertOutcome>,
): Promise<number> {
  const queued = (await listCounterExpenses(database, tabletId))
    .filter((row) => row.state === 'pending')
    .sort((left, right) => left.createdAtMs - right.createdAtMs)

  let delivered = 0
  for (const entry of queued) {
    let outcome: ExpenseInsertOutcome
    try {
      outcome = await insert(entry)
    } catch {
      await database.expenseEnvelopes.update(entry.id, {
        attemptCount: entry.attemptCount + 1,
      })
      return delivered
    }

    const code = outcome.error?.code
    if (!outcome.error || code === ALREADY_LANDED) {
      await database.expenseEnvelopes.delete(entry.id)
      delivered += 1
      continue
    }

    if (code && PERMANENT_REFUSAL_CODES.has(code)) {
      await database.expenseEnvelopes.update(entry.id, {
        state: 'needs_attention',
        attemptCount: entry.attemptCount + 1,
        lastRefusal: outcome.error.message ?? 'The server refused this expense.',
      })
      continue
    }

    await database.expenseEnvelopes.update(entry.id, { attemptCount: entry.attemptCount + 1 })
    return delivered
  }
  return delivered
}
