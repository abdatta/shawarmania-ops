import { Delete, KeyRound, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import { DataActionError, type CounterBiller } from '@/data-access/adapters'
import { formatTime } from '@/domain'
import { useSession } from '@/session/context'

import { useCounterState } from './use-counter-state'

/**
 * Shift unlock and handover.
 *
 * The counter tablet is shared, so the question this screen answers is *whose
 * bills are these?* — attribution, not access. The device's own enrolled session
 * is the security boundary and arrives with `counter-devices-and-offline` (#9);
 * a PIN selects a person.
 *
 * That is why the refusal is a single sentence for both a wrong PIN and an
 * unknown biller. This tablet sits on a counter anybody can reach across, and
 * distinguishing the two would confirm which names are real to whoever is
 * standing there.
 *
 * No system keyboard anywhere: a numeric pad with counter-sized keys is faster
 * one-handed, and it does not shove the layout up the screen when it opens.
 */

const PIN_LENGTH = 4

export function ShiftUnlock() {
  const session = useSession()
  const { billing } = useAdapters()
  const navigate = useNavigate()
  const { shift } = useCounterState()

  const [loadedBillers, setLoadedBillers] = useState<CounterBiller[] | null>(null)
  const [chosen, setChosen] = useState<CounterBiller | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState(false)

  const outletId = session.outletId
  // A session with no outlet is resolved, not loading — there is nobody to list.
  const billers = outletId ? loadedBillers : []

  useEffect(() => {
    if (!outletId) return
    let active = true
    void billing
      .listBillers(outletId)
      .then((list) => {
        if (active) setLoadedBillers(list)
      })
      .catch(() => {
        if (active) setError('Could not load the billers for this counter.')
      })
    return () => {
      active = false
    }
  }, [billing, outletId])

  async function open(biller: CounterBiller, enteredPin: string) {
    if (!outletId) return
    setBusy(true)
    setError(null)
    try {
      await billing.openShift({
        outletId,
        billerProfileId: biller.profileId,
        pin: enteredPin,
      })
      setChosen(null)
      setPin('')
      void navigate('../billing', { relative: 'path' })
    } catch (cause) {
      setPin('')
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  function press(digit: string) {
    if (!chosen || busy) return
    const next = `${pin}${digit}`.slice(0, PIN_LENGTH)
    setPin(next)
    // Four digits is the whole PIN, so there is nothing left to confirm — an
    // extra "Open" tap after the last digit is pure ceremony at a counter.
    if (next.length === PIN_LENGTH) void open(chosen, next)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Shift"
        subtitle="Whose bills these are. The tablet is shared; the shift says who was at it."
      />

      {error && (
        <p
          role="alert"
          data-testid="shift-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {shift && (
        <Card className="mb-4 space-y-3" data-testid="open-shift">
          <div>
            <h2 className="text-sm font-bold text-content">{shift.billerName} is on the counter</h2>
            <p className="text-xs text-content-muted">
              Open since {formatTime(shift.openedAt)}. Every bill rung now is attributed to them.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setClosing(true)} data-testid="close-shift">
            Close this shift
          </Button>
        </Card>
      )}

      {billers === null ? (
        // Whose shape depends on something already known: with a shift open,
        // what lands here is the one line saying to close it first, so
        // reserving the grid would hold two rows open for a sentence. Without
        // one, it is the biller grid — the same two-then-three columns, at the
        // biller button's height.
        shift ? (
          <LoadingRegion label="this counter’s shift" data-testid="billers-loading">
            <Shimmer className="h-5 w-80 max-w-full" />
          </LoadingRegion>
        ) : (
          <LoadingRegion
            label="the billers at this counter"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
            data-testid="billers-loading"
          >
            {Array.from({ length: 4 }, (_, index) => (
              <Shimmer key={index} className="h-24" />
            ))}
          </LoadingRegion>
        )
      ) : billers.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="Nobody at this outlet has a biller account yet. A manager creates one on Access, and then it appears here."
        />
      ) : shift ? (
        <p className="text-sm text-content-muted">
          Close the shift above to hand the counter over to somebody else.
        </p>
      ) : chosen ? (
        <PinPad
          biller={chosen}
          pin={pin}
          busy={busy}
          onPress={press}
          onBackspace={() => setPin((current) => current.slice(0, -1))}
          onCancel={() => {
            setChosen(null)
            setPin('')
            setError(null)
          }}
        />
      ) : (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          data-testid="biller-grid"
          role="group"
          aria-label="Choose a biller"
        >
          {billers.map((biller) => (
            <Button
              key={biller.profileId}
              variant="secondary"
              className="h-24 flex-col gap-2 text-base"
              data-testid={`biller-${biller.profileId}`}
              onClick={() => {
                setChosen(biller)
                setPin('')
                setError(null)
              }}
            >
              <UserRound aria-hidden size={22} />
              {biller.fullName}
            </Button>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={closing}
        title="Close this shift?"
        consequence={
          shift
            ? `${shift.billerName} stops being credited with new bills. Anything already rung stays exactly as it is, and the next person opens their own shift with their PIN. Nothing is lost by doing this between customers.`
            : ''
        }
        confirmLabel="Close shift"
        onClose={() => setClosing(false)}
        onConfirm={() => {
          const open = shift
          setClosing(false)
          if (open) void billing.closeShift(open.id)
        }}
      />
    </div>
  )
}

function PinPad({
  biller,
  pin,
  busy,
  onPress,
  onBackspace,
  onCancel,
}: {
  biller: CounterBiller
  pin: string
  busy: boolean
  onPress: (digit: string) => void
  onBackspace: () => void
  onCancel: () => void
}) {
  return (
    <Card className="mx-auto max-w-xs space-y-4" data-testid="pin-pad">
      <div className="text-center">
        <p className="inline-flex items-center gap-2 text-sm font-bold text-content">
          <KeyRound aria-hidden size={16} />
          {biller.fullName}
        </p>
        <p className="text-xs text-content-muted">Enter your {PIN_LENGTH}-digit PIN.</p>
      </div>

      <p
        className="flex justify-center gap-3"
        data-testid="pin-progress"
        data-filled={pin.length}
        aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            aria-hidden
            className={
              index < pin.length
                ? 'size-3 rounded-full bg-primary'
                : 'size-3 rounded-full border border-border'
            }
          />
        ))}
      </p>

      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <Button
            key={digit}
            variant="secondary"
            className="h-14 text-lg"
            disabled={busy}
            onClick={() => onPress(digit)}
          >
            {digit}
          </Button>
        ))}
        <Button variant="ghost" className="h-14" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          className="h-14 text-lg"
          disabled={busy}
          onClick={() => onPress('0')}
        >
          0
        </Button>
        <Button
          variant="ghost"
          className="h-14"
          aria-label="Delete last digit"
          disabled={busy}
          onClick={onBackspace}
        >
          <Delete aria-hidden size={20} />
        </Button>
      </div>
    </Card>
  )
}
