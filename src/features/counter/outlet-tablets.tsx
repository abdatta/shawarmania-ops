import {
  CheckCheck,
  CloudUpload,
  Pencil,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  TabletSmartphone,
  Trash2,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react'
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardBody, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingFigures } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { useAdapters } from '@/data-access'
import {
  DataActionError,
  type CounterDeviceOperationalSnapshot,
  type TabletKind,
} from '@/data-access/adapters'
import { formatDateTime, formatFreshness, isCounterTelemetryFresh } from '@/domain'
import { DANGER_OUTLINE, OutletSection } from '@/features/outlets/outlet-section'
import { getPartState, isRenderable } from '@/gates/registry'
import { cn } from '@/lib/cn'
import { SessionContext } from '@/session/context'

/**
 * The tablets at one outlet, as a section of that outlet's page
 * (outlets-one-at-a-time, owner 2026-09-26).
 *
 * This was its own surface, reached only through a button on the outlet it
 * stands in — the one page in the app that behaved like a navigation tab with
 * no tab. A tablet belongs to exactly one outlet, and a manager had the Outlets
 * surface at all only so they could get here (#51), so it now lives where it
 * was always reached from. `devices` and `devices/:outletId` were removed, not
 * redirected: nobody held a saved link to either (owner, 2026-09-26).
 *
 * Everything it did is unchanged: set up with a one-time code shown once, edit
 * the name or (owner only) move it, remove it for good. It also carries what
 * the outlet card used to say it was *raising* about its counter, because
 * those conditions — no tablet, a tablet gone quiet, one holding unsent bills —
 * are facts about a tablet and read best on that tablet's own row.
 *
 * `mayAdminister` decides what is offered, never what is allowed: both
 * privileged functions check the caller's authority in the database.
 */
