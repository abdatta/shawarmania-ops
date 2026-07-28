import { Crosshair, LoaderCircle, MapPin, MapPinOff, Store, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddressSearch } from '@/components/ui/address-search'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAdapters, type Tables } from '@/data-access'
import { DataActionError, type AddressSuggestion, type NewOutlet } from '@/data-access/adapters'
import {
  captureQuality,
  CAPTURE_ACCURACY_GOOD_M,
  CAPTURE_ACCURACY_MAX_M,
  formatDateTime,
  formatMetres,
} from '@/domain'
import {
  watchBestPosition,
  type GeolocationFailureKind,
  type PositionReading,
} from '@/lib/geolocation'

/**
 * Outlets — creating them, editing them, and capturing where each one actually
 * is.
 *
 * This is the first screen an owner sees on an empty database, and until
 * outlet-and-staff-setup it was a dead end: it could capture a position onto an
 * outlet but never produce one, so the whole product sat behind a row nobody
 * could insert. The empty state is therefore the important state, and it is an
 * instruction rather than a blank (design D2).
 *
 * A geofence built from a map search is a geofence built on a guess, and every
 * future check-in is judged against it. So the position is still read from the
 * device standing at the counter — there is deliberately no field for typing
 * coordinates in — and the quality of that reading is shown before anything is
 * saved and stored alongside it afterwards.
 */

interface Draft {
  code: string
  name: string
  locationLabel: string
  addressLine1: string
  addressLine2: string
  city: string
  district: string
  pincode: string
  phone: string
  businessDayCutover: string
}

const EMPTY_DRAFT: Draft = {
  code: '',
  name: '',
  locationLabel: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  district: '',
  pincode: '',
  phone: '',
  businessDayCutover: '04:00',
}

/** `04:00:00` from Postgres, `04:00` in a time input. */
function toTimeInput(value: string): string {
  return value.slice(0, 5)
}

function toDraft(outlet: Tables<'outlets'>): Draft {
  return {
    code: outlet.code,
    name: outlet.name,
    locationLabel: outlet.location_label,
    addressLine1: outlet.address_line1 ?? '',
    addressLine2: outlet.address_line2 ?? '',
    city: outlet.city ?? '',
    district: outlet.district ?? '',
    pincode: outlet.pincode ?? '',
    phone: outlet.phone ?? '',
    businessDayCutover: toTimeInput(outlet.business_day_cutover),
  }
}

function toPayload(draft: Draft): NewOutlet {
  return {
    code: draft.code,
    name: draft.name,
    locationLabel: draft.locationLabel,
    addressLine1: draft.addressLine1,
    addressLine2: draft.addressLine2,
    city: draft.city,
    district: draft.district,
    pincode: draft.pincode,
    phone: draft.phone,
    businessDayCutover: draft.businessDayCutover,
  }
}

