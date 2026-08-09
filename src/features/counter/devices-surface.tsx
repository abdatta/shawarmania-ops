import { TabletSmartphone } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddButton } from '@/components/ui/add-button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingList } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import { DataActionError, type CounterDeviceSummary } from '@/data-access/adapters'
import { formatDateTime } from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'
import { useSession } from '@/session/context'
import { holdsRole } from '@/session/session'

/**
 * The tablets at an outlet, and the two things anybody does to one: set it up,
 * and remove it.
 *
 * There is deliberately nothing in between. **Removal is permanent and there is
 * no paused state** — a paused tablet is a security question that a removed one
 * is not, and setting one up again costs a code and a walk to the counter.
 *
 * One active tablet per outlet is a database invariant for launch, so this
 * surface offers a setup code only where there is room for one. The refusal is
 * still Postgres's; this only avoids offering an act that will fail.
 */

/** Beyond this, "last reported" is old enough to be worth flagging as stale. */
const STALE_AFTER_MS = 30 * 60 * 1000

function isStale(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return true
  return Date.now() - Date.parse(lastSeenAt) > STALE_AFTER_MS
}

export function DevicesSurface() {
  const { counter, outlets } = useAdapters()
  // Several outlets at once, like attendance [owner, 2026-08-09]. "Is every
  // counter healthy?" is a question about the business rather than about one
  // shop, and answering it by switching outlets one at a time is how a tablet
  // that stopped reporting two days ago goes unnoticed.
  const { outletIds, selector, managed } = useOutletScope({ multiple: true })
  // The owner administers tablets everywhere, unlike the drawer: both privileged
  // functions carry an explicit `super_admin` branch, so narrowing this to
  // managed outlets would hide a control the database accepts.
  const mayAdminister = holdsRole(useSession(), 'super_admin') || managed

  const [devices, setDevices] = useState<CounterDeviceSummary[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [addOutletId, setAddOutletId] = useState<string | null>(null)
  const [issued, setIssued] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<CounterDeviceSummary | null>(null)

  const load = useCallback(() => {
    return counter
      .listDevices()
      .then(setDevices)
      .catch(() => setError('Could not load the tablets. Try again in a moment.'))
  }, [counter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let active = true
    void outlets
      .listOutlets()
      .then((list) => {
        if (!active) return
        setNames(Object.fromEntries(list.map((outlet) => [outlet.id, outlet.name])))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [outlets])

  const inScope = (devices ?? []).filter((device) => outletIds.includes(device.outletId))

  async function issue(event: FormEvent) {
    event.preventDefault()
    if (!addOutletId) return
    setBusy(true)
    setError(null)
    try {
      const result = await counter.issueSetupCode(addOutletId, label.trim())
      setIssued(result.code)
      setAdding(false)
      setLabel('')
      await load()
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'Could not generate a code. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!removing) return
    setBusy(true)
    setError(null)
    try {
      await counter.removeDevice(removing.id)
      await load()
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'Could not remove that tablet. Try again in a moment.',
      )
    } finally {
      setBusy(false)
      setRemoving(null)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={selector}
        title="Tablets"
        subtitle="The hardware standing at each counter."
      />

      {error && (
        <p
          role="alert"
          data-testid="devices-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {/*
        The code, once. There is no way to ask for it again because only its hash
        was kept — so the sentence has to say so before the sheet closes, not
        afterwards.
      */}
      {issued && (
        <Card className="mb-4 border-accent">
          <CardTitle>Setup code</CardTitle>
          <CardBody className="space-y-2">
            <p className="text-center font-mono text-3xl font-bold tracking-widest text-content">
              {issued}
            </p>
            <p>
              Type this into the tablet at the counter, on its setup screen. It is good for fifteen
              minutes, works once, and is not shown again — generate another if you lose it.
            </p>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className={buttonVariants({ variant: 'secondary', size: 'phone' })}
            >
              Done
            </button>
          </CardBody>
        </Card>
      )}

      {devices === null ? (
        <LoadingList label="tablets" rows={2} />
      ) : (
        /*
          A card per outlet in scope, rather than a list of the tablets that
          happen to exist. With several outlets selected the two questions are
          different: a list of tablets answers "what is out there", and this
          answers "is every counter covered" — which is the one an empty counter
          is the interesting answer to.
        */
        <ul className="space-y-3">
          {outletIds.map((outletId) => {
            const device = inScope.find((candidate) => candidate.outletId === outletId)
            return (
              <li key={outletId}>
                {device ? (
                  <Card>
                    <CardTitle>{device.label}</CardTitle>
                    <CardBody className="space-y-2">
                      <p>{names[outletId] ?? 'This outlet'}</p>
                      {/*
                        "Last reported", never "current". Both figures are written
                        by the tablet's own heartbeat, so a tablet that is off,
                        offline or broken simply stops moving them — and a number
                        presented as live when nothing is reporting it is the one
                        thing this row must not say.
                      */}
                      <p data-testid="device-telemetry">
                        {device.lastSeenAt
                          ? `Last reported ${formatDateTime(device.lastSeenAt)}: ${
                              device.lastReportedUnsent
                            } not sent yet.`
                          : 'This tablet has never reported.'}
                        {isStale(device.lastSeenAt) && (
                          <span className="ml-1 font-semibold text-warning">
                            Out of touch — treat these figures as old.
                          </span>
                        )}
                      </p>
                      {mayAdminister && (
                        <button
                          type="button"
                          onClick={() => setRemoving(device)}
                          className={buttonVariants({ variant: 'secondary', size: 'phone' })}
                        >
                          Remove
                        </button>
                      )}
                    </CardBody>
                  </Card>
                ) : (
                  <EmptyState
                    icon={TabletSmartphone}
                    title={`No tablet is set up at ${names[outletId] ?? 'this outlet'} yet.`}
                    action={
                      mayAdminister ? (
                        <AddButton
                          label={`Set up a tablet at ${names[outletId] ?? 'this outlet'}`}
                          onClick={() => {
                            setAddOutletId(outletId)
                            setAdding(true)
                          }}
                        />
                      ) : undefined
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      <FormSheet
        open={adding}
        title={`Set up a tablet at ${(addOutletId && names[addOutletId]) || 'this outlet'}`}
        onClose={() => setAdding(false)}
        error={error}
        footer={
          <button
            type="submit"
            form="device-setup-form"
            disabled={busy}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Generating…' : 'Generate a code'}
          </button>
        }
      >
        <form id="device-setup-form" onSubmit={issue} className="space-y-1" noValidate>
          <label htmlFor="device-label" className="block text-sm font-semibold">
            What to call it
          </label>
          <Input
            id="device-label"
            name="device-label"
            type="text"
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Kalyani counter tablet"
          />
          <p className="text-xs text-content-muted">
            This is the name the person approving a shift will read on their own phone, so make it
            match what is written on the hardware.
          </p>
        </form>
      </FormSheet>

      {/*
        Removal takes the live shift with it and cancels any pending request, so
        the sentence names what is actually lost — including the count the tablet
        last reported, which is the number somebody will ask about afterwards.
      */}
      <ConfirmDialog
        open={removing !== null}
        title="Remove this tablet?"
        danger
        consequence={
          removing
            ? 'This is permanent. Any shift open on it ends immediately, and it cannot be paused ' +
              'or brought back — setting it up again needs a fresh code typed at the counter.' +
              (removing.lastReportedUnsent > 0
                ? ` It last reported ${removing.lastReportedUnsent} not sent yet; removing it does ` +
                  'not delete that work, but nothing else can send it.'
                : '')
            : ''
        }
        confirmLabel={busy ? 'Removing…' : 'Remove'}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      />
    </div>
  )
}
