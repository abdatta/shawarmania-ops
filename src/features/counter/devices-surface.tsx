import { RefreshCw, TabletSmartphone } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddButton } from '@/components/ui/add-button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingFigures } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { useAdapters } from '@/data-access'
import { DataActionError, type CounterDeviceOperationalSnapshot } from '@/data-access/adapters'
import { formatDateTime, isCounterTelemetryFresh } from '@/domain'
import { useOutletScope } from '@/features/outlet-scope'
import { useSession } from '@/session/context'
import { holdsRole } from '@/session/session'

/**
 * The tablets at an outlet: set up, edit the setup name/current outlet, or
 * remove permanently. Editing preserves the established device session;
 * removal deliberately does not create a paused security state.
 */

export function DevicesSurface() {
  const { counter, outlets } = useAdapters()
  // One outlet at a time [owner, 2026-09-20], reversing the several-at-once
  // decision of 2026-08-09. That one existed so "is every counter healthy?"
  // could be asked of the whole business at once, and it was right for two
  // owner-run shops holding one tablet each. `multiple-billing-devices` (#35)
  // made an outlet hold several, so the page became outlet, then its tills,
  // then the next outlet, then its tills — the reader scrolls past the shop
  // they came for. And the question itself is losing its asker: the business is
  // converging on one outlet, and further outlets are expected to be
  // franchise-owned, where watching every counter across every franchise is
  // nobody's job here. What makes this cheap is that the three conditions this
  // screen was watched for — no tablet, a tablet gone quiet, a tablet holding
  // unsent bills — are already reported per outlet on Outlets (#51), and
  // switching outlets is one tap on a chip already on screen.
  // `devices/:outletId` opens on the outlet its card named (#51), which reads
  // more plainly in this mode than it did in the other: a link addressed to one
  // outlet now opens on that outlet and nothing else. The bare `devices` path
  // is unchanged and still opens on the remembered selection, so no link
  // anybody holds changes meaning.
  const { outletId: fromAddress } = useParams()
  const { outletIds, selector, managed } = useOutletScope({
    openOn: fromAddress ?? null,
  })
  // The owner administers tablets everywhere, unlike the drawer: both privileged
  // functions carry an explicit `super_admin` branch, so narrowing this to
  // managed outlets would hide a control the database accepts.
  const isOwner = holdsRole(useSession(), 'super_admin')
  const mayAdminister = isOwner || managed

  const scopeKey = outletIds.join(':')
  const [deviceReadings, setDeviceReadings] = useState<
    Record<string, CounterDeviceOperationalSnapshot[]>
  >({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [activeOutlets, setActiveOutlets] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  // Reads can overlap with a scope change or with a setup/removal refresh.
  // Only the newest request may publish figures or clear its busy state; an
  // older response is still a coherent snapshot, but no longer the answer to
  // the question the surface most recently asked.
  const latestRead = useRef(0)

  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [addOutletId, setAddOutletId] = useState<string | null>(null)
  const [issued, setIssued] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<CounterDeviceOperationalSnapshot | null>(null)
  const [editing, setEditing] = useState<CounterDeviceOperationalSnapshot | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editOutletId, setEditOutletId] = useState('')
  const [confirmingMove, setConfirmingMove] = useState(false)

  const load = useCallback(() => {
    const request = ++latestRead.current
    setReading(true)
    setError(null)
    return counter
      .readDeviceOperations(outletIds)
      .then((snapshot) => {
        if (request === latestRead.current) {
          setDeviceReadings((current) => ({ ...current, [scopeKey]: snapshot }))
        }
      })
      .catch(() => {
        if (request === latestRead.current) {
          setError('Could not load the tablets. Try again in a moment.')
        }
      })
      .finally(() => {
        if (request === latestRead.current) setReading(false)
      })
  }, [counter, outletIds, scopeKey])

  useEffect(() => {
    // A scope change is a different question. Holding the previous result here
    // would briefly render an unselected outlet as “No tablet”, which is a
    // false durable state rather than a harmless stale snapshot. This opening
    // read does not synchronously set state from the effect; its response owns
    // the update, and the request token makes a late response ineligible.
    const request = ++latestRead.current
    void Promise.resolve().then(() => {
      if (request === latestRead.current) setError(null)
    })
    void counter
      .readDeviceOperations(outletIds)
      .then((snapshot) => {
        if (request === latestRead.current) {
          setDeviceReadings((current) => ({ ...current, [scopeKey]: snapshot }))
        }
      })
      .catch(() => {
        if (request === latestRead.current) {
          setError('Could not load the tablets. Try again in a moment.')
        }
      })
      .finally(() => {
        if (request === latestRead.current) setReading(false)
      })
    return () => {
      latestRead.current += 1
    }
  }, [counter, outletIds, scopeKey])

  useEffect(() => {
    let active = true
    void outlets
      .listOutlets()
      .then((list) => {
        if (!active) return
        setNames(Object.fromEntries(list.map((outlet) => [outlet.id, outlet.name])))
        setActiveOutlets(list.map((outlet) => ({ id: outlet.id, name: outlet.name })))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [outlets])

  const devices = Object.hasOwn(deviceReadings, scopeKey) ? deviceReadings[scopeKey]! : null
  const isReading = reading || (devices === null && error === null)
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

  function beginEdit(device: CounterDeviceOperationalSnapshot) {
    setError(null)
    setEditing(device)
    setEditLabel(device.label)
    setEditOutletId(device.outletId)
  }

  async function saveEdit() {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      await counter.editDevice({
        deviceId: editing.id,
        label: editLabel.trim(),
        outletId: editOutletId,
      })
      setEditing(null)
      setConfirmingMove(false)
      await load()
    } catch (cause) {
      setConfirmingMove(false)
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'Could not edit that tablet. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault()
    if (!editing || !editLabel.trim() || !editOutletId) return
    if (editOutletId !== editing.outletId) {
      setConfirmingMove(true)
      return
    }
    void saveEdit()
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        scope={selector}
        title="Tablets"
        subtitle={
          devices?.[0]?.readAt
            ? `The hardware and counter standing there. Read ${formatDateTime(devices[0].readAt)}.`
            : 'The hardware and counter standing there.'
        }
        action={
          <button
            type="button"
            onClick={() => void load()}
            disabled={isReading}
            className={`${buttonVariants({ variant: 'secondary', size: 'phone' })} whitespace-nowrap`}
          >
            <RefreshCw aria-hidden size={16} />
            {isReading ? 'Reading…' : 'Re-read'}
          </button>
        }
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
              On the counter tablet, open the app and choose <strong>Set up this tablet</strong>{' '}
              from sign in, then type this code. It is good for fifteen minutes, works once, and is
              not shown again — generate another if you lose it.
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
        <LoadingFigures label="tablets and their counters" rows={outletIds.map(() => 7)} />
      ) : (
        /*
          Every tablet at the outlet in scope, rather than a flat list of the
          tablets that happen to exist. The two questions are different: a list
          of tablets answers "what is out there", and this answers "is this
          counter covered" — which is the one an outlet with no tablet at all is
          the interesting answer to, and an absence cannot be a row in a list of
          tills.

          Still a loop over `outletIds` though it runs once since
          tablets-one-outlet-at-a-time. That list is the scope hook's answer, and
          reading it is how this stays correct without asserting its length. The
          outlet's name is not printed above its own tablets: the chip that chose
          it is on the same screen, directly above. The empty state keeps the
          name inside its sentence, because a sentence about a missing tablet is
          the one somebody acts on and it should say which shop.

          An outlet holds as many tablets as it has tills since
          multiple-billing-devices, so this filters where it used to `find`. A
          tablet awaiting proof of its session is absent from the read itself, so
          nothing here has to know about one: an outlet mid-setup looks exactly
          like an outlet with one fewer tablet, which is the point.
        */
        <ul className="space-y-3">
          {outletIds.map((outletId) => {
            const outletName = names[outletId] ?? 'This outlet'
            const outletDevices = inScope.filter((candidate) => candidate.outletId === outletId)
            return (
              <li key={outletId} className="space-y-3">
                {outletDevices.map((device) => (
                  <Card key={device.id}>
                    <CardTitle>{device.label}</CardTitle>
                    <CardBody className="space-y-2">
                      {/*
                        "Last reported", never "current". This status is written
                        by the tablet's own heartbeat, so a tablet that is off,
                        offline or broken simply stops moving them — and a number
                        presented as live when nothing is reporting it is the one
                        thing this row must not say.
                      */}
                      <p data-testid="device-telemetry">
                        {device.lastSeenAt
                          ? `Last reported ${formatDateTime(device.lastSeenAt)}: ${
                              device.lastReportedUnresolved
                            } unresolved${
                              device.lastReportedUnresolved > 0 &&
                              device.lastReportedOldestUnresolvedAt
                                ? `, oldest since ${formatDateTime(
                                    device.lastReportedOldestUnresolvedAt,
                                  )}`
                                : ''
                            }.`
                          : 'This tablet has never reported.'}
                        {!isCounterTelemetryFresh(device.lastSeenAt) && (
                          <span className="ml-1 font-semibold text-warning">
                            Out of touch — treat these figures as old.
                          </span>
                        )}
                      </p>
                      <section
                        data-testid={`device-operations-${device.id}`}
                        className="space-y-2 border-t border-border pt-3"
                      >
                        {device.operations ? (
                          <>
                            <p className="text-content">
                              <span className="font-semibold">
                                {device.operations.operatorName}
                              </span>{' '}
                              has held this counter since{' '}
                              {formatDateTime(device.operations.openedAt)}.
                            </p>
                          </>
                        ) : (
                          <p className="text-content">Nobody is at this counter.</p>
                        )}
                      </section>
                      {mayAdminister && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => beginEdit(device)}
                            className={buttonVariants({ variant: 'secondary', size: 'phone' })}
                          >
                            Edit {device.label}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoving(device)}
                            className={buttonVariants({ variant: 'secondary', size: 'phone' })}
                          >
                            {/*
                              Named, not just "Remove". An outlet may have two
                              counters open on this screen, and a permanent action
                              that does not say which one it takes is an action
                              somebody performs on the wrong till.
                            */}
                            Remove {device.label}
                          </button>
                        </div>
                      )}
                    </CardBody>
                  </Card>
                ))}
                {outletDevices.length === 0 ? (
                  <EmptyState
                    icon={TabletSmartphone}
                    title={`No tablet is set up at ${outletName} yet.`}
                    action={
                      mayAdminister ? (
                        <AddButton
                          label={`Set up a tablet at ${outletName}`}
                          onClick={() => {
                            setAddOutletId(outletId)
                            setAdding(true)
                          }}
                        />
                      ) : undefined
                    }
                  />
                ) : (
                  mayAdminister && (
                    <AddButton
                      label={`Set up another tablet at ${outletName}`}
                      onClick={() => {
                        setAddOutletId(outletId)
                        setAdding(true)
                      }}
                    />
                  )
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

      <FormSheet
        open={editing !== null}
        title={editing ? `Edit ${editing.label}` : 'Edit tablet'}
        onClose={() => {
          if (!busy) setEditing(null)
        }}
        error={error}
        footer={
          <button
            type="submit"
            form="device-edit-form"
            disabled={busy || !editLabel.trim()}
            className={`${buttonVariants({ size: 'phone' })} w-full`}
          >
            {busy ? 'Saving…' : 'Save tablet'}
          </button>
        }
      >
        <form id="device-edit-form" onSubmit={submitEdit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <label htmlFor="device-edit-label" className="block text-sm font-semibold">
              Name
            </label>
            <Input
              id="device-edit-label"
              name="device-edit-label"
              type="text"
              autoFocus
              data-autofocus
              required
              maxLength={120}
              value={editLabel}
              onChange={(event) => setEditLabel(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="device-edit-outlet" className="block text-sm font-semibold">
              Outlet
            </label>
            {isOwner ? (
              <Select
                id="device-edit-outlet"
                name="device-edit-outlet"
                value={editOutletId}
                onChange={(event) => setEditOutletId(event.target.value)}
              >
                {activeOutlets.map((outlet) => (
                  <option key={outlet.id} value={outlet.id}>
                    {outlet.name}
                  </option>
                ))}
              </Select>
            ) : (
              <p id="device-edit-outlet" className="text-sm text-content">
                {editing ? names[editing.outletId] : ''}
              </p>
            )}
            <p className="text-xs text-content-muted">
              {isOwner
                ? 'Moving a tablet changes where its next shift and future billing belong; its earlier history stays at the original outlet.'
                : 'Only a Super Admin can move a tablet to another outlet.'}
            </p>
          </div>
        </form>
      </FormSheet>

      <ConfirmDialog
        open={confirmingMove && editing !== null}
        title={editing ? `Move ${editing.label}?` : 'Move this tablet?'}
        consequence={
          editing
            ? `${editing.label} will leave ${names[editing.outletId] ?? 'its current outlet'} and ` +
              `join ${names[editOutletId] ?? 'the selected outlet'}. Its existing bills and shifts stay ` +
              'where they were; its next shift and future billing use the new outlet. The move is refused ' +
              'unless the tablet is idle and has freshly reported no unresolved work. Keep the tablet ' +
              'online until it reloads the new outlet before opening its next shift.'
            : ''
        }
        confirmLabel={busy ? 'Moving…' : 'Move tablet'}
        onClose={() => setConfirmingMove(false)}
        onConfirm={saveEdit}
      />

      {/*
        Removal takes the live shift with it and cancels any pending request, so
        the sentence names what is actually lost — including the count the tablet
        last reported, which is the number somebody will ask about afterwards.
      */}
      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Remove ${removing.label}?` : 'Remove this tablet?'}
        danger
        consequence={
          removing
            ? 'This is permanent. Any shift open on it ends immediately, and it cannot be paused ' +
              'or brought back — setting it up again needs a fresh code typed at the counter.' +
              (removing.lastReportedUnresolved > 0
                ? ` It last reported ${removing.lastReportedUnresolved} unresolved; removing it does ` +
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
