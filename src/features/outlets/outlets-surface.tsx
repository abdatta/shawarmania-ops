import { Crosshair, LoaderCircle, MapPin, MapPinOff, Store, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddButton } from '@/components/ui/add-button'
import { AddressSearch } from '@/components/ui/address-search'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAdapters, type Tables } from '@/data-access'
import {
  DataActionError,
  type AddressSuggestion,
  type NewOutlet,
  type OutletReference,
} from '@/data-access/adapters'
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
  staffCodePrefix: string
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
  staffCodePrefix: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  district: '',
  pincode: '',
  phone: '',
  businessDayCutover: '04:00',
}

/**
 * The prefix proposed for an outlet code as it is typed: the first three
 * alphanumerics, uppercased. `new-shop` gives `NEW`, not `NEW-`.
 *
 * Only ever a proposal. The owner can overwrite it, and the database derives
 * its own if the box is left empty — including the numeric suffix that settles
 * a collision, which this cannot do because it does not know the other outlets'
 * prefixes. Getting a taken prefix back as a sentence is the fallback, and it
 * is why this is pre-filled rather than authoritative.
 */
function proposePrefix(code: string): string {
  return code
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase()
}

/** `04:00:00` from Postgres, `04:00` in a time input. */
function toTimeInput(value: string): string {
  return value.slice(0, 5)
}

/**
 * What to call an outlet on screen.
 *
 * The one outlet this app most needs to be able to act on has no name, no code
 * and no location label — a manager tapped Create with the placeholders still
 * showing. A heading that renders as nothing gives an owner nothing to aim at,
 * so a nameless row says it is nameless rather than rendering blank.
 */
function outletLabel(outlet: Tables<'outlets'>): string {
  return outlet.name.trim() || outlet.code.trim() || 'Outlet created without a name'
}

/**
 * A card needs a stable handle, and the code is blank on exactly the row this
 * screen must be able to delete. Falling back to the id keeps it addressable.
 */
function outletHandle(outlet: Tables<'outlets'>): string {
  return outlet.code.trim() || outlet.id
}

/**
 * Table names into words a person would say. Deliberately a handful, not a
 * map of the schema: the refusal counts come from the database's own foreign
 * keys, so a table added later arrives here with no phrase waiting for it and
 * is shown as it is. Reading `alert_responses — 2` is worse than reading
 * "alerts somebody replied to"; not being told about it at all is worse than
 * both (design D6).
 */
const REFERENCE_WORDS: Record<string, string> = {
  profiles: 'people',
  counter_devices: 'counter tablets',
  attendance: 'recorded attendance days',
  bills: 'bills',
  shifts: 'shifts',
  expenses: 'recorded expenses',
  inventory_items: 'stock items',
  account_invites: 'outstanding invitations',
}

function referenceWords(reference: OutletReference): string {
  return `${REFERENCE_WORDS[reference.table] ?? reference.table} — ${reference.count}`
}