export function OutletTablets({
  outletId,
  outletName,
  mayAdminister,
  isOwner,
}: {
  outletId: string
  outletName: string
  mayAdminister: boolean
  /** Only the owner may move a tablet to another outlet. */
  isOwner: boolean
}) {
  const { counter, outlets } = useAdapters()

  const [devices, setDevices] = useState<CounterDeviceOperationalSnapshot[] | null>(null)
  const [readFor, setReadFor] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [activeOutlets, setActiveOutlets] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  // Reads can overlap with an outlet change or with a setup/removal refresh.
  // Only the newest request may publish; an older response is still coherent,
  // but no longer the answer to the question most recently asked.
  const latestRead = useRef(0)

  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<TabletKind>('counter')
  const [issued, setIssued] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<CounterDeviceOperationalSnapshot | null>(null)
  const [editing, setEditing] = useState<CounterDeviceOperationalSnapshot | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editOutletId, setEditOutletId] = useState('')
  const [confirmingMove, setConfirmingMove] = useState(false)
  const [editKind, setEditKind] = useState<TabletKind>('counter')
  const [confirmingKind, setConfirmingKind] = useState(false)
  // Kitchen tablets are a gated part (#70): the choice is absent until promoted.
  const kitchens = isRenderable(
    getPartState('kitchen-tablets'),
    useContext(SessionContext)?.mode ?? 'real',
  )

  const read = useCallback(() => {
    const request = ++latestRead.current
    setReading(true)
    return counter
      .readDeviceOperations([outletId])
      .then((snapshot) => {
        if (request !== latestRead.current) return
        setDevices(snapshot.filter((device) => device.outletId === outletId))
        setReadFor(outletId)
        setError(null)
      })
      .catch(() => {
        if (request === latestRead.current) {
          setError('Could not load the tablets. Try again in a moment.')
        }
      })
      .finally(() => {
        if (request === latestRead.current) setReading(false)
      })
  }, [counter, outletId])

  useEffect(() => {
    // The opening read sets no state synchronously; its response owns the
    // update, and the request token makes a late response ineligible.
    const request = ++latestRead.current
    void counter
      .readDeviceOperations([outletId])
      .then((snapshot) => {
        if (request !== latestRead.current) return
        setDevices(snapshot.filter((device) => device.outletId === outletId))
        setReadFor(outletId)
        setError(null)
      })
      .catch(() => {
        if (request === latestRead.current) {
          setError('Could not load the tablets. Try again in a moment.')
        }
      })
    return () => {
      latestRead.current += 1
    }
  }, [counter, outletId])

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

  // A different outlet is a different question. Showing the previous outlet's
  // tablets while this one's are read would render a false durable state.
  const shown = readFor === outletId ? devices : null
  const isReading = reading || (shown === null && error === null)

  async function issue(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await counter.issueSetupCode(
        outletId,
        label.trim(),
        kitchens ? kind : 'counter',
      )
      setIssued(result.code)
      setAdding(false)
      setLabel('')
      setKind('counter')
      await read()
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
      await read()
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
    setEditKind(device.kind ?? 'counter')
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
        ...(editKind !== (editing.kind ?? 'counter') ? { kind: editKind } : {}),
      })
      setEditing(null)
      setConfirmingMove(false)
      setConfirmingKind(false)
      await read()
    } catch (cause) {
      setConfirmingMove(false)
      setConfirmingKind(false)
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
    if (editKind !== (editing.kind ?? 'counter')) {
      setConfirmingKind(true)
      return
    }
    void saveEdit()
  }

  return (
    <OutletSection
      id={`tablets-${outletId}`}
      data-testid="outlet-tablets"
      title={shown && shown.length > 0 ? `Tablets · ${shown.length}` : 'Tablets'}
      actions={
        <>
          <button
            type="button"
            onClick={() => void read()}
            disabled={isReading}
            aria-label={isReading ? 'Reading the tablets' : 'Re-read the tablets'}
            // When it was read, for whoever wants it, without a sentence on the
            // page saying so.
            title={shown?.[0]?.readAt ? `Read ${formatDateTime(shown[0].readAt)}` : undefined}
            className={buttonVariants({ variant: 'ghost', size: 'phone' })}
          >
            <RefreshCw aria-hidden size={16} className={isReading ? 'animate-spin' : undefined} />
          </button>
          {mayAdminister && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={buttonVariants({ variant: 'secondary', size: 'phone' })}
              data-testid="add-tablet"
            >
              <Plus aria-hidden size={16} />
              Set up
            </button>
          )}
        </>
      }
    >
      {error && (
        <p role="alert" data-testid="devices-error" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      {/*
        The code, once. There is no way to ask for it again because only its hash
        was kept — so the sentence has to say so before the sheet closes, not
        afterwards.
      */}
      {issued && (
        <Card className="border-accent">
          <CardTitle>Setup code</CardTitle>
          <CardBody className="space-y-2">
            <p className="text-center font-mono text-3xl font-bold tracking-widest text-content">
              {issued}
            </p>
            <p>
              On the tablet, open the app and choose <strong>Set up this tablet</strong> from sign
              in, then type this code. It is good for fifteen minutes, works once, and is not shown
              again — generate another if you lose it.
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

      {shown === null ? (
        <LoadingFigures label="tablets and their counters" rows={[7]} />
      ) : (
        /*
          Every tablet at this outlet, rather than a flat list of the tablets
          that happen to exist: "is this counter covered" is the question, and
          an outlet with no tablet at all is the interesting answer to it.

          An outlet holds as many tablets as it has tills since
          multiple-billing-devices. A tablet awaiting proof of its session is
          absent from the read itself, so an outlet mid-setup looks exactly like
          an outlet with one fewer tablet, which is the point.
        */
        <div className="space-y-3">
          {shown.map((device) => {
            const fresh = isCounterTelemetryFresh(device.lastSeenAt)
            return (
              <Card key={device.id} className="flex items-stretch justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {device.label}
                    {device.kind === 'kitchen' && (
                      <span
                        data-testid={`device-kind-${device.id}`}
                        className="rounded-md border border-border px-2 py-0.5 text-xs font-semibold text-content"
                      >
                        Kitchen
                      </span>
                    )}
                  </CardTitle>
                  {/*
                    Three short lines, each led by an icon, instead of two
                    sentences (owner, 2026-09-26). What the long sentence carried
                    still holds: these are what the tablet **last reported** by
                    its own heartbeat, never live, so a tablet gone quiet leads
                    with that and its other lines read as the old figures they are.
                  */}
                  <ul className="space-y-1.5 text-sm text-content">
                    <TabletLine
                      icon={fresh ? Wifi : WifiOff}
                      tone={fresh ? 'ok' : 'warning'}
                      testId="device-telemetry"
                    >
                      {device.lastSeenAt === null
                        ? 'Never reported'
                        : fresh
                          ? `Seen ${formatFreshness(device.lastSeenAt)}`
                          : `Out of touch · last seen ${formatFreshness(device.lastSeenAt)}`}
                    </TabletLine>
                    {device.lastSeenAt !== null &&
                      (device.lastReportedUnresolved > 0 ? (
                        <TabletLine icon={CloudUpload} tone="warning" testId="device-unsent">
                          {device.lastReportedUnresolved} unsent
                          {device.lastReportedOldestUnresolvedAt &&
                            ` · oldest ${formatFreshness(device.lastReportedOldestUnresolvedAt)}`}
                        </TabletLine>
                      ) : (
                        <TabletLine icon={CheckCheck} tone="ok" testId="device-unsent">
                          All sent
                        </TabletLine>
                      ))}
                    {device.kind === 'kitchen' ? (
                      <>
                        <TabletLine
                          icon={UserRound}
                          tone={device.kitchenShift ? 'plain' : 'muted'}
                          testId={`device-operations-${device.id}`}
                        >
                          {device.kitchenShift
                            ? `${device.kitchenShift.operatorName} · since ${formatFreshness(device.kitchenShift.openedAt)}`
                            : 'Nobody on shift'}
                        </TabletLine>
                        <TabletLine
                          icon={SlidersHorizontal}
                          tone="plain"
                          testId={`device-kitchen-filter-${device.id}`}
                        >
                          {kitchenFilterWords(device)}
                        </TabletLine>
                      </>
                    ) : (
                      <TabletLine
                        icon={UserRound}
                        tone={device.operations ? 'plain' : 'muted'}
                        testId={`device-operations-${device.id}`}
                      >
                        {device.operations
                          ? `${device.operations.operatorName} · since ${formatFreshness(device.operations.openedAt)}`
                          : 'Nobody on shift'}
                      </TabletLine>
                    )}
                  </ul>
                </div>
                {mayAdminister && (
                  /*
                    Down the card's right edge, which the three short lines leave
                    empty: Edit at the top, Remove in red at the bottom, as far
                    from each other as the card allows (owner, 2026-09-26).
                    "Edit" and "Remove", not "Edit Counter tablet": the card's own
                    title already says which tablet. The name stays in the
                    accessible label, because a screen reader moving between
                    buttons hears the button and not the card it sits on.
                  */
                  <div className="flex shrink-0 flex-col items-end justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => beginEdit(device)}
                      aria-label={`Edit ${device.label}`}
                      className={buttonVariants({ variant: 'secondary', size: 'phone' })}
                    >
                      <Pencil aria-hidden size={16} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(device)}
                      aria-label={`Remove ${device.label}`}
                      className={cn(
                        buttonVariants({ variant: 'secondary', size: 'phone' }),
                        DANGER_OUTLINE,
                      )}
                    >
                      <Trash2 aria-hidden size={16} />
                      Remove
                    </button>
                  </div>
                )}
              </Card>
            )
          })}
          {shown.length === 0 && (
            <EmptyState
              icon={TabletSmartphone}
              title={`No tablet is set up at ${outletName} yet.`}
            />
          )}
        </div>
      )}

      <FormSheet
        open={adding}
        title={`Set up a tablet at ${outletName}`}
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
          {kitchens && <UseFor value={kind} onChange={setKind} name="device-setup-kind" />}
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
          {kitchens && <UseFor value={editKind} onChange={setEditKind} name="device-edit-kind" />}
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

      <ConfirmDialog
        open={confirmingKind && editing !== null}
        title={
          editing
            ? `Make ${editing.label} a ${editKind === 'kitchen' ? 'kitchen' : 'billing'} tablet?`
            : 'Change this tablet?'
        }
        consequence={editing ? kindChangeConsequence(editing, editKind) : ''}
        confirmLabel={busy ? 'Saving…' : 'Change'}
        onClose={() => setConfirmingKind(false)}
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
    </OutletSection>
  )
}

/** One line of a tablet's card: an icon saying what the line is about, then the fact. */
function TabletLine({
  icon: Icon,
  tone,
  testId,
  children,
}: {
  icon: typeof Wifi
  tone: 'ok' | 'warning' | 'muted' | 'plain'
  testId: string
  children: ReactNode
}) {
  return (
    <li
      data-testid={testId}
      className={cn(
        'flex items-center gap-2',
        tone === 'warning' && 'font-semibold',
        tone === 'muted' && 'text-content-muted',
      )}
    >
      <Icon
        aria-hidden
        size={16}
        className={cn(
          'shrink-0',
          tone === 'ok' && 'text-success',
          tone === 'warning' && 'text-warning',
          // One colouring for every icon on the outlet page: the accent for what
          // a line is about, green and amber only where the icon reports a state.
          (tone === 'muted' || tone === 'plain') && 'text-accent-text',
        )}
      />
      <span className="min-w-0">{children}</span>
    </li>
  )
}

/** A kitchen's filter, in words, as the kitchen's own header reads it (#70). */
function kitchenFilterWords(device: CounterDeviceOperationalSnapshot): string {
  const filter = device.kitchenFilter
  if (!filter) return 'Everything'
  const names = filter.categoryNames.join(', ')
  if (filter.mode === 'include') return names ? `Only ${names}` : 'Nothing chosen yet'
  return names ? `Everything except ${names}` : 'Everything'
}

/** What switching a tablet's use will do, said before it is done (#70, design D12). */
function kindChangeConsequence(device: CounterDeviceOperationalSnapshot, next: TabletKind): string {
  const holder = device.operations?.operatorName ?? device.kitchenShift?.operatorName ?? null
  const ends = holder
    ? `${holder}'s shift on it ends now, and somebody starts a new one on the tablet. `
    : 'Somebody starts a shift on the tablet the usual way. '
  return next === 'kitchen'
    ? `${ends}As a kitchen it shows the orders taken at the counter and takes no money. ` +
        'This is refused while it holds unsent work or orders it took that are still unfinished, ' +
        'because only it can finish them.'
    : `${ends}As a billing tablet it takes orders and money like any counter.`
}

/** The tablet's use, as a two-way choice: Billing or Kitchen. */
function UseFor({
  value,
  onChange,
  name,
}: {
  value: TabletKind
  onChange: (next: TabletKind) => void
  name: string
}) {
  return (
    <fieldset className="mt-4 space-y-1">
      <legend className="block text-sm font-semibold">Use this tablet for</legend>
      <div role="radiogroup" aria-label="Use this tablet for" className="grid grid-cols-2 gap-2">
        {(
          [
            ['counter', 'Billing'],
            ['kitchen', 'Kitchen'],
          ] as const
        ).map(([option, words]) => (
          <button
            key={option}
            type="button"
            role="radio"
            name={name}
            aria-checked={value === option}
            onClick={() => onChange(option)}
            className={cn(
              'min-h-11 rounded-xl border-2 px-3 font-semibold',
              value === option
                ? 'border-primary bg-primary text-on-primary'
                : 'border-border bg-surface text-content',
            )}
          >
            {words}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
