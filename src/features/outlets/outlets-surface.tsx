import {
  Check,
  ChevronRight,
  Clock,
  Copy,
  Crosshair,
  LoaderCircle,
  LocateFixed,
  MapPin,
  MapPinOff,
  Moon,
  Pencil,
  Phone,
  Store,
  QrCode,
  Tag,
  TriangleAlert,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'

import { ConfirmDialog } from '@/components/layout/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/layout/data-table'
import { EmptyState } from '@/components/layout/empty-state'
import { FormSheet } from '@/components/layout/form-sheet'
import { PageHeader } from '@/components/layout/page-header'
import { AddButton } from '@/components/ui/add-button'
import { AddressSearch } from '@/components/ui/address-search'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingRegion, LoadingTable, Shimmer } from '@/components/ui/loading'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { useAdapters, type Tables } from '@/data-access'
import {
  DataActionError,
  type AddressSuggestion,
  type CounterDeviceSummary,
  type NewOutlet,
  type OutletReference,
} from '@/data-access/adapters'
import {
  captureQuality,
  CAPTURE_ACCURACY_GOOD_M,
  CAPTURE_ACCURACY_MAX_M,
  describeCutover,
  formatMetres,
  isCounterTelemetryFresh,
  QUIET_HOURS_FROM,
  QUIET_HOURS_UNTIL,
} from '@/domain'
import { OutletTablets } from '@/features/counter/outlet-tablets'
import { DANGER_OUTLINE, OutletSection } from '@/features/outlets/outlet-section'
import {
  OutletServiceSections,
  OutletServiceShimmer,
} from '@/features/outlets/outlet-service-sections'
import {
  OutletLoyaltySection,
  OutletLoyaltyShimmer,
} from '@/features/outlets/outlet-loyalty-section'
import { OutletSettingsLinkProvider } from '@/features/outlets/outlet-settings-link'
import { OutletDiscountPresets } from './outlet-discount-presets'
import { getPartState, isRenderable } from '@/gates/registry'
import { cn } from '@/lib/cn'
import {
  menuSlugFrom,
  menuSlugProblem,
  publicMenuHost,
  publicMenuLink,
} from '@/lib/public-menu-link'
import { useSession } from '@/session/context'
import { holdsRole, sessionOutletsFor } from '@/session/session'
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
  menuSlug: string
  name: string
  locationLabel: string
  addressLine1: string
  addressLine2: string
  city: string
  district: string
  pincode: string
  phone: string
  businessDayCutover: string
  arrivalDeadline: string
}

const EMPTY_DRAFT: Draft = {
  code: '',
  menuSlug: '',
  name: '',
  locationLabel: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  district: '',
  pincode: '',
  phone: '',
  businessDayCutover: '04:00',
  arrivalDeadline: '13:00',
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
  // Since multi-outlet-people it is the ASSIGNMENT that points at an outlet, so
  // that is the row the refusal counts — and "people" is still the word for it,
  // because that is what an owner sees when they look at the shop.
  assignments: 'people',
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
    menuSlug: outlet.menu_slug,
    name: outlet.name,
    locationLabel: outlet.location_label,
    addressLine1: outlet.address_line1 ?? '',
    addressLine2: outlet.address_line2 ?? '',
    city: outlet.city ?? '',
    district: outlet.district ?? '',
    pincode: outlet.pincode ?? '',
    phone: outlet.phone ?? '',
    businessDayCutover: toTimeInput(outlet.business_day_cutover),
    arrivalDeadline: toTimeInput(outlet.arrival_deadline),
  }
}

function toPayload(draft: Draft): NewOutlet {
  return {
    code: draft.code,
    menuSlug: draft.menuSlug,
    name: draft.name,
    locationLabel: draft.locationLabel,
    addressLine1: draft.addressLine1,
    addressLine2: draft.addressLine2,
    city: draft.city,
    district: draft.district,
    pincode: draft.pincode,
    phone: draft.phone,
    businessDayCutover: draft.businessDayCutover,
    arrivalDeadline: draft.arrivalDeadline,
  }
}

/**
 * Everything that changes an outlet, written once for the two screens that
 * change one: the list adds an outlet, and the outlet's own page edits,
 * captures, closes, reopens and deletes it. The sheets and dialogs are the ones
 * the outlet card had, unchanged; only where they are opened from moved
 * (outlets-one-at-a-time).
 *
 * **The Super Admin writes; a Franchise Admin reads** (#51). Whether a control
 * is offered is decided by the caller from the session, and that is courtesy
 * rather than the boundary: create, edit, close, reopen, delete and capture are
 * refused by `outlets_insert`, `outlets_update` and `outlets_delete` in
 * Postgres, and the isolation suite proves it with a hand-crafted request.
 */