function toDraft(outlet: Tables<'outlets'>): Draft {
  return {
    code: outlet.code,
    name: outlet.name,
    locationLabel: outlet.location_label,
    staffCodePrefix: outlet.staff_code_prefix,
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
    staffCodePrefix: draft.staffCodePrefix,
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
  const [pendingDeletion, setPendingDeletion] = useState<Tables<'outlets'> | null>(null)
  const [blocked, setBlocked] = useState<{ id: string; references: OutletReference[] } | null>(null)

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

  /**
   * Deleting is attempted, never predicted.
   *
   * The screen could ask what is attached first and grey the action out, and
   * that would mean keeping a copy of the schema's foreign keys in this file —
   * the drift the database is enumerated to avoid everywhere else in this
   * repo. So the delete is tried, and a refusal is turned into the sentence
   * the owner actually needs (design D2, D6).
   */
  async function deleteOutlet(outlet: Tables<'outlets'>) {
    setBusy(true)
    setError(null)
    setBlocked(null)
    try {
      await adapter.deleteOutlet(outlet.id)
      // In place rather than a refetch: the row is gone, and asking the server
      // to confirm what it just did is a round trip that can only agree.
      setOutlets((current) => current?.filter((candidate) => candidate.id !== outlet.id) ?? current)
    } catch (cause) {
      if (cause instanceof DataActionError && cause.code === 'outlet_in_use') {
        // A count that cannot be fetched degrades to the generic refusal
        // rather than blanking it: "something is attached" is still true.
        const references = await adapter.outletReferences(outlet.id).catch(() => [])
        setBlocked({ id: outlet.id, references })
      } else {
        setError(
          cause instanceof DataActionError
            ? cause.message
            : 'That did not work. Try again in a moment.',
        )
      }
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

  /**
   * The first required field left blank, as a sentence — or null if none is.
   *
   * An outlet reached production with no name because three layers each
   * declined to check. This is the second of them. The `required` attributes on
   * the inputs below do not validate anything: `noValidate` is on this form and
   * on every other form in this app, deliberately, so that refusals are written
   * in this app's voice rather than drawn by the browser. `required` stays
   * because it also sets `aria-required`, which is the half of it that works
   * (design D1).
   *
   * One message per field rather than one for all three. The form has four
   * required fields among ten, and a message that does not say which one is
   * missing is close to useless on a phone, where the offending field is
   * usually scrolled out of sight.
   */
  function firstBlankRequiredField(): string | null {
    if (draft.name.trim() === '') {
      return 'An outlet needs a name — it is how every screen in the app refers to it.'
    }
    if (draft.code.trim() === '') {
      return 'An outlet needs a short code, like “kalyani” — it is how staff refer to it in a sentence.'
    }
    if (draft.locationLabel.trim() === '') {
      return 'An outlet needs a location label — it is what shows beside the name on every card.'
    }
    if (draft.staffCodePrefix.trim() === '') {
      return 'An outlet needs a staff code prefix — every staff code here begins with it.'
    }
    return null
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()

    // Checked before `run()`, which clears the error it would otherwise be
    // handed. The guard covers the edit path as well as create: this is one
    // component for both, and clearing a name is the same mistake as never
    // typing one. The database refuses it either way — that is the boundary,
    // and this is the convenience.
    const blank = firstBlankRequiredField()
    if (blank) {
      setError(blank)
      return
    }

    await run(async () => {
      if (editing) {
        await adapter.updateOutlet(editing.id, toPayload(draft))
      } else {
        await adapter.createOutlet(toPayload(draft))
      }
      setFormOpen(false)
    })
  }

  const addButton = <AddButton label="Add outlet" onClick={openAdd} data-testid="add-outlet" />

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
              blockedBy={blocked?.id === outlet.id ? blocked.references : null}
              onCapture={() => setCapturing(outlet)}
              onEdit={() => openEdit(outlet)}
              onDelete={() => {
                setBlocked(null)
                setPendingDeletion(outlet)
              }}
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
        error={error}
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
        Deliberately no type-the-name step. The standard hardening for an
        irreversible action is to make the operator type the record's name, and
        the outlet that most needs deleting has neither a name nor a code to
        type. Requiring the outlet to be closed first is what supplies the
        second moment instead (design D3, D4).
      */}
      <ConfirmDialog
        open={pendingDeletion !== null}
        title="Delete this outlet?"
        consequence={
          pendingDeletion
            ? `${outletLabel(pendingDeletion)} is removed, not hidden. Marking it closed left it on this screen and let you reopen it; this takes the row away, and there is no undo. It will work only if nothing at all is attached to it — no staff, no accounts, no recorded days — and the database will refuse it otherwise.`
            : ''
        }
        confirmLabel="Delete outlet"
        danger
        onClose={() => setPendingDeletion(null)}
        onConfirm={() => {
          const target = pendingDeletion
          setPendingDeletion(null)
          if (target) void deleteOutlet(target)
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
  blockedBy,
  onCapture,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  outlet: Tables<'outlets'>
  busy: boolean
  /** Non-null once a delete has been refused: what is still attached. */
  blockedBy: OutletReference[] | null
  onCapture: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
}) {
  const surveyed = outlet.location_captured_at !== null
  const positioned = outlet.latitude !== null && outlet.longitude !== null
  const handle = outletHandle(outlet)

  return (
    <Card className="space-y-3" data-testid={`outlet-${handle}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-content">{outletLabel(outlet)}</h2>
        <span className="text-xs text-content-muted">{outlet.location_label}</span>
      </div>

      {!outlet.is_active && (
        <p
          data-testid={`closed-${handle}`}
          className="rounded-lg border border-border bg-surface-raised p-2 text-xs font-semibold text-content-muted"
        >
          Marked closed. Nobody can check in here, and this outlet is not offered when accounts are
          assigned. Everything recorded is still here. If this outlet should never have existed at
          all, it can now be deleted — but only while nothing is attached to it.
        </p>
      )}

      {blockedBy !== null && (
        <div
          role="alert"
          data-testid={`delete-blocked-${handle}`}
          className="rounded-lg border border-danger bg-surface-raised p-2 text-xs text-content"
        >
          <p className="font-semibold">
            This outlet was not deleted. Things are still attached to it:
          </p>
          {blockedBy.length > 0 ? (
            <ul className="mt-1 list-inside list-disc">
              {blockedBy.map((reference) => (
                <li key={reference.table}>{referenceWords(reference)}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">
              What is attached could not be listed just now. Nothing was deleted.
            </p>
          )}
          <p className="mt-1 text-content-muted">
            Move or remove them and the outlet can be deleted then — there is nothing here to
            re-mark afterwards.
          </p>
        </div>
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
          data-testid={`uncaptured-${handle}`}
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
        {/*
          Closed first. An active outlet gets the reversible action and nothing
          else, so a mis-tap on a trading shop lands on Mark closed rather than
          on the one thing that cannot be undone (design D3).
        */}
        {!outlet.is_active && (
          <Button
            variant="ghost"
            size="phone"
            disabled={busy}
            onClick={onDelete}
            data-testid={`delete-${handle}`}
          >
            Delete
          </Button>
        )}
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
  error,
}: {
  open: boolean
  editing: Tables<'outlets'> | null
  draft: Draft
  busy: boolean
  onChange: (draft: Draft) => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
  error: string | null
}) {
  const { addressLookup, outlets: outletsAdapter } = useAdapters()
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })

  /**
   * Whether this outlet's prefix has already been spent.
   *
   * `KAL-7KQ2` names a prefix, so re-pointing it would leave every code already
   * issued reading from something that no longer exists. The database refuses
   * the change; this is what stops the owner discovering that by being refused,
   * which design D4 called out specifically.
   *
   * Asked rather than assumed, and asked through the same catalog-reading RPC
   * the delete path uses — this file keeps no copy of what references an
   * outlet. A lookup that fails leaves the field editable and the database
   * refuses on submit, which is the right way round: a failed read must not
   * lock a field that was legitimately open.
   *
   * Nothing resets this on the way out, because nothing has to: the sheet is
   * keyed on the outlet being edited, so opening it for a different one is a
   * remount and this starts `false` again.
   */
  const [prefixFrozen, setPrefixFrozen] = useState(false)
  useEffect(() => {
    if (!open || !editing) return
    let active = true
    void outletsAdapter
      .outletReferences(editing.id)
      .then((references) => {
        if (active) {
          // People at the outlet stand in for "a staff code has been issued
          // here" — a close proxy, not the rule itself. The trigger is the
          // boundary; this only decides whether the field looks editable.
          setPrefixFrozen(references.some((reference) => reference.table === 'profiles'))
        }
      })
      .catch(() => {
        if (active) setPrefixFrozen(false)
      })
    return () => {
      active = false
    }
  }, [open, editing, outletsAdapter])

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
      error={error}
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
      {/*
        `noValidate` and `required` coexist on purpose, and it reads as
        redundancy otherwise. `noValidate` switches off the browser's own
        validation so that this app's refusals are its own sentences rather
        than a bubble whose wording and position cannot be styled and vary
        across the browsers a counter tablet and a staff phone run.
        `required` stays because it still sets `aria-required`, which assistive
        technology announces. So: `required` marks the field for the person,
        `firstBlankRequiredField` refuses the submit, and a check constraint
        refuses the write (design D1).

        The three placeholders below are sample *values*, so they carry `e.g.`
        — a manager once read `Shawarmania Kalyani` as a name already filled
        in, which is how the nameless outlet was created. The address-block
        placeholders further down are the accessible *name* of inputs with no
        visible label; `e.g. City` would be incoherent, so they are left alone
        (design D5).
      */}
      <form id="outlet-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Name" id="outlet-name">
          <Input
            id="outlet-name"
            required
            value={draft.name}
            placeholder="e.g. Shawarmania Kalyani"
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
            placeholder="e.g. kalyani"
            onChange={(event) => {
              // The prefix follows the code only while it is still the
              // proposal. Once somebody has typed their own it stops moving
              // under them — a field that silently rewrites what you entered
              // is worse than one that was never filled in.
              const next = event.target.value
              set(
                draft.staffCodePrefix === proposePrefix(draft.code)
                  ? { code: next, staffCodePrefix: proposePrefix(next) }
                  : { code: next },
              )
            }}
          />
          <p className="text-xs text-content-muted">
            How you refer to this shop in a sentence. It has to be different from every other
            outlet&rsquo;s.
          </p>
        </Field>

        <Field label="Staff code prefix" id="outlet-staff-code-prefix">
          <Input
            id="outlet-staff-code-prefix"
            required
            autoCapitalize="characters"
            maxLength={3}
            disabled={prefixFrozen}
            value={draft.staffCodePrefix}
            onChange={(event) => set({ staffCodePrefix: event.target.value.toUpperCase() })}
          />
          <p className="text-xs text-content-muted">
            {prefixFrozen
              ? 'Staff codes have already been issued from this prefix, so it cannot change now — every code at this outlet begins with it.'
              : 'Every staff code at this outlet begins with these three characters, like KAL-7KQ2.'}
          </p>
        </Field>

        <Field label="Location label" id="outlet-location-label">
          <Input
            id="outlet-location-label"
            required
            value={draft.locationLabel}
            placeholder="e.g. Kalyani — Central Park"
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
