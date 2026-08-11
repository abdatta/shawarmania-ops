import { useCallback, useEffect, useState } from 'react'

import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { LoadingList } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import type { ManualLedgerExpense } from '@/data-access/adapters'
import { resolveBusinessDate } from '@/domain'
import { BillingCounter } from '@/features/billing/billing-counter'
import { SyncIndicator } from '@/features/billing/counter-status'
import { ExpenseList } from '@/features/manual-ledger/expense-list'
import { getSurface, isRenderable } from '@/gates/registry'
import { useCounterDevice } from '@/session/counter-context'
import type { CounterShift } from '@/session/counter-session'

import { ShiftRequestScreen } from './shift-request-screen'

/**
 * Everything a counter tablet is, once it has a shift.
 *
 * **There is no navigation out of it, no account menu and no sign-out**, and
 * that is the shape of the whole change rather than an omission. A tablet is not
 * signed in, it is set up; the way out is an admin removing it. A sign-out
 * control would offer whoever is standing at the counter a way to strand the
 * hardware, and personal navigation would offer them somebody else's screens.
 *
 * Two panels, and only two. **Billing**, which is what the counter is for, and
 * **Expenses**, which the owner decided the tablet keeps: the drawer is at the
 * counter and the person spending is often the person billing. Every row it
 * writes is attributed to the shift's operator by the database, taken from the
 * shift row rather than from anything this screen sends.
 */
export function CounterShell({
  shift,
  onShiftChanged,
}: {
  shift: CounterShift | null
  onShiftChanged: () => void
}) {
  const device = useCounterDevice()
  const { billing, counter } = useAdapters()
  /**
   * The outgoing operator has stepped away and somebody else is taking the
   * counter.
   *
   * The shift stays live until the incoming person's request is confirmed, which
   * is exactly what the database does: confirming a request ends whatever shift
   * that tablet holds, in the same transaction. So this control opens the request
   * screen rather than ending anything — a handover that ended the shift first
   * would leave the counter attributable to nobody for however long the incoming
   * person takes to find their phone.
   *
   * It is not a way to evict somebody: anyone standing here could always ask for
   * a shift, and asking has never been what opens one.
   */
  const [handingOver, setHandingOver] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)

  const finishDay = async () => {
    if (!shift) return
    setFinishing(true)
    setFinishError(null)
    try {
      await billing.closeShift(shift.id)
      onShiftChanged()
    } catch (cause) {
      setFinishError(
        cause instanceof Error ? cause.message : 'The day could not be finished. Try again online.',
      )
    } finally {
      setFinishing(false)
    }
  }

  /**
   * Watch for a shift that ended somewhere else — at the cutover, or from the
   * operator's own phone. Both are ordinary, and neither happens on this screen.
   */
  useEffect(() => {
    if (!shift) return
    const unsubscribe = counter.subscribeToDeviceHandshake(device.device.deviceId, onShiftChanged)
    const expiry = window.setTimeout(
      onShiftChanged,
      Math.max(0, Date.parse(shift.expiresAt) - Date.now()),
    )
    return () => {
      unsubscribe()
      window.clearTimeout(expiry)
    }
  }, [shift, counter, device.device.deviceId, onShiftChanged])

  if (!shift || handingOver) {
    return (
      <ShiftRequestScreen
        onOpened={() => {
          setHandingOver(false)
          onShiftChanged()
        }}
        onGiveUp={shift ? () => setHandingOver(false) : undefined}
      />
    )
  }

  return (
    <div className="min-h-dvh bg-canvas p-4 text-content">
      <div className="mx-auto max-w-[100rem] space-y-4">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-lg font-semibold">{device.device.label}</h1>
          <div className="flex items-center gap-3">
            <SyncIndicator />
            <p className="text-sm text-content-muted">
              Open since {new Date(shift.openedAt).toLocaleTimeString()}. Ended from the operator's
              own phone, or at this outlet's cutover.
            </p>
            <button
              type="button"
              onClick={() => setHandingOver(true)}
              className={buttonVariants({ variant: 'secondary', size: 'phone' })}
            >
              Hand over
            </button>
            <button
              type="button"
              disabled={finishing}
              onClick={() => void finishDay()}
              className={buttonVariants({ variant: 'primary', size: 'phone' })}
            >
              {finishing ? 'Finishing…' : 'Finish day'}
            </button>
          </div>
        </header>

        {finishError && (
          <p role="alert" className="text-sm font-semibold text-danger">
            {finishError}
          </p>
        )}

        <BillingPanel />
        <CounterExpenses shift={shift} />
      </div>
    </div>
  )
}

/**
 * The counter itself.
 *
 * The gate remains the single switch even now it is live. This enrolled-device
 * branch is the only real context that mounts the till; personal Biller sessions
 * stay on their staff phone shell.
 */
function BillingPanel() {
  const device = useCounterDevice()
  if (isRenderable(getSurface('counter-billing').state, 'real')) {
    return (
      <div className="h-[calc(100dvh-8rem)] min-h-[36rem]">
        <BillingCounter outletId={device.device.outletId} />
      </div>
    )
  }
  return (
    <Card>
      <CardTitle>Billing</CardTitle>
      <CardBody>
        Taking money is not switched on yet. The counter opens here once billing goes live; until
        then this tablet records expenses and nothing else.
      </CardBody>
    </Card>
  )
}

/**
 * What went out of the drawer, recorded from the counter.
 *
 * The viewer is the **shift's operator**, not the tablet: the database stamps
 * `recorded_by` from the shift row, so "your own rows" on a tablet means the
 * rows the person currently standing at it recorded. `mayTouchAnyRow` is false
 * for the same reason it is false for staff — the guard narrows a counter's
 * reach to its own rows on the running day, and offering a button the database
 * will refuse is worse than not offering it.
 */
function CounterExpenses({ shift }: { shift: CounterShift }) {
  const { manualLedger, outlets } = useAdapters()
  const [expenses, setExpenses] = useState<ManualLedgerExpense[] | null>(null)
  const [businessDate, setBusinessDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (date: string) => {
      setExpenses(await manualLedger.listRecentExpenses(shift.outletId, [date]))
    },
    [manualLedger, shift.outletId],
  )

  useEffect(() => {
    let active = true
    void outlets
      .getOutlet(shift.outletId)
      .then(async (outlet) => {
        if (!active || !outlet) return
        // The outlet's own cutover, never the device clock: the shift's stored
        // business date and this have to agree, because the database refuses an
        // expense dated anything else from a tablet.
        const today = resolveBusinessDate(new Date(), outlet.business_day_cutover)
        if (!active) return
        setBusinessDate(today)
        await load(today)
      })
      .catch(() => {
        if (active) setError('Could not load expenses. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [outlets, shift.outletId, load])

  if (error) {
    return (
      <p role="alert" className="text-sm font-semibold text-danger">
        {error}
      </p>
    )
  }

  if (businessDate === null) return <LoadingList label="expenses" rows={2} />

  return (
    <ExpenseList
      expenses={expenses}
      outletId={shift.outletId}
      businessDate={businessDate}
      currentBusinessDate={businessDate}
      viewer={{ id: shift.personId, mayTouchAnyRow: false }}
      heading="Expenses"
      emptyTitle="Nothing has gone out of the drawer today."
      onChanged={() => load(businessDate)}
    />
  )
}