function useOutletActions({
  onSaved,
  onDeleted,
}: {
  /** The row as the database returned it after a create, edit or capture. */
  onSaved: (outlet: Tables<'outlets'>, created: boolean) => void
  onDeleted?: (id: string) => void
}) {
  const { outlets: adapter } = useAdapters()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [capturing, setCapturing] = useState<Tables<'outlets'> | null>(null)
  const [editing, setEditing] = useState<Tables<'outlets'> | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [pendingClosure, setPendingClosure] = useState<Tables<'outlets'> | null>(null)
  const [pendingDeletion, setPendingDeletion] = useState<Tables<'outlets'> | null>(null)
  const [blocked, setBlocked] = useState<{ id: string; references: OutletReference[] } | null>(null)

  async function run(action: () => Promise<Tables<'outlets'>>, created = false) {
    setBusy(true)
    setError(null)
    try {
      onSaved(await action(), created)
      return true
    } catch (cause) {
      setError(
        cause instanceof DataActionError
          ? cause.message
          : 'That did not work. Try again in a moment.',
      )
      return false
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
   * the owner actually needs (outlet-deletion, design D2, D6).
   */
  async function deleteOutlet(outlet: Tables<'outlets'>) {
    setBusy(true)
    setError(null)
    setBlocked(null)
    try {
      await adapter.deleteOutlet(outlet.id)
      onDeleted?.(outlet.id)
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

  /**
   * The first required field left blank, as a sentence — or null if none is.
   *
   * An outlet reached production with no name because three layers each
   * declined to check. This is the second of them. The `required` attributes on
   * the inputs do not validate anything: `noValidate` is on this form and on
   * every other form in this app, deliberately, so that refusals are written
   * in this app's voice rather than drawn by the browser. `required` stays
   * because it also sets `aria-required`, which is the half of it that works
   * (blank-is-not-a-value, design D1).
   *
   * One message per field rather than one for all three: a message that does
   * not say which field is missing is close to useless on a phone, where the
   * offending field is usually scrolled out of sight.
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
    // Not a blank check — blank is allowed and means derive or keep — but it
    // belongs here so it is refused before `run()` for the same reason.
    return menuSlugProblem(draft.menuSlug)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    // Checked before `run()`, which clears the error it would otherwise be
    // handed. The guard covers the edit path as well as create: clearing a name
    // is the same mistake as never typing one. The database refuses it either
    // way — that is the boundary, and this is the convenience.
    const blank = firstBlankRequiredField()
    if (blank) {
      setError(blank)
      return
    }
    const saved = await run(
      () =>
        editing
          ? adapter.updateOutlet(editing.id, toPayload(draft))
          : adapter.createOutlet(toPayload(draft)),
      editing === null,
    )
    if (saved) setFormOpen(false)
  }

  const dialogs = (
    <>
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
        second moment instead (outlet-deletion, design D3, D4).
      */}
      <ConfirmDialog
        open={pendingDeletion !== null}
        title="Delete this outlet?"
        consequence={
          pendingDeletion
            ? `${outletLabel(pendingDeletion)} is removed, not hidden. Marking it closed kept it and let you reopen it; this takes the row away, and there is no undo. It will work only if nothing at all is attached to it — no staff, no accounts, no recorded days — and the database will refuse it otherwise.`
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
          onSaved(saved, false)
          setCapturing(null)
        }}
      />
    </>
  )

  return {
    error,
    busy,
    blocked,
    dialogs,
    add() {
      setEditing(null)
      setDraft(EMPTY_DRAFT)
      setError(null)
      setFormOpen(true)
    },
    edit(outlet: Tables<'outlets'>) {
      setEditing(outlet)
      setDraft(toDraft(outlet))
      setError(null)
      setFormOpen(true)
    },
    capture: setCapturing,
    close: setPendingClosure,
    reopen(outlet: Tables<'outlets'>) {
      void run(() => adapter.updateOutlet(outlet.id, { isActive: true }))
    },
    remove(outlet: Tables<'outlets'>) {
      setBlocked(null)
      setPendingDeletion(outlet)
    },
  }
}

/**
 * **Outlets: a list, like Team**, where each row opens that outlet's own page
 * (outlets-one-at-a-time, owner 2026-09-26).
 *
 * It replaced a chip picker over one outlet at a time, which wrapped onto a
 * second line at three outlets and could only get worse as franchises open.
 * A row stays light — name, short code, area, whether it is open, and one line
 * about its tablets — because Overview already carries the per-outlet summary,
 * and this must not become a second Overview.
 *
 * Closed outlets are listed after the trading ones, dimmed, for the owner, who
 * reopens and deletes them from their page. A manager cannot reopen one, so a
 * closed shop on their list would be a row with nothing to do about it.
 *
 * With one outlet the list is still shown rather than skipped: skipping it
 * would make Back land on a list that bounces straight forward again.
 */
export function OutletsSurface() {
  const { outlets: adapter, counter } = useAdapters()
  const session = useSession()
  const navigate = useNavigate()
  const mayWrite = holdsRole(session, 'super_admin')
  const [outlets, setOutlets] = useState<Tables<'outlets'>[] | null>(null)
  const [devices, setDevices] = useState<CounterDeviceSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const actions = useOutletActions({
    // A new outlet is the one the owner wants to look at next.
    onSaved: (saved, created) => {
      if (created) void navigate(saved.id)
    },
  })

  useEffect(() => {
    let active = true
    void adapter
      .listOutlets({ includeInactive: mayWrite })
      .then((list) => {
        if (active) setOutlets(list)
      })
      .catch(() => {
        if (active) setLoadError('Could not load outlets. Try again in a moment.')
      })
    return () => {
      active = false
    }
  }, [adapter, mayWrite])

  /**
   * The tablets, for each row's one line. A failure of this read is not a
   * failure of the list: the outlets still list, and the line says the tablets
   * could not be read rather than claiming there are none — "no tablet" would
   * send somebody to mint a setup code for hardware standing there working.
   */
  useEffect(() => {
    let active = true
    void counter
      .listDevices()
      .then((list) => {
        if (active) setDevices(list)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [counter])

  const ordered = useMemo(
    () =>
      outlets === null
        ? null
        : [...outlets.filter((o) => o.is_active), ...outlets.filter((o) => !o.is_active)],
    [outlets],
  )

  const addButton = <AddButton label="Add outlet" onClick={actions.add} data-testid="add-outlet" />

  const columns: DataTableColumn<Tables<'outlets'>>[] = [
    {
      id: 'outlet',
      header: 'Outlet',
      cell: (outlet) => (
        // One link, stretched over its row, so the whole row is one tap and a
        // screen reader still meets one link named for the outlet.
        <Link
          to={outlet.id}
          data-testid={`open-${outletHandle(outlet)}`}
          className="block py-2 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:focus-ring"
        >
          <span
            className={cn(
              'block font-semibold',
              outlet.is_active ? 'text-content' : 'text-content-muted',
            )}
          >
            {outletLabel(outlet)}
          </span>
          <span className="block text-xs text-content-muted">
            {[outlet.code.trim(), outlet.location_label.trim()].filter(Boolean).join(' · ')}
          </span>
        </Link>
      ),
    },
    {
      id: 'tablets',
      header: 'Tablets',
      cell: (outlet) => <TabletsSummary outlet={outlet} devices={devices} />,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (outlet) => <OutletStatus open={outlet.is_active} />,
    },
    {
      id: 'open',
      header: <span className="sr-only">Open the outlet</span>,
      align: 'right',
      cell: () => <ChevronRight aria-hidden size={16} className="inline text-content-muted" />,
    },
  ]

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Outlets"
        action={mayWrite && outlets && outlets.length > 0 ? addButton : undefined}
      />

      {/* A refused add is said here as well as in its sheet, as the card surface
          did: the sheet closes, and the sentence should not go with it. */}
      {(loadError ?? actions.error) && (
        <p
          role="alert"
          data-testid="outlets-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {loadError ?? actions.error}
        </p>
      )}

      {ordered === null ? (
        loadError ? null : (
          <LoadingTable
            label="your outlets"
            rows={2}
            rowHeight="h-16"
            data-testid="outlets-loading"
          />
        )
      ) : (
        <div data-testid="outlet-list">
          <DataTable
            columns={columns}
            rows={ordered}
            rowKey={(outlet) => outlet.id}
            rowClassName={() => 'relative hover:bg-surface-raised'}
            empty={
              <EmptyState
                icon={Store}
                title={
                  mayWrite
                    ? 'Nothing exists yet — start with the shop. An outlet has to exist before anyone can be given an account, put on the staff list, or check in.'
                    : 'No outlets are assigned to you. A Super Admin assigns an outlet before it appears here.'
                }
                action={mayWrite ? addButton : undefined}
              />
            }
          />
        </div>
      )}

      {actions.dialogs}
    </div>
  )
}

/**
 * One line about an outlet's tablets, for its row: how many, and the one thing
 * worth knowing about them if there is one — bills not sent, or a tablet gone
 * quiet. The detail lives on the outlet's page.
 */
function TabletsSummary({
  outlet,
  devices,
}: {
  outlet: Tables<'outlets'>
  devices: CounterDeviceSummary[] | null
}) {
  if (!outlet.is_active) return <span className="text-content-muted">—</span>
  if (devices === null) return <span className="text-content-muted">Not read</span>
  const here = devices.filter((device) => device.outletId === outlet.id)
  if (here.length === 0) {
    return <span className="font-semibold text-warning">None</span>
  }
  const unsent = here.reduce((sum, device) => sum + device.lastReportedUnresolved, 0)
  const quiet = here.filter((device) => !isCounterTelemetryFresh(device.lastSeenAt)).length
  return (
    <span className="block">
      <span className="block text-content">{here.length}</span>
      {unsent > 0 ? (
        <span className="block text-xs font-semibold text-warning">{unsent} unsent</span>
      ) : quiet > 0 ? (
        <span className="block text-xs font-semibold text-warning">{quiet} out of touch</span>
      ) : null}
    </span>
  )
}

/**
 * Whether the outlet is trading, drawn exactly as Team draws a person's status
 * (owner, 2026-09-26): the ordinary state in quiet words, and the one that
 * stops things in red. No coloured dot — on this app a dot means a live
 * reading, like Overview's Online / Offline for the tablets, and whether a shop
 * is in business is a setting somebody chose.
 */
function OutletStatus({ open }: { open: boolean }) {
  return open ? (
    <span className="text-content-muted">Open</span>
  ) : (
    <span className="font-semibold text-danger">Closed</span>
  )
}

/**
 * **One outlet's own page** (outlets-one-at-a-time, owner 2026-09-26): its
 * details, its tablets, and the settings later changes add, with nothing about
 * any other outlet on it and so no picker.
 *
 * **Back steps back through the reader's own history**, like a browser's back,
 * rather than always to the list: the page is reached from the list, from
 * Overview, and later from the counter, and each reader should return where they
 * came from. Opened with nothing before it in this app — a reload, a fresh tab —
 * it goes to the list instead of out of the app.
 *
 * An outlet the reader may not see reads exactly like one that does not exist:
 * the row is absent under their policy, and the page says so and nothing else.
 */
export function OutletPage() {
  const { outlets: adapter } = useAdapters()
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const { outletId = '' } = useParams()
  const mayWrite = holdsRole(session, 'super_admin')
  // The owner administers tablets everywhere: both privileged functions carry an
  // explicit `super_admin` branch. A manager, at the outlets they manage.
  const mayAdminister = mayWrite || sessionOutletsFor(session, 'franchise_admin').includes(outletId)
  const [outlet, setOutlet] = useState<Tables<'outlets'> | null | undefined>(undefined)
  const [readFor, setReadFor] = useState<string | null>(null)
  // Orders and Packaging, `demo` until #60's database section makes them real.
  const showService = isRenderable(getPartState('outlet-service-choices'), session.mode)
  // Points and gold, `demo` until #62's database section makes them real.
  const showLoyalty = isRenderable(getPartState('outlet-points'), session.mode)
  /**
   * Whether this outlet has gold, as its Loyalty section last read or saved it.
   * Where that section is not shown yet, gold is as #57 and #60 left it, so
   * Orders keeps its gold waiver exactly as it has it today.
   */
  const [loyaltyGold, setLoyaltyGold] = useState<{ outletId: string; on: boolean } | null>(null)

  const toList = useCallback(
    () => void navigate('..', { relative: 'path', replace: true }),
    [navigate],
  )
  const back = useCallback(() => {
    // `default` is the key of the entry the app was opened on: there is no
    // earlier page of ours to return to.
    if (location.key === 'default') toList()
    else void navigate(-1)
  }, [location.key, navigate, toList])

  const actions = useOutletActions({
    onSaved: (saved) => setOutlet(saved),
    onDeleted: toList,
  })

  useEffect(() => {
    let active = true
    void adapter
      .getOutlet(outletId)
      .then((row) => {
        if (!active) return
        setOutlet(row)
        setReadFor(outletId)
      })
      .catch(() => {
        if (!active) return
        setOutlet(null)
        setReadFor(outletId)
      })
    return () => {
      active = false
    }
  }, [adapter, outletId])

  const shown = readFor === outletId ? outlet : undefined
  const goldOffered = showLoyalty
    ? loyaltyGold !== null && loyaltyGold.outletId === shown?.id && loyaltyGold.on
    : true

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        onBack={back}
        title={shown ? outletLabel(shown) : 'Outlet'}
        // The short code, which no outlet screen showed before (owner, 2026-09-26).
        subtitle={shown ? shown.code.trim() || 'No short code' : undefined}
        action={
          shown ? (
            <span className="text-sm">
              <OutletStatus open={shown.is_active} />
            </span>
          ) : undefined
        }
      />

      {actions.error && (
        <p
          role="alert"
          data-testid="outlets-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {actions.error}
        </p>
      )}

      {shown === undefined ? (
        // Details, then the Tablets label and two tablets: 387 and 297 px on a
        // phone (design D5). Details grew from 316 by the Public menu tile, its
        // gap and its Copy button (the-menu-is-public).
        <LoadingRegion label="this outlet" className="space-y-4" data-testid="outlets-loading">
          <Shimmer className="h-[24.1875rem]" />
          {showService && <OutletServiceShimmer withDiscounts />}
          {showLoyalty && <OutletLoyaltyShimmer />}
          <Shimmer className="h-[18.5rem]" />
        </LoadingRegion>
      ) : shown === null ? (
        <EmptyState icon={Store} title="This outlet is not one you can see." />
      ) : (
        // Orders and Loyalty show gold's settings in both places, as one value.
        <OutletSettingsLinkProvider key={shown.id}>
          <OutletBody
            outlet={shown}
            busy={actions.busy}
            mayWrite={mayWrite}
            blockedBy={actions.blocked?.id === shown.id ? actions.blocked.references : null}
            onCapture={() => actions.capture(shown)}
            onEdit={() => actions.edit(shown)}
            onDelete={() => actions.remove(shown)}
            onClose={() => actions.close(shown)}
            onReopen={() => actions.reopen(shown)}
          >
            {/*
            A closed outlet has no counter to administer: its tablets are moved
            or removed from a trading outlet's page.
          */}
            {shown.is_active && showService && (
              <OutletServiceSections
                key={`service-${shown.id}`}
                outletId={shown.id}
                // The owner, and a manager at the outlets they manage [owner,
                // 2026-09-27] — the same reach as the tablets below. Details stays
                // the owner's alone.
                mayWrite={mayAdminister}
                goldOffered={goldOffered}
              >
                <OutletDiscountPresets outletId={shown.id} mayWrite={mayAdminister} />
              </OutletServiceSections>
            )}
            {shown.is_active && showLoyalty && (
              <OutletLoyaltySection
                key={`loyalty-${shown.id}`}
                outletId={shown.id}
                // The owner, and a manager at the outlets they manage
                // [owner, 2026-09-28]: points are this outlet's to fund.
                mayWrite={mayAdminister}
                onSettings={(settings) =>
                  setLoyaltyGold({ outletId: shown.id, on: settings.goldEnabled })
                }
              />
            )}
            {shown.is_active && (
              <OutletTablets
                key={`tablets-${shown.id}`}
                outletId={shown.id}
                outletName={outletLabel(shown)}
                mayAdminister={mayAdminister}
                isOwner={mayWrite}
              />
            )}
          </OutletBody>
        </OutletSettingsLinkProvider>
      )}

      {actions.dialogs}
    </div>
  )
}

/**
 * Everything under the outlet's name on its page (outlets-one-at-a-time, owner
 * 2026-09-26): **Details**, then its tablets, then its closing actions. Each
 * group sits under a quiet label so none reads as standing beside the outlet.
 *
 * **Details** is tiles of a caption over a value, and is exactly what **Edit**
 * changes (the name and short code in the page header are edited by it too).
 * The check-in fence is a tile of its own with **Recapture** inside it, because
 * a position is captured standing at the counter rather than typed.
 *
 * Closing sits alone at the foot, centred. On a closed outlet, Reopen and
 * Delete stand there instead: a trading outlet never offers the one action that
 * cannot be undone (outlet-deletion, design D3).
 */
function OutletBody({
  outlet,
  busy,
  mayWrite,
  blockedBy,
  onCapture,
  onEdit,
  onDelete,
  onClose,
  onReopen,
  children,
}: {
  outlet: Tables<'outlets'>
  busy: boolean
  /** Whether to offer the writes. The database is what refuses them. */
  mayWrite: boolean
  /** Non-null once a delete has been refused: what is still attached. */
  blockedBy: OutletReference[] | null
  onCapture: () => void
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
  onReopen: () => void
  /** The groups after Details — today the tablets. */
  children?: ReactNode
}) {
  const surveyed = outlet.location_captured_at !== null
  const handle = outletHandle(outlet)
  const address = [outlet.address_line1, outlet.address_line2, outlet.city, outlet.pincode]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ')

  return (
    <div data-testid={`outlet-${handle}`} className="space-y-4">
      {blockedBy !== null && (
        <div
          role="alert"
          data-testid={`delete-blocked-${handle}`}
          className="rounded-lg border border-danger bg-surface p-2 text-xs text-content"
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
        </div>
      )}

      <OutletSection
        id={`details-${outlet.id}`}
        title="Details"
        actions={
          mayWrite ? (
            <Button
              variant="secondary"
              size="phone"
              disabled={busy}
              onClick={onEdit}
              data-testid={`edit-${handle}`}
            >
              <Pencil aria-hidden size={16} />
              Edit
            </Button>
          ) : undefined
        }
      >
        <Card className="space-y-3 p-3">
          {/*
            Every fact is a tile, a caption over a value, so the card reads as
            one grid rather than lines of one kind and boxes of another (owner,
            2026-09-26). The short pair leads, the address takes a row of its
            own because it wraps, then the two times.
          */}
          <dl className="grid grid-cols-2 gap-2">
            <Tile icon={Tag} caption="Location">
              {outlet.location_label}
            </Tile>
            <Tile icon={Phone} caption="Phone">
              {outlet.phone?.trim() || <span className="font-normal text-content-muted">None</span>}
            </Tile>
            <Tile icon={MapPin} caption="Address" wide>
              {address || <span className="font-normal text-content-muted">None</span>}
            </Tile>
            {/*
              The address a table's QR code carries, shown as the address itself
              rather than behind a "view" link: the owner asked to see which
              public address belongs to which outlet at a glance
              (the-menu-is-public, design D1).
            */}
            <Tile
              icon={QrCode}
              caption="Public menu"
              wide
              trailing={<CopyAddress url={publicMenuLink(outlet.menu_slug)} handle={handle} />}
            >
              <a
                href={publicMenuLink(outlet.menu_slug) ?? undefined}
                target="_blank"
                rel="noreferrer"
                data-testid={`public-menu-${handle}`}
                className="rounded-sm text-accent-text underline underline-offset-2 focus-visible:focus-ring"
              >
                {publicMenuHost()}
                {outlet.menu_slug}/
              </a>
            </Tile>
            <Tile icon={Moon} caption="Day ends">
              {toTimeInput(outlet.business_day_cutover)}
            </Tile>
            <Tile icon={Clock} caption="Staff check in by">
              {toTimeInput(outlet.arrival_deadline)}
            </Tile>
          </dl>

          {/*
            The position in a tile of its own, with its button **inside** that
            tile: it is not what Edit changes (a position is captured standing at
            the counter), and the button must sit with the value it retakes
            rather than at the far edge of the card (owner, 2026-09-26).
          */}
          <div
            data-testid={`location-${handle}`}
            className={cn(
              'flex items-center justify-between gap-3 rounded-lg px-3 py-2',
              surveyed ? 'bg-surface-raised' : 'border border-warning bg-surface-raised',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              {surveyed ? (
                <LocateFixed aria-hidden size={18} className="shrink-0 text-success" />
              ) : (
                <MapPinOff aria-hidden size={18} className="shrink-0 text-warning" />
              )}
              <div className="min-w-0">
                <p className="text-xs text-content-muted">Check-in fence</p>
                {surveyed ? (
                  <p className="text-sm font-semibold text-content">
                    {formatMetres(outlet.geofence_radius_m)}
                    {outlet.location_accuracy_m !== null && (
                      <span className="font-normal text-content-muted">
                        {' '}
                        · ±{formatMetres(outlet.location_accuracy_m)}
                      </span>
                    )}
                  </p>
                ) : (
                  <p
                    className="text-sm font-semibold text-content"
                    data-testid={`uncaptured-${handle}`}
                  >
                    Not captured
                  </p>
                )}
              </div>
            </div>
            {mayWrite && outlet.is_active && (
              <Button
                variant={surveyed ? 'secondary' : 'primary'}
                size="phone"
                onClick={onCapture}
                data-testid={`capture-${handle}`}
              >
                <Crosshair aria-hidden size={16} />
                {surveyed ? 'Recapture' : 'Capture'}
              </Button>
            )}
          </div>
        </Card>
      </OutletSection>

      {children}

      {mayWrite && (
        <div className="flex flex-wrap justify-center gap-2" data-testid={`closing-${handle}`}>
          {outlet.is_active ? (
            <DangerButton disabled={busy} onClick={onClose} testId={`close-${handle}`}>
              Mark closed
            </DangerButton>
          ) : (
            <>
              <DangerButton disabled={busy} onClick={onDelete} testId={`delete-${handle}`}>
                Delete outlet
              </DangerButton>
              <Button
                variant="primary"
                size="phone"
                disabled={busy}
                onClick={onReopen}
                data-testid={`reopen-${handle}`}
              >
                Reopen
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Copies an outlet's public menu address, the one its table QR codes carry.
 *
 * The whole URL, not the shortened text the tile shows. Where the device cannot
 * copy — clipboard access is unavailable on an ordinary HTTP tablet — the
 * address on the tile is **selected** instead and nothing claims a copy, the
 * same honesty the receipt share keeps (`useShareLink`).
 */
function CopyAddress({ url, handle }: { url: string | null; handle: string }) {
  const [copied, setCopied] = useState(false)
  if (!url) return null

  async function copy() {
    const clipboard = window.navigator.clipboard as Clipboard | undefined
    if (clipboard) {
      try {
        await clipboard.writeText(url!)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
        return
      } catch {
        // Falls through to selecting it.
      }
    }
    const shown = document.querySelector(`[data-testid="public-menu-${handle}"]`)
    const selection = window.getSelection()
    if (shown && selection) selection.selectAllChildren(shown)
  }

  return (
    <>
      <Button
        variant="secondary"
        size="phone"
        onClick={() => void copy()}
        aria-label={copied ? 'Public menu address copied' : 'Copy public menu address'}
        data-testid={`copy-public-menu-${handle}`}
      >
        {copied ? <Check aria-hidden size={16} /> : <Copy aria-hidden size={16} />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Public menu address copied.' : ''}
      </span>
    </>
  )
}

/** A caption over a value: every fact on the Details card. */
function Tile({
  icon: Icon,
  caption,
  wide,
  trailing,
  children,
}: {
  icon: typeof MapPin
  caption: string
  /** Takes the whole row, for a value that wraps. */
  wide?: boolean
  /** A control at the tile's right edge, as the fence tile carries Recapture. */
  trailing?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-lg bg-surface-raised px-3 py-2',
        wide && 'col-span-2',
      )}
    >
      <Icon aria-hidden size={18} className="shrink-0 text-accent-text" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-content-muted">{caption}</dt>
        <dd className="break-words text-sm font-semibold text-content">{children}</dd>
      </div>
      {trailing}
    </div>
  )
}

/** Outlined in the danger colour: visible, and never mistaken for a routine action. */
function DangerButton({
  disabled,
  onClick,
  testId,
  children,
}: {
  disabled: boolean
  onClick: () => void
  testId: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(buttonVariants({ variant: 'secondary', size: 'phone' }), DANGER_OUTLINE)}
    >
      {children}
    </button>
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
              set({ code: event.target.value })
            }}
          />
          <p className="text-xs text-content-muted">
            How you refer to this shop in a sentence. It has to be different from every other
            outlet&rsquo;s.
          </p>
        </Field>

        {/*
          Optional, and blank means something different on each path: on create
          the database derives it from the name (shown as the placeholder, so the
          owner sees what they will get), and on edit a blank keeps the address
          the outlet already has — clearing a field must never un-publish a menu
          whose QR codes are on the tables (the-menu-is-public, design D1).
        */}
        <Field label="Public menu address" id="outlet-menu-slug">
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-sm text-content-muted">{publicMenuHost()}</span>
            <Input
              id="outlet-menu-slug"
              autoCapitalize="none"
              spellCheck={false}
              value={draft.menuSlug}
              placeholder={menuSlugFrom(draft.name) || 'e.g. kalyani-cafe'}
              onChange={(event) => set({ menuSlug: event.target.value })}
            />
          </div>
          <p className="text-xs text-content-muted">
            {editing
              ? 'Where this outlet’s menu is published. Printed QR codes point here, so changing it stops them working.'
              : 'Where this outlet’s menu will be published. Leave it blank to use the one made from the name.'}
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

        {/*
          Not "The business day starts at". That label reads as an opening
          time, and a real outlet was set up with its opening time here — which
          files the morning's prep under yesterday. The label now names the
          seam, and the preview below shows the chosen value working rather
          than asking anyone to picture it.
        */}
        <Field label="The day rolls over at" id="outlet-cutover">
          <Input
            id="outlet-cutover"
            type="time"
            required
            value={draft.businessDayCutover}
            onChange={(event) => set({ businessDayCutover: event.target.value })}
          />
          <p className="text-xs text-content-muted">
            Not the opening time. This is where one day&rsquo;s trading ends and the next begins, so
            it belongs in the quiet hours while the counter is shut — anywhere between{' '}
            {QUIET_HOURS_FROM} and {QUIET_HOURS_UNTIL} keeps a night&rsquo;s work together.
          </p>
          <CutoverPreview cutover={draft.businessDayCutover} />
          <p className="text-xs text-content-muted">
            Changing it never moves anything already recorded — each day is stamped when it happens,
            not worked out afterwards.
          </p>
        </Field>

        {/*
          The other per-outlet fact about when a day works, and it sits beside
          the cutover because the two are read together: the deadline is a time
          within the business day the cutover defines.
        */}
        <Field label="Staff are expected by" id="outlet-arrival-deadline">
          <Input
            id="outlet-arrival-deadline"
            type="time"
            required
            value={draft.arrivalDeadline}
            onChange={(event) => set({ arrivalDeadline: event.target.value })}
          />
          <p className="text-xs text-content-muted">
            An arrival after this reads as late wherever attendance is shown, and somebody with no
            arrival at all reads as absent once it passes. It is a tag and a reading, never a
            deduction — what a late day is worth stays the manager&rsquo;s call.
          </p>
          <p className="text-xs text-content-muted">
            Changing it applies to arrivals from then on. Every day already recorded keeps the
            deadline it was recorded under, so nothing already judged changes between late and on
            time.
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

/**
 * The chosen cutover, run against one trading session and shown landing.
 *
 * Prose about "after midnight but before this time" only reads correctly to
 * someone who already picked an early-morning value; it stays silent for
 * exactly the person who picked a daytime one. So this argues from the
 * arithmetic instead: four moments from a single night, each labelled with the
 * business day it would be filed under, updating as the field is scrubbed.
 * When they do not all agree, the value is wrong and the panel says so.
 */
function CutoverPreview({ cutover }: { cutover: string }) {
  // A `type="time"` input is either empty or a full HH:MM — never half-typed.
  const advice = useMemo(
    () => (/^\d{2}:\d{2}/.test(cutover) ? describeCutover(cutover) : null),
    [cutover],
  )
  if (!advice) return null

  return (
    <div
      data-testid="cutover-preview"
      className={cn(
        'space-y-2 rounded-lg border bg-surface-raised p-2 text-xs',
        advice.splits ? 'border-warning' : 'border-border',
      )}
    >
      <p className="text-content">
        A business day then runs{' '}
        <strong className="font-semibold">
          {advice.startsAt} to {advice.endsAt}
        </strong>{' '}
        {advice.endsNextDay ? 'the next day' : 'the same day'}.
      </p>
      <p className="text-content-muted">
        A counter opening late morning and shutting after midnight would file:
      </p>
      <ul className="space-y-0.5">
        {advice.session.map((moment) => (
          <li key={moment.label} className="flex items-baseline justify-between gap-3">
            <span className="text-content-muted">
              {moment.label}, {moment.at}
              {moment.afterMidnight && ' (after midnight)'}
            </span>
            <span
              className={cn(
                'shrink-0',
                moment.filedUnder === 'the day itself'
                  ? 'text-content-muted'
                  : 'font-semibold text-warning',
              )}
            >
              {moment.filedUnder}
            </span>
          </li>
        ))}
      </ul>
      {advice.splits && (
        <p
          data-testid="cutover-warning"
          className="flex items-start gap-2 border-t border-border pt-2 text-content"
        >
          <TriangleAlert aria-hidden size={14} className="mt-0.5 shrink-0 text-warning" />
          <span>
            One night&rsquo;s trading would be split across two business days, so no cash count or
            day total for that night can add up the way anyone standing at the counter saw it.
          </span>
        </p>
      )}
    </div>
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