export function OutletsSurface() {
  const { outlets: adapter } = useAdapters()
  const [outlets, setOutlets] = useState<Tables<'outlets'>[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState<Tables<'outlets'> | null>(null)
  const [editing, setEditing] = useState<Tables<'outlets'> | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [pendingClosure, setPendingClosure] = useState<Tables<'outlets'> | null>(null)

  useEffect(() => {
    let active = true
    void adapter
      // The owner's management view is the one place a closed outlet must
      // still be visible — otherwise reactivating it would be impossible.
      .listOutlets({ includeInactive: true })
      .then((list) => {
        if (active) setOutlets(list)
      })
      .catch(() => {
        if (active) setError('Could not load outlets. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setOutlets(await adapter.listOutlets({ includeInactive: true }))
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  function openAdd() {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setError(null)
    setFormOpen(true)
  }

  function openEdit(outlet: Tables<'outlets'>) {
    setEditing(outlet)
    setDraft(toDraft(outlet))
    setError(null)
    setFormOpen(true)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      if (editing) {
        await adapter.updateOutlet(editing.id, toPayload(draft))
      } else {
        await adapter.createOutlet(toPayload(draft))
      }
      setFormOpen(false)
    })
  }

  const addButton = (
    <button
      type="button"
      className={buttonVariants({ size: 'phone' })}
      onClick={openAdd}
      data-testid="add-outlet"
    >
      Add outlet
    </button>
  )

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Outlets"
        subtitle="Where each outlet is, and how far staff may be when they check in."
        action={outlets && outlets.length > 0 ? addButton : undefined}
      />

      {error && (
        <p
          role="alert"
          data-testid="outlets-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {outlets === null ? (
        <p className="text-sm text-content-muted">Loading…</p>
      ) : outlets.length === 0 ? (
        <EmptyState
          icon={Store}
          title="Nothing exists yet — start with the shop. An outlet has to exist before anyone can be given an account, put on the staff list, or check in."
          action={addButton}
        />
      ) : (
        <div data-testid="outlet-list" className="space-y-3">
          {outlets.map((outlet) => (
            <OutletCard
              key={outlet.id}
              outlet={outlet}
              busy={busy}
              onCapture={() => setCapturing(outlet)}
              onEdit={() => openEdit(outlet)}
              onToggleActive={() => {
                if (outlet.is_active) setPendingClosure(outlet)
                else void run(() => adapter.updateOutlet(outlet.id, { isActive: true }))
              }}
            />
          ))}
        </div>
      )}

      {/* Keyed so opening the sheet for a different shop remounts rather than
          leaving a previous outlet's values behind. */}
      <OutletFormSheet
        key={editing?.id ?? 'new'}
        open={formOpen}
        editing={editing}
        draft={draft}
        busy={busy}
        onChange={setDraft}
        onClose={() => setFormOpen(false)}
        onSubmit={onSubmit}
      />

      <ConfirmDialog
        open={pendingClosure !== null}
        title="Mark this outlet closed?"
        consequence={
          pendingClosure
            ? `${pendingClosure.name} stops appearing where accounts are assigned, and staff can no longer check in there — though anyone mid-shift can still check out. Nothing is deleted: the staff list, the app accounts and every recorded day stay exactly as they are, and nobody's login is revoked. Reopening it is one tap.`
            : ''
        }
        confirmLabel="Mark closed"
        danger
        onClose={() => setPendingClosure(null)}
        onConfirm={() => {
          const target = pendingClosure
          setPendingClosure(null)
          if (target) void run(() => adapter.updateOutlet(target.id, { isActive: false }))
        }}
      />

      {/*
        Keyed by the outlet: opening the sheet for a different shop starts from
        a clean reading, as a remount rather than an effect resetting state.
      */}
      <CaptureSheet
        key={capturing?.id ?? 'none'}
        outlet={capturing}
        onClose={() => setCapturing(null)}
        onSaved={(saved) => {
          setOutlets(
            (current) =>
              current?.map((outlet) => (outlet.id === saved.id ? saved : outlet)) ?? current,
          )
          setCapturing(null)
        }}
      />
    </div>
  )
}

function OutletCard({
  outlet,
  busy,
  onCapture,
  onEdit,
  onToggleActive,
}: {
  outlet: Tables<'outlets'>
  busy: boolean
  onCapture: () => void
  onEdit: () => void
  onToggleActive: () => void
}) {
  const surveyed = outlet.location_captured_at !== null
  const positioned = outlet.latitude !== null && outlet.longitude !== null

  return (
    <Card className="space-y-3" data-testid={`outlet-${outlet.code}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-content">{outlet.name}</h2>
        <span className="text-xs text-content-muted">{outlet.location_label}</span>
      </div>

      {!outlet.is_active && (
        <p
          data-testid={`closed-${outlet.code}`}
          className="rounded-lg border border-border bg-surface-raised p-2 text-xs font-semibold text-content-muted"
        >
          Marked closed. Nobody can check in here, and this outlet is not offered when accounts are
          assigned. Everything recorded is still here.
        </p>
      )}

      {surveyed ? (
        <div className="space-y-1 text-sm">
          <p className="inline-flex items-center gap-1 text-content">
            <MapPin aria-hidden size={14} />
            {outlet.latitude?.toFixed(5)}, {outlet.longitude?.toFixed(5)}
          </p>
          <p className="text-xs text-content-muted">
            Captured on site {formatDateTime(outlet.location_captured_at!)}
            {outlet.location_accuracy_m !== null &&
              ` · the fix was accurate to ±${formatMetres(outlet.location_accuracy_m)}`}
          </p>
        </div>
      ) : (
        <p
          data-testid={`uncaptured-${outlet.code}`}
          className="inline-flex items-start gap-2 rounded-lg border border-warning bg-surface-raised p-2 text-xs text-content"
        >
          <MapPinOff aria-hidden size={14} className="mt-0.5 shrink-0 text-warning" />
          <span>
            {positioned
              ? 'These coordinates were never captured on site, so they are a placeholder. Check-ins here are judged against a point nobody has stood on.'
              : 'No position recorded. Check-ins here are not measured against a geofence at all.'}
          </span>
        </p>
      )}

      <p className="text-xs text-content-muted">
        Staff may check in within {formatMetres(outlet.geofence_radius_m)} of this point. The
        business day starts at {toTimeInput(outlet.business_day_cutover)}.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant={surveyed ? 'secondary' : 'primary'} size="phone" onClick={onCapture}>
          <Crosshair aria-hidden size={16} />
          {surveyed ? 'Capture again' : 'Capture position here'}
        </Button>
        <Button variant="ghost" size="phone" disabled={busy} onClick={onEdit}>
          Edit
        </Button>
        <Button variant="ghost" size="phone" disabled={busy} onClick={onToggleActive}>
          {outlet.is_active ? 'Mark closed' : 'Reopen'}
        </Button>
      </div>
    </Card>
  )
}

function OutletFormSheet({
  open,
  editing,
  draft,
  busy,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean
  editing: Tables<'outlets'> | null
  draft: Draft
  busy: boolean
  onChange: (draft: Draft) => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
}) {
  const { addressLookup } = useAdapters()
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })

  /**
   * The district is the field somebody is least able to answer from memory —
   * Nadia for Kalyani, North 24 Parganas for Kanchrapara — and it is the one
   * field no geocoder gets right for India. So it is resolved from the PIN
   * rather than from the map, which also means it fills for somebody who types
   * a PIN and never opens the search (design D4).
   *
   * Fire and forget: it never blocks the fill it follows, and a directory that
   * does not answer simply leaves a field to type.
   */
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const fillDistrictFrom = useCallback(
    (pincode: string) => {
      if (!/^\d{6}$/.test(pincode.trim())) return
      void addressLookup.districtForPincode(pincode).then((district) => {
        // Read through the ref: the person keeps typing while this is in
        // flight, and closing over a stale draft would undo whatever they did
        // in the meantime.
        if (district && draftRef.current.pincode.trim() === pincode.trim()) {
          onChange({ ...draftRef.current, district })
        }
      })
    },
    [addressLookup, onChange],
  )

  // A hand-typed PIN resolves too, debounced so six digits are one lookup.
  const typedPincode = draft.pincode
  useEffect(() => {
    if (draftRef.current.district.trim() !== '') return
    const timer = setTimeout(() => fillDistrictFrom(typedPincode), 500)
    return () => clearTimeout(timer)
  }, [typedPincode, fillDistrictFrom])

  /**
   * A pick writes the whole address block, clearing what the suggestion does
   * not carry. Merging into whatever was there produces a street from one place
   * beside a PIN from another — the one failure nobody would notice.
   *
   * The location label is the exception, because it is the owner's own wording
   * rather than an address component: filled when empty, never overwritten.
   */
  function applySuggestion(suggestion: AddressSuggestion) {
    const label = draft.locationLabel.trim()
    onChange({
      ...draft,
      locationLabel:
        label === ''
          ? [suggestion.city, suggestion.placeName].filter(Boolean).join(' — ')
          : draft.locationLabel,
      addressLine1: suggestion.addressLine1,
      addressLine2: suggestion.addressLine2,
      city: suggestion.city,
      district: '',
      pincode: suggestion.pincode,
    })
    fillDistrictFrom(suggestion.pincode)
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'Add outlet'}
      footer={
        <button
          type="submit"
          form="outlet-form"
          disabled={busy}
          className={`${buttonVariants({ size: 'phone' })} w-full`}
        >
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create outlet'}
        </button>
      }
    >
      <form id="outlet-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Name" id="outlet-name">
          <Input
            id="outlet-name"
            required
            value={draft.name}
            placeholder="Shawarmania Kalyani"
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>

        <Field label="Short code" id="outlet-code">
          <Input
            id="outlet-code"
            required
            autoCapitalize="none"
            spellCheck={false}
            value={draft.code}
            placeholder="kalyani"
            onChange={(event) => set({ code: event.target.value })}
          />
          <p className="text-xs text-content-muted">
            How you refer to this shop in a sentence. It has to be different from every other
            outlet&rsquo;s.
          </p>
        </Field>

        <Field label="Location label" id="outlet-location-label">
          <Input
            id="outlet-location-label"
            required
            value={draft.locationLabel}
            placeholder="Kalyani — Central Park"
            onChange={(event) => set({ locationLabel: event.target.value })}
          />
        </Field>

        {/*
          A shortcut, not a step. It sits above the fields it fills so the
          relationship is obvious, and the block below stays exactly as
          typeable as it was — an outlet must be creatable when this finds
          nothing, or when whoever is holding the phone has no signal.
        */}
        <AddressSearch
          suggest={addressLookup.suggest}
          onPick={applySuggestion}
          // Deliberately not "Address (optional)" with a prefix: two adjacent
          // fields whose names differ only by a leading word are hard to tell
          // apart read aloud, which is how a screen reader gets them.
          label="Find the address"
          placeholder="Search a landmark, street or shop"
          hint="Optional. Fills the fields below, and you can edit anything it gets wrong."
        />

        <Field label="Address (optional)" id="outlet-address1">
          <Input
            id="outlet-address1"
            value={draft.addressLine1}
            placeholder="Street and landmark"
            onChange={(event) => set({ addressLine1: event.target.value })}
          />
          <Input
            aria-label="Address line 2"
            className="mt-2"
            value={draft.addressLine2}
            placeholder="Line 2"
            onChange={(event) => set({ addressLine2: event.target.value })}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Input
              aria-label="City"
              value={draft.city}
              placeholder="City"
              onChange={(event) => set({ city: event.target.value })}
            />
            <Input
              aria-label="District"
              value={draft.district}
              placeholder="District"
              onChange={(event) => set({ district: event.target.value })}
            />
          </div>
          <Input
            aria-label="PIN code"
            className="mt-2"
            inputMode="numeric"
            value={draft.pincode}
            placeholder="PIN code"
            onChange={(event) => set({ pincode: event.target.value })}
          />
        </Field>

        <Field label="Phone (optional)" id="outlet-phone">
          <Input
            id="outlet-phone"
            type="tel"
            value={draft.phone}
            onChange={(event) => set({ phone: event.target.value })}
          />
        </Field>

        <Field label="The business day starts at" id="outlet-cutover">
          <Input
            id="outlet-cutover"
            type="time"
            required
            value={draft.businessDayCutover}
            onChange={(event) => set({ businessDayCutover: event.target.value })}
          />
          <p className="text-xs text-content-muted">
            Everything rung up after midnight but before this time still counts as the previous
            day&rsquo;s trading. Changing it never moves anything already recorded — each day is
            stamped when it happens, not worked out afterwards.
          </p>
        </Field>

        {!editing && (
          <p className="rounded-lg border border-border bg-surface-raised p-2 text-xs text-content-muted">
            You will capture where this outlet is afterwards, standing at the counter. Until then
            its check-ins are recorded but not measured against a geofence.
          </p>
        )}
      </form>
    </FormSheet>
  )
}

type CaptureState =
  | { kind: 'idle' }
  | { kind: 'sampling'; best: PositionReading | null }
  | { kind: 'captured'; reading: PositionReading }
  | { kind: 'failed'; failure: GeolocationFailureKind }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }

const FAILURE_COPY: Record<GeolocationFailureKind, string> = {
  denied: 'Location permission is off for this site. Turn it on and try again.',
  unavailable: 'This device could not find a position. Step outside and try again.',
  timeout: 'Finding a position took too long. Step outside for a clearer view of the sky.',
  unsupported: 'This browser cannot share a location. Try another one.',
}

function CaptureSheet({
  outlet,
  onClose,
  onSaved,
}: {
  outlet: Tables<'outlets'> | null
  onClose: () => void
  onSaved: (outlet: Tables<'outlets'>) => void
}) {
  const { outlets: adapter } = useAdapters()
  const [state, setState] = useState<CaptureState>({ kind: 'idle' })
  const [radius, setRadius] = useState(() => String(outlet?.geofence_radius_m ?? 150))

  async function takeReading() {
    setState({ kind: 'sampling', best: null })
    const result = await watchBestPosition({
      onSample: (reading) => setState({ kind: 'sampling', best: reading }),
    })
    setState(
      result.ok
        ? { kind: 'captured', reading: result.reading }
        : { kind: 'failed', failure: result.kind },
    )
  }

  async function save(reading: PositionReading) {
    if (!outlet) return
    const radiusMetres = Number(radius)
    if (!Number.isFinite(radiusMetres) || radiusMetres <= 0) {
      setState({ kind: 'error', message: 'The radius must be a number of metres above zero.' })
      return
    }

    setState({ kind: 'saving' })
    try {
      onSaved(
        await adapter.saveLocation(outlet.id, {
          latitude: reading.latitude,
          longitude: reading.longitude,
          accuracyMetres: reading.accuracyMetres,
          radiusMetres,
        }),
      )
    } catch {
      setState({ kind: 'error', message: 'Could not save that position. Try again in a moment.' })
    }
  }

  const captured = state.kind === 'captured' ? state.reading : null
  const quality = captured ? captureQuality(captured.accuracyMetres) : null

  return (
    <FormSheet
      open={outlet !== null}
      onClose={onClose}
      title={outlet ? `Capture ${outlet.name}` : 'Capture position'}
      footer={
        captured && quality !== 'unusable' ? (
          <Button
            size="phone"
            className="w-full"
            disabled={state.kind === 'saving'}
            onClick={() => void save(captured)}
            data-testid="save-position"
          >
            Save this as the outlet’s position
          </Button>
        ) : (
          <Button
            size="phone"
            className="w-full"
            variant="secondary"
            disabled={state.kind === 'sampling' || state.kind === 'saving'}
            onClick={() => void takeReading()}
            data-testid="take-reading"
          >
            {state.kind === 'sampling'
              ? 'Reading…'
              : // A reading exists but was refused, so this is a retry and says
                // so. Calling it "Take a reading" next to a result on screen
                // reads as a second, different thing.
                captured
                ? 'Take another reading'
                : 'Take a reading'}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-content-muted">
          Stand where staff will check in from — at the counter, not across the road. Hold still for
          a few seconds while the reading settles.
        </p>

        {state.kind === 'sampling' && (
          <p
            data-testid="capture-sampling"
            className="flex items-center gap-2 text-sm font-semibold text-content"
          >
            <LoaderCircle aria-hidden size={16} className="animate-spin" />
            {state.best
              ? `Best so far: ±${formatMetres(state.best.accuracyMetres)}`
              : 'Looking for a position…'}
          </p>
        )}

        {state.kind === 'failed' && (
          <p
            role="alert"
            data-testid="capture-failed"
            data-failure={state.failure}
            className="text-sm font-semibold text-danger"
          >
            {FAILURE_COPY[state.failure]}
          </p>
        )}

        {state.kind === 'error' && (
          <p role="alert" data-testid="capture-error" className="text-sm font-semibold text-danger">
            {state.message}
          </p>
        )}

        {captured && quality && (
          <div data-testid="capture-result" data-quality={quality} className="space-y-3">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-content-muted">Latitude</dt>
              <dd className="font-mono text-content">{captured.latitude.toFixed(6)}</dd>
              <dt className="text-content-muted">Longitude</dt>
              <dd className="font-mono text-content">{captured.longitude.toFixed(6)}</dd>
              <dt className="text-content-muted">Accuracy</dt>
              <dd className="font-semibold text-content">
                ±{formatMetres(captured.accuracyMetres)}
              </dd>
            </dl>

            {quality === 'unusable' && (
              <p className="flex items-start gap-2 rounded-lg border border-danger p-2 text-xs text-content">
                <TriangleAlert aria-hidden size={14} className="mt-0.5 shrink-0 text-danger" />
                <span>
                  This reading is too loose to save — anything past ±
                  {formatMetres(CAPTURE_ACCURACY_MAX_M)} would judge every future check-in against a
                  point that could be far from here. Step outside, away from the roof, and take
                  another.
                </span>
              </p>
            )}

            {quality === 'imprecise' && (
              <p className="flex items-start gap-2 rounded-lg border border-warning p-2 text-xs text-content">
                <TriangleAlert aria-hidden size={14} className="mt-0.5 shrink-0 text-warning" />
                <span>
                  This will do, but it is not tight. Anything past ±
                  {formatMetres(CAPTURE_ACCURACY_GOOD_M)} means the saved point may sit that far
                  from where you are standing, and every check-in is measured from it. Taking
                  another reading outside usually helps.
                </span>
              </p>
            )}

            {/*
              A reading too loose to save gets the evidence and the reason and
              nothing else. The radius configures a save that cannot happen, and
              the retry is already the footer — offering either here put two
              controls for one action on the screen at once, which read as two
              different actions.
            */}
            {quality !== 'unusable' && (
              <>
                <div className="space-y-1">
                  <label htmlFor="capture-radius" className="block text-sm font-semibold">
                    How far from here may staff check in?
                  </label>
                  <Input
                    id="capture-radius"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={radius}
                    onChange={(event) => setRadius(event.target.value)}
                  />
                  <p className="text-xs text-content-muted">
                    Metres. 150 is the agreed default; widen it if the shop sits back from the road.
                  </p>
                </div>

                <button
                  type="button"
                  className={`${buttonVariants({ variant: 'ghost', size: 'phone' })} w-full`}
                  onClick={() => void takeReading()}
                  data-testid="retake-reading"
                >
                  Take another reading
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </FormSheet>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  )
}
