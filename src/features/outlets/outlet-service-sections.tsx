import {
  Hash,
  IndianRupee,
  LoaderCircle,
  ShoppingBag,
  UtensilsCrossed,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { MemberMark } from '@/components/ui/member-mark'
import { Switch } from '@/components/ui/switch'
import { useAdapters } from '@/data-access'
import { DataActionError } from '@/data-access/adapters'
import {
  formatPaise,
  ordersOffered,
  SERVICE_SETTINGS_PROBLEM_MESSAGES,
  serviceSettingsProblem,
  withOrdersSwitched,
  withPackagingSwitched,
  type OutletServiceSettings,
  type PackagingMode,
} from '@/domain'
import { OutletSection } from '@/features/outlets/outlet-section'
import {
  useOutletSettingsLink,
  usePublishGoldPackaging,
} from '@/features/outlets/outlet-settings-link-context'
import { cn } from '@/lib/cn'
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion'

/**
 * How an outlet serves: its **Orders** section (each-outlet-chooses-how-it-serves,
 * #60), between Details and Tablets on the outlet's page.
 *
 * **The page grows as the shop does.** An outlet setting itself up sees one
 * service switch plus the independent customer-collection switch. A setting's
 * own options open **inside** its tile
 * while it is on and fold away when it is off, each level on the other of the
 * two surface tones from the one it sits in, so what belongs to what reads from
 * the shape rather than from indentation [owner, 2026-09-27]. Tiles rather than
 * sentences, like Details (outlets-one-at-a-time, D2 and D3).
 *
 * **Packaging lives inside Takeaway** [owner, 2026-09-27]: it is charged on
 * takeaway orders and nothing else, so it is offered only while takeaway is.
 *
 * **Save writes the whole section, and appears only once something changed.**
 * A switch shapes a draft rather than writing: turning packaging on needs a
 * price the owner types, and a half-set section is a combination the database
 * refuses.
 *
 * The owner changes these for any outlet, and a manager for the outlets they
 * manage [owner, 2026-09-27]; the page does not open for any other. The
 * read-only rendering below stays for a reader who may see the page and not
 * write — nobody today — rather than guessing at what such a reader should get.
 */
export function OutletServiceSections({
  outletId,
  mayWrite,
  goldOffered = true,
}: {
  outletId: string
  /** Whether to offer the controls. The database is what refuses the write. */
  mayWrite: boolean
  /**
   * Whether this outlet has gold members (a-regular-earns-points-and-gold). An
   * outlet without them shows no *Free for gold members* [owner, 2026-09-29].
   */
  goldOffered?: boolean
}) {
  const { outlets } = useAdapters()
  const [stored, setStored] = useState<OutletServiceSettings | null>(null)
  const [readFor, setReadFor] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void outlets
      .getServiceSettings(outletId)
      .then((settings) => {
        if (!active) return
        setStored(settings)
        setReadFor(outletId)
        setFailed(false)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [outlets, outletId])

  const shown = readFor === outletId ? stored : null

  if (failed && shown === null) {
    return (
      <p role="alert" className="text-sm font-semibold text-danger" data-testid="service-failed">
        How this outlet serves could not be read. Try again in a moment.
      </p>
    )
  }

  if (shown === null) {
    return (
      <LoadingRegion
        label="how this outlet serves"
        className="space-y-4"
        data-testid="service-loading"
      >
        <OutletServiceShimmer />
      </LoadingRegion>
    )
  }

  if (!mayWrite) {
    return <ReadOnlyOrders outletId={outletId} stored={shown} goldOffered={goldOffered} />
  }

  return (
    <OrdersSection
      // Not remounted on save: the section stays to say it saved, and takes
      // what was stored back into its own draft.
      key={outletId}
      outletId={outletId}
      stored={shown}
      goldOffered={goldOffered}
      onSave={async (next) => {
        const saved = await outlets.updateServiceSettings(outletId, next)
        setStored(saved)
        return saved
      }}
    />
  )
}

/**
 * The section as a newcomer's page draws it — a label over a card holding one
 * service switch plus customer collection — at its rendered height. Also drawn
 * by the outlet page's own
 * placeholder, so the page does not reflow when this arrives.
 */
export function OutletServiceShimmer() {
  return (
    <div className="space-y-2">
      <Shimmer className="h-10 w-24" />
      <Shimmer className="h-[calc(11rem+2px)]" />
    </div>
  )
}

function settingsKey(s: OutletServiceSettings): string {
  return [
    s.collectCustomerDetails,
    s.dineInOffered,
    s.takeawayOffered,
    s.tableNumbers,
    s.packagingMode,
    s.packagingPricePaise,
    s.packagingFreeForGold,
  ].join(':')
}

/** Digits only, as a whole number, or null while nothing usable is typed. */
function wholeNumber(text: string): number | null {
  return /^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : null
}

function refusalMessage(cause: unknown): string {
  return cause instanceof DataActionError ? cause.message : 'That could not be saved. Try again.'
}

function offeredWords(settings: OutletServiceSettings): string {
  return [settings.dineInOffered && 'Dine-in', settings.takeawayOffered && 'Takeaway']
    .filter(Boolean)
    .join(' and ')
}

function packagingWords(settings: OutletServiceSettings): string {
  if (settings.packagingMode === 'off' || settings.packagingPricePaise === null) return 'Off'
  const per = settings.packagingMode === 'per_bag' ? 'per bag' : 'per order'
  return `${formatPaise(settings.packagingPricePaise)} ${per}`
}

// ─────────────────────────────────────────────────────────────────────────────
// The owner's section

function OrdersSection({
  outletId,
  stored,
  goldOffered,
  onSave,
}: {
  outletId: string
  stored: OutletServiceSettings
  goldOffered: boolean
  /** Resolves with what the database stored. */
  onSave: (next: OutletServiceSettings) => Promise<OutletServiceSettings>
}) {
  const [draft, setDraft] = useState(stored)
  // Typed separately from the draft, so an empty or half-typed box is not a
  // number the draft has to pretend to hold.
  const [priceText, setPriceText] = useState(
    stored.packagingPricePaise === null ? '' : String(stored.packagingPricePaise / 100),
  )
  const [error, setError] = useState<string | null>(null)
  /*
    The Save bar's own story after the tap: writing, then the outcome held long
    enough to read, then folding away. `settling` is the fold, with the outcome
    still showing inside it, so nothing changes words while it moves.
  */
  const [phase, setPhase] = useState<SavePhase>('idle')
  const busy = phase === 'saving'
  const reduceMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (phase === 'saved') {
      const timer = window.setTimeout(() => setPhase('settling'), SAVED_HOLD_MS)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'settling') {
      const timer = window.setTimeout(() => setPhase('idle'), reduceMotion ? 0 : SETTLE_MS)
      return () => window.clearTimeout(timer)
    }
  }, [phase, reduceMotion])

  const on = ordersOffered(draft)
  const packagingOn = draft.takeawayOffered && draft.packagingMode !== 'off'
  const rupees = wholeNumber(priceText)
  const next: OutletServiceSettings = {
    collectCustomerDetails: draft.collectCustomerDetails,
    dineInOffered: draft.dineInOffered,
    takeawayOffered: draft.takeawayOffered,
    tableNumbers: draft.dineInOffered && draft.tableNumbers,
    packagingMode: packagingOn ? draft.packagingMode : 'off',
    packagingPricePaise: packagingOn && rupees !== null ? rupees * 100 : null,
    packagingFreeForGold: packagingOn && draft.packagingFreeForGold,
  }
  const dirty = settingsKey(next) !== settingsKey(stored) || (packagingOn && rupees === null)
  const id = `orders-${outletId}`
  const priceCaption = draft.packagingMode === 'per_bag' ? 'Price per bag' : 'Charge per order'

  function change(update: Partial<OutletServiceSettings> | OutletServiceSettings) {
    setDraft((current) => ({ ...current, ...update }))
    setError(null)
  }

  /** Resolves false when nothing was saved, with the reason shown here. */
  async function submit(): Promise<boolean> {
    const problem = serviceSettingsProblem(next)
    if (problem !== null) {
      setError(SERVICE_SETTINGS_PROBLEM_MESSAGES[problem])
      return false
    }
    setPhase('saving')
    setError(null)
    try {
      const saved = await onSave(next)
      // What the database answered, not what was sent: the two agree today,
      // and the day they do not, the page shows the truth.
      resetTo(saved)
      setPhase('saved')
      return true
    } catch (cause) {
      setError(refusalMessage(cause))
      setPhase('idle')
      return false
    }
  }

  /*
    *Free for gold members* is also shown under Loyalty's Gold members
    [owner, 2026-09-29]: one value, edited in this draft from either place, and
    saved by either Save. And it shows here only while the outlet has gold, as
    Loyalty's switch stands right now.
  */
  const link = useOutletSettingsLink()
  const goldShown = link?.goldOn ?? goldOffered
  usePublishGoldPackaging({
    available: packagingOn,
    value: packagingOn && draft.packagingFreeForGold,
    dirty,
    set: (value) => change({ packagingFreeForGold: value }),
    save: submit,
  })

  function resetTo(settings: OutletServiceSettings) {
    setDraft(settings)
    setPriceText(
      settings.packagingPricePaise === null ? '' : String(settings.packagingPricePaise / 100),
    )
  }

  function cancel() {
    resetTo(stored)
    setError(null)
  }

  return (
    <OutletSection id={id} title="Orders" data-testid="service-orders">
      <Card
        className={cn(
          'space-y-2 p-3',
          // One breath of the brand's own orange around the whole card, fading to its own edge: the
          // settings the owner is looking at are the ones that were kept.
          phase === 'saved' && 'motion-safe:animate-[saved-glow_1.6s_ease-out]',
        )}
        data-saved={phase === 'saved' || undefined}
      >
        <SettingTile
          depth={1}
          icon={UserRound}
          caption="Collect customer details"
          hint="Number for receipts and points"
          control={
            <Switch
              checked={draft.collectCustomerDetails}
              label="Collect customer details"
              testId="service-customers-switch"
              disabled={busy}
              onChange={(value) => change({ collectCustomerDetails: value })}
            />
          }
        />
        <SettingTile
          depth={1}
          icon={UtensilsCrossed}
          caption="Dine-in and takeaway"
          hint={on ? undefined : 'Mark each order where the food goes'}
          control={
            <Switch
              checked={on}
              label="Dine-in and takeaway"
              testId="service-orders-switch"
              disabled={busy}
              onChange={(value) => {
                change(withOrdersSwitched(draft, value))
                setPriceText('')
              }}
            />
          }
        >
          {on && (
            <>
              <SettingTile
                depth={2}
                icon={UtensilsCrossed}
                caption="Offer"
                hint="At least one"
                stacked
                control={
                  <Segmented
                    label="Order types offered"
                    options={[
                      { value: 'dine_in', label: 'Dine-in', on: draft.dineInOffered },
                      { value: 'takeaway', label: 'Takeaway', on: draft.takeawayOffered },
                    ]}
                    disabled={busy}
                    testId="service-offer"
                    onToggle={(value) => {
                      const dineIn =
                        value === 'dine_in' ? !draft.dineInOffered : draft.dineInOffered
                      const takeaway =
                        value === 'takeaway' ? !draft.takeawayOffered : draft.takeawayOffered
                      // One type stays offered while Orders is on: turning both
                      // off is what the section's own switch is for.
                      if (!dineIn && !takeaway) return
                      change({
                        dineInOffered: dineIn,
                        takeawayOffered: takeaway,
                        // Tables go with dine-in, so offering it again starts
                        // them off rather than bringing back an answer nobody
                        // could see.
                        tableNumbers: dineIn && draft.tableNumbers,
                        // Packaging belongs to takeaway, and goes with it.
                        ...(!takeaway && {
                          packagingMode: 'off' as const,
                          packagingPricePaise: null,
                          packagingFreeForGold: false,
                        }),
                      })
                      if (!takeaway) setPriceText('')
                    }}
                  />
                }
              />

              {draft.dineInOffered && (
                <SettingTile
                  depth={2}
                  icon={Hash}
                  caption="Table numbers"
                  // Any number the biller keys, 1 to 999: no count to keep up to
                  // date as the floor changes [owner, 2026-09-27].
                  hint="Dine-in orders are keyed a table"
                  control={
                    <Switch
                      checked={draft.tableNumbers}
                      label="Table numbers"
                      testId="service-tables-switch"
                      disabled={busy}
                      onChange={(value) => change({ tableNumbers: value })}
                    />
                  }
                />
              )}

              {draft.takeawayOffered && (
                <SettingTile
                  depth={2}
                  icon={ShoppingBag}
                  caption="Packaging charge"
                  hint="On takeaway orders"
                  control={
                    <Switch
                      checked={packagingOn}
                      label="Packaging charge"
                      testId="service-packaging-switch"
                      disabled={busy}
                      onChange={(value) => {
                        change(withPackagingSwitched(draft, value))
                        setPriceText('')
                      }}
                    />
                  }
                >
                  {packagingOn && (
                    <>
                      <SettingTile
                        depth={3}
                        icon={ShoppingBag}
                        caption="Charge by"
                        stacked
                        control={
                          <Segmented
                            label="Charge packaging by"
                            single
                            // Flat first, and the default [owner, 2026-09-27].
                            options={(
                              [
                                ['per_order', 'Flat per order'],
                                ['per_bag', 'Per bag'],
                              ] as const
                            ).map(([value, label]) => ({
                              value,
                              label,
                              on: draft.packagingMode === value,
                            }))}
                            disabled={busy}
                            testId="service-charge-by"
                            onToggle={(value) => change({ packagingMode: value as PackagingMode })}
                          />
                        }
                      />
                      <SettingTile
                        depth={3}
                        icon={IndianRupee}
                        caption={priceCaption}
                        hint="Whole rupees"
                        control={
                          <NumberBox
                            id={`${id}-price`}
                            label={priceCaption}
                            prefix="₹"
                            value={priceText}
                            onChange={(value) => {
                              setPriceText(value)
                              setError(null)
                            }}
                            testId="service-packaging-price"
                            disabled={busy}
                          />
                        }
                      />
                      {goldShown && (
                        <SettingTile
                          depth={3}
                          icon={MemberMark}
                          caption="Free for gold members"
                          control={
                            <Switch
                              checked={draft.packagingFreeForGold}
                              label="Free for gold members"
                              testId="service-gold-free"
                              disabled={busy}
                              onChange={(value) => change({ packagingFreeForGold: value })}
                            />
                          }
                        />
                      )}
                    </>
                  )}
                </SettingTile>
              )}
            </>
          )}
        </SettingTile>

        <SaveBar
          dirty={dirty}
          phase={phase}
          error={error}
          onSave={() => void submit()}
          onCancel={cancel}
        />
      </Card>
    </OutletSection>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The manager's section

/** The same tiles and nesting, each answer where the control would be. */
function ReadOnlyOrders({
  outletId,
  stored,
  goldOffered,
}: {
  outletId: string
  stored: OutletServiceSettings
  goldOffered: boolean
}) {
  const on = ordersOffered(stored)
  return (
    <OutletSection id={`orders-${outletId}`} title="Orders" data-testid="service-orders">
      <Card className="space-y-2 p-3">
        <SettingTile
          depth={1}
          icon={UserRound}
          caption="Collect customer details"
          control={<Answer>{stored.collectCustomerDetails ? 'On' : 'Off'}</Answer>}
        />
        <SettingTile
          depth={1}
          icon={UtensilsCrossed}
          caption="Dine-in and takeaway"
          control={<Answer>{on ? offeredWords(stored) : 'Off'}</Answer>}
        >
          {on && (
            <>
              {stored.dineInOffered && (
                <SettingTile
                  depth={2}
                  icon={Hash}
                  caption="Table numbers"
                  control={<Answer>{stored.tableNumbers ? 'On' : 'Off'}</Answer>}
                />
              )}
              {stored.takeawayOffered && (
                <SettingTile
                  depth={2}
                  icon={ShoppingBag}
                  caption="Packaging charge"
                  control={<Answer>{packagingWords(stored)}</Answer>}
                >
                  {stored.packagingMode !== 'off' && goldOffered && (
                    <SettingTile
                      depth={3}
                      icon={MemberMark}
                      caption="Gold members"
                      control={<Answer>{stored.packagingFreeForGold ? 'Free' : 'Charged'}</Answer>}
                    />
                  )}
                </SettingTile>
              )}
            </>
          )}
        </SettingTile>
      </Card>
    </OutletSection>
  )
}

export function Answer({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-right text-sm font-semibold text-content">{children}</span>
}

// ─────────────────────────────────────────────────────────────────────────────
// Parts

/**
 * The two surface tones, alternating by depth: a tile on the card is raised, a
 * tile inside it is the card's own tone again, and a tile inside that is raised
 * once more. Both are grounds the contrast validator already gates text on.
 */
const DEPTH_TONE: Record<1 | 2 | 3, string> = {
  1: 'bg-surface-raised',
  2: 'bg-surface',
  3: 'bg-surface-raised',
}

/**
 * One setting as a tile: its icon and caption, its control on the right — or,
 * `stacked`, beneath, for a control too wide to share a phone's row — and, as
 * children, the options that belong to it, **inside** the tile.
 */
export function SettingTile({
  depth,
  icon: Icon,
  caption,
  hint,
  stacked,
  control,
  children,
}: {
  depth: 1 | 2 | 3
  icon: LucideIcon | typeof MemberMark
  caption: string
  hint?: string | undefined
  stacked?: boolean
  control: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={cn('rounded-lg px-3 py-2', DEPTH_TONE[depth])} data-depth={depth}>
      <div
        className={cn(stacked ? 'space-y-2' : 'flex min-h-14 items-center justify-between gap-3')}
      >
        <div className="flex min-w-0 items-center gap-2">
          <TileIcon icon={Icon} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-content">{caption}</p>
            {hint && <p className="text-xs text-content-muted">{hint}</p>}
          </div>
        </div>
        {control}
      </div>
      {children && <div className="space-y-2 pb-1 pt-1">{children}</div>}
    </div>
  )
}

function TileIcon({ icon: Icon }: { icon: LucideIcon | typeof MemberMark }) {
  // The gold star is its own mark and keeps its own colours; every other icon
  // takes the accent the Details tiles use.
  if (Icon === MemberMark) return <MemberMark className="shrink-0" />
  const Lucide = Icon as LucideIcon
  return <Lucide aria-hidden size={18} className="shrink-0 text-accent-text" />
}

/** Two choices as one row of toggle buttons. */
export function Segmented({
  label,
  options,
  single,
  disabled,
  testId,
  onToggle,
}: {
  label: string
  options: { value: string; label: string; on: boolean }[]
  /** Exactly one is chosen, and tapping the chosen one keeps it. */
  single?: boolean
  disabled: boolean
  testId: string
  onToggle: (value: string) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.on}
          disabled={disabled}
          data-testid={`${testId}-${option.value}`}
          onClick={() => {
            if (single && option.on) return
            onToggle(option.value)
          }}
          className={cn(
            'flex h-[var(--size-control-phone)] items-center justify-center rounded-lg px-2 text-sm font-semibold',
            'focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-50',
            option.on
              ? 'bg-primary text-on-primary'
              : 'text-content-muted hover:bg-surface-raised hover:text-content',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** A short whole-number box, with an optional unit in front of it. */
export function NumberBox({
  id,
  label,
  prefix,
  value,
  onChange,
  disabled,
  testId,
  suffix,
  compact = false,
  decimal = false,
}: {
  id: string
  label: string
  prefix?: string
  /** A unit after the box, such as `%`. */
  suffix?: string
  /**
   * Sized to the text around it rather than to a thumb: a short box in a
   * sentence, like `[5] points for every ₹ [200]` [owner, 2026-09-29].
   */
  compact?: boolean
  /** Takes one decimal point and two places, for a multiplier like `1.5`. */
  decimal?: boolean
  value: string
  onChange: (value: string) => void
  disabled: boolean
  testId: string
}) {
  return (
    <label
      htmlFor={id}
      className={cn('flex shrink-0 items-center gap-1 text-content', compact && 'text-sm')}
    >
      {prefix && <span className="font-semibold">{prefix}</span>}
      <input
        id={id}
        aria-label={label}
        inputMode={decimal ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={value}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) =>
          onChange(
            decimal
              ? (event.target.value.replace(/[^\d.]/g, '').match(/^\d{0,2}(\.\d{0,2})?/)?.[0] ?? '')
              : event.target.value.replace(/\D/g, '').slice(0, 5),
          )
        }
        className={cn(
          'rounded-lg border border-border bg-surface text-right tabular-nums',
          compact
            ? 'h-9 w-16 px-2 text-sm font-semibold'
            : 'h-[var(--size-control-phone)] w-20 px-3',
          'focus-visible:focus-ring disabled:opacity-50',
        )}
      />
      {suffix && <span className="font-semibold">{suffix}</span>}
    </label>
  )
}

export type SavePhase = 'idle' | 'saving' | 'saved' | 'settling'

/** How long *Saved* is held before the bar folds away: long enough to read. */
export const SAVED_HOLD_MS = 1400
/** The fold itself, matched to the transition below. */
export const SETTLE_MS = 300

/**
 * Save and Cancel, shown only once the section differs from what is stored —
 * and, after a save, the outcome in their place [owner, 2026-09-27].
 *
 * **The button that was tapped answers.** Save turns into a spinner while the
 * write is out, then Cancel goes and Save becomes *✓ Saved* as a quiet, secondary-styled
 * statement in the accent orange [owner, 2026-09-27]: not green, which read as
 * out of theme, and not a filled button, which read as one to press again, the tick
 * drawing itself in: the confirmation lands exactly where the owner's eye and
 * thumb already are, and says what happened rather than only that something
 * did. Held for a moment, it folds away and the card settles to its new height
 * instead of jumping. Screen readers hear *Orders saved*.
 *
 * Touching any setting while it shows brings Save and Cancel straight back:
 * the draft differing from what is stored always wins. Under reduced motion
 * there is no drawing, popping or folding — the words alone, for the same
 * moment.
 */
export function SaveBar({
  dirty,
  phase,
  error,
  onSave,
  onCancel,
  name = 'Orders',
  testPrefix = 'service',
}: {
  dirty: boolean
  phase: SavePhase
  error: string | null
  onSave: () => void
  onCancel: () => void
  /** The section, as a screen reader hears it saved: `Orders saved`. */
  name?: string
  /** Where this bar's test ids start, so two sections on one page keep their own. */
  testPrefix?: string
}) {
  const saving = phase === 'saving'
  const showSaved = !dirty && (phase === 'saved' || phase === 'settling')
  const open = dirty || saving || phase === 'saved' || error !== null

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {phase === 'saved' ? `${name} saved.` : ''}
      </p>
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
        data-testid={`${testPrefix}-save-bar`}
        data-open={open || undefined}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-2 pt-1">
            {error && (
              <p
                role="alert"
                className="text-sm font-semibold text-danger"
                data-testid={`${testPrefix}-error`}
              >
                {error}
              </p>
            )}
            {showSaved ? (
              <div className="flex justify-end">
                <span
                  data-testid={`${testPrefix}-saved`}
                  className="inline-flex h-[var(--size-control-phone)] items-center gap-1.5 rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-accent-text motion-safe:animate-[saved-pop_220ms_ease-out]"
                >
                  <DrawnTick />
                  Saved
                </span>
              </div>
            ) : (
              (dirty || saving) && (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="phone"
                    disabled={saving}
                    onClick={onCancel}
                    data-testid={`${testPrefix}-cancel`}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="phone"
                    disabled={saving}
                    onClick={onSave}
                    data-testid={`${testPrefix}-save`}
                    aria-busy={saving || undefined}
                  >
                    {saving && (
                      <LoaderCircle aria-hidden size={16} className="motion-safe:animate-spin" />
                    )}
                    {saving ? 'Saving' : 'Save'}
                  </Button>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * A tick that draws itself, once. Its resting state is drawn, so a tab with no
 * animation frame still shows a whole tick.
 */
function DrawnTick() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        pathLength={1}
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={1}
        className="motion-safe:animate-[tick-draw_360ms_ease-out_120ms_both]"
      />
    </svg>
  )
}
