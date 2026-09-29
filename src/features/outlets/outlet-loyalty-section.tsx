import { CalendarClock, Coins, Percent, ShoppingBag, Sparkles, UserRoundCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { Card } from '@/components/ui/card'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { MemberMark } from '@/components/ui/member-mark'
import { Switch } from '@/components/ui/switch'
import { useAdapters } from '@/data-access'
import { DataActionError } from '@/data-access/adapters'
import {
  DEFAULT_GOLD_THRESHOLD_PAISE,
  DEFAULT_GOLD_USE_CAP_BP,
  DEFAULT_POINTS_RULES,
  GOLD_WINDOW_DAYS,
  LOYALTY_SETTINGS_PROBLEM_MESSAGES,
  loyaltySettingsProblem,
  multiplierLabel,
  type OutletLoyaltySettings,
} from '@/domain'
import { OutletSection } from '@/features/outlets/outlet-section'
import {
  Answer,
  NumberBox,
  SAVED_HOLD_MS,
  SaveBar,
  SETTLE_MS,
  SettingTile,
  type SavePhase,
} from '@/features/outlets/outlet-service-sections'
import {
  useOutletSettingsLink,
  usePublishGoldOn,
} from '@/features/outlets/outlet-settings-link-context'
import { cn } from '@/lib/cn'
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion'

/**
 * An outlet's points and gold: its **Loyalty** section
 * (a-regular-earns-points-and-gold, #62), beside Orders on the outlet's page and
 * built the same way — a switch per idea, each setting's options inside its own
 * tile, and one Save for the section.
 *
 * ```
 * LOYALTY
 * ┌ Points                                              [ on ] ┐
 * │ ┌ Earn            [5] points for every ₹ [200]             ┐│
 * │ ┌ Max points discount                            [10] %    ┐│
 * │ ┌ Max for gold members                           [50] %    ┐│  gold on
 * │ ┌ Gold members points multiplier                 [1.5] ×   ┐│  gold on
 * ┌ Gold members                                        [ on ] ┐
 * │ ┌ Valid for                                   [6] months   ┐│
 * │ ┌ Allow billers to upgrade to Gold                  [ on ] ┐│
 * │ │ ┌ Gold eligibility                       ₹ [2000]        ┐│
 * ```
 *
 * **Gold is a switch of its own** [owner, 2026-09-29]: not every outlet has
 * gold members, and while it is off nothing about gold appears anywhere — not
 * here, not in Orders' packaging, not on the Customers page or at the counter.
 *
 * **Every number is this outlet's.** Points and gold belong to the outlet that
 * gives them, so the owner sets them for any outlet and a manager for the
 * outlets they manage [owner, 2026-09-28] — a manager's rules cost only their
 * own shop. An outlet starts with all of it off and bills exactly as before.
 */
export function OutletLoyaltySection({
  outletId,
  mayWrite,
  onSettings,
}: {
  outletId: string
  /** Whether to offer the controls. The database is what refuses the write. */
  mayWrite: boolean
  /**
   * What is stored, each time it is read or saved, so the page can hide every
   * gold option elsewhere while this outlet has no gold.
   */
  onSettings?: (settings: OutletLoyaltySettings) => void
}) {
  const { outlets } = useAdapters()
  const [stored, setStored] = useState<OutletLoyaltySettings | null>(null)
  const [readFor, setReadFor] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void outlets
      .getLoyaltySettings(outletId)
      .then((settings) => {
        if (!active) return
        setStored(settings)
        setReadFor(outletId)
        setFailed(false)
        onSettings?.(settings)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
    // `onSettings` is a report, not an input: re-reading on its identity would
    // loop through the page that passes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlets, outletId])

  const shown = readFor === outletId ? stored : null

  if (failed && shown === null) {
    return (
      <p role="alert" className="text-sm font-semibold text-danger" data-testid="loyalty-failed">
        This outlet&rsquo;s points and gold could not be read. Try again in a moment.
      </p>
    )
  }

  if (shown === null) {
    return (
      <LoadingRegion label="points and gold" className="space-y-4" data-testid="loyalty-loading">
        <OutletLoyaltyShimmer />
      </LoadingRegion>
    )
  }

  if (!mayWrite) return <ReadOnlyLoyalty outletId={outletId} stored={shown} />

  return (
    <LoyaltySection
      key={outletId}
      outletId={outletId}
      stored={shown}
      onSave={async (next) => {
        const saved = await outlets.updateLoyaltySettings(outletId, next)
        setStored(saved)
        onSettings?.(saved)
        return saved
      }}
    />
  )
}

/** The section as a newcomer's page draws it: a label over two one-switch tiles. */
export function OutletLoyaltyShimmer() {
  return (
    <div className="space-y-2">
      <Shimmer className="h-10 w-24" />
      <Shimmer className="h-[calc(10.25rem+2px)]" />
    </div>
  )
}

/** What the boxes hold while they are being typed in, as text. */
interface LoyaltyText {
  earnPoints: string
  earnRupees: string
  useCap: string
  goldUseCap: string
  multiplier: string
  durationMonths: string
  thresholdRupees: string
}

const text = (value: number | null, divide = 1) => (value === null ? '' : String(value / divide))

function textOf(settings: OutletLoyaltySettings): LoyaltyText {
  return {
    earnPoints: text(settings.earnPoints),
    earnRupees: text(settings.earnBlockPaise, 100),
    useCap: text(settings.useCapBp, 100),
    goldUseCap: text(settings.goldUseCapBp, 100),
    multiplier: text(settings.goldEarnMultiplierX100, 100),
    durationMonths: String(settings.goldDurationMonths),
    thresholdRupees: text(settings.goldThresholdPaise, 100),
  }
}

/** Digits only, as a whole number, or null while nothing usable is typed. */
function whole(value: string): number | null {
  return /^\d{1,6}$/.test(value.trim()) ? Number(value.trim()) : null
}

/** `1.5` as 150 hundredths, or null while nothing usable is typed. */
function hundredths(value: string): number | null {
  return /^\d{1,2}(\.\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value) * 100) : null
}

const times = (value: number | null, factor: number) => (value === null ? null : value * factor)

function LoyaltySection({
  outletId,
  stored,
  onSave,
}: {
  outletId: string
  stored: OutletLoyaltySettings
  onSave: (next: OutletLoyaltySettings) => Promise<OutletLoyaltySettings>
}) {
  const [pointsOn, setPointsOn] = useState(stored.pointsEnabled)
  const [goldOn, setGoldOn] = useState(stored.goldEnabled)
  const [counterGold, setCounterGold] = useState(stored.goldCounterGrant)
  const [typed, setTyped] = useState<LoyaltyText>(() => textOf(stored))
  const [error, setError] = useState<string | null>(null)
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

  /*
    What would be stored, built from the switches and the boxes. A box left
    blank is null, which the rules refuse with a sentence rather than the save
    quietly keeping the old number.
  */
  const counterOn = goldOn && counterGold
  const next: OutletLoyaltySettings = {
    pointsEnabled: pointsOn,
    earnPoints: pointsOn ? whole(typed.earnPoints) : null,
    earnBlockPaise: pointsOn ? times(whole(typed.earnRupees), 100) : null,
    useCapBp: pointsOn ? times(whole(typed.useCap), 100) : null,
    goldEnabled: goldOn,
    goldEarnMultiplierX100: goldOn
      ? (hundredths(typed.multiplier) ?? 0)
      : stored.goldEarnMultiplierX100,
    goldUseCapBp: pointsOn && goldOn ? times(whole(typed.goldUseCap), 100) : null,
    goldDurationMonths: goldOn ? (whole(typed.durationMonths) ?? 0) : stored.goldDurationMonths,
    goldCounterGrant: counterOn,
    goldThresholdPaise: counterOn ? times(whole(typed.thresholdRupees), 100) : null,
  }
  const ownDirty = JSON.stringify(next) !== JSON.stringify(stored)
  /*
    Orders' free-packaging switch, also shown under Gold members
    [owner, 2026-09-29]. Changing it here changes Orders' draft, so this Save
    saves Orders too: nobody should have to find a second Save a section up.
  */
  const packaging = useOutletSettingsLink()?.goldPackaging ?? null
  const dirty = ownDirty || (packaging?.dirty ?? false)
  usePublishGoldOn(goldOn)
  const id = `loyalty-${outletId}`

  function type(field: keyof LoyaltyText, value: string) {
    setTyped((current) => ({ ...current, [field]: value }))
    setError(null)
  }

  /** A box emptied by a switch going off starts on the owner's number when it comes back. */
  function fill(field: keyof LoyaltyText, value: string) {
    setTyped((current) => (current[field] === '' ? { ...current, [field]: value } : current))
  }

  function switchPoints(on: boolean) {
    setPointsOn(on)
    if (on) {
      fill('earnPoints', String(DEFAULT_POINTS_RULES.earnPoints))
      fill('earnRupees', String(DEFAULT_POINTS_RULES.earnBlockPaise / 100))
      fill('useCap', String(DEFAULT_POINTS_RULES.useCapBp / 100))
      fill('goldUseCap', String(DEFAULT_GOLD_USE_CAP_BP / 100))
    }
    setError(null)
  }

  function switchGold(on: boolean) {
    setGoldOn(on)
    if (on) fill('goldUseCap', String(DEFAULT_GOLD_USE_CAP_BP / 100))
    setError(null)
  }

  function switchCounterGold(on: boolean) {
    setCounterGold(on)
    if (on) fill('thresholdRupees', String(DEFAULT_GOLD_THRESHOLD_PAISE / 100))
    setError(null)
  }

  function resetTo(settings: OutletLoyaltySettings) {
    setPointsOn(settings.pointsEnabled)
    setGoldOn(settings.goldEnabled)
    setCounterGold(settings.goldCounterGrant)
    setTyped(textOf(settings))
  }

  async function submit() {
    const problem = ownDirty ? loyaltySettingsProblem(next) : null
    if (problem !== null) {
      setError(LOYALTY_SETTINGS_PROBLEM_MESSAGES[problem])
      return
    }
    setPhase('saving')
    setError(null)
    try {
      if (ownDirty) resetTo(await onSave(next))
      // Orders says why, in its own place, if it refuses.
      if (packaging?.dirty && !(await packaging.save())) {
        setError('Orders could not be saved. See above.')
        setPhase('idle')
        return
      }
      setPhase('saved')
    } catch (cause) {
      setError(cause instanceof DataActionError ? cause.message : 'That could not be saved.')
      setPhase('idle')
    }
  }

  const box = (
    field: keyof LoyaltyText,
    label: string,
    options: {
      prefix?: string
      suffix?: string
      decimal?: boolean
      /** The copy under Gold members: the same value, its own element. */
      copy?: boolean
    } = {},
  ) => (
    <NumberBox
      id={`${id}-${field}${options.copy ? '-copy' : ''}`}
      label={label}
      compact
      {...options}
      value={typed[field]}
      onChange={(value) => type(field, value)}
      testId={`loyalty-${field}${options.copy ? '-copy' : ''}`}
      disabled={busy}
    />
  )

  return (
    <OutletSection id={id} title="Loyalty" data-testid="loyalty-section">
      <Card
        className={cn(
          'space-y-2 p-3',
          phase === 'saved' && 'motion-safe:animate-[saved-glow_1.6s_ease-out]',
        )}
        data-saved={phase === 'saved' || undefined}
      >
        <SettingTile
          depth={1}
          icon={Coins}
          caption="Points"
          hint={pointsOn ? undefined : 'Customers earn on every bill and spend at the counter'}
          control={
            <Switch
              checked={pointsOn}
              label="Points"
              testId="loyalty-points-switch"
              disabled={busy}
              onChange={switchPoints}
            />
          }
        >
          {pointsOn && (
            <>
              <SettingTile
                depth={2}
                icon={Coins}
                caption="Earn"
                hint="In proportion, rounded down on each bill"
                stacked
                control={
                  <RateRow>
                    {box('earnPoints', 'Points earned')}
                    <span>points for every</span>
                    {box('earnRupees', 'For every rupees', { prefix: '₹' })}
                  </RateRow>
                }
              />
              <SettingTile
                depth={2}
                icon={Percent}
                caption="Max points discount"
                hint="Of the bill, after other discounts"
                control={box('useCap', 'Max points discount', { suffix: '%' })}
              />
              {goldOn && (
                <>
                  <SettingTile
                    depth={2}
                    icon={MemberMark}
                    caption="Max for gold members"
                    hint={
                      whole(typed.useCap) === null
                        ? 'At least everybody’s'
                        : `At least ${whole(typed.useCap)}%`
                    }
                    control={box('goldUseCap', 'Max points discount for gold members', {
                      suffix: '%',
                    })}
                  />
                  <SettingTile
                    depth={2}
                    icon={Sparkles}
                    caption="Gold members points multiplier"
                    hint={`${multiplierLabel(100)} is everybody’s rate`}
                    control={box('multiplier', 'Gold members points multiplier', {
                      suffix: '×',
                      decimal: true,
                    })}
                  />
                </>
              )}
            </>
          )}
        </SettingTile>

        <SettingTile
          depth={1}
          icon={MemberMark}
          caption="Gold members"
          hint={goldOn ? undefined : 'Regulars this outlet marks with a star'}
          control={
            <Switch
              checked={goldOn}
              label="Gold members"
              testId="loyalty-gold-switch"
              disabled={busy}
              onChange={switchGold}
            />
          }
        >
          {goldOn && (
            <>
              <SettingTile
                depth={2}
                icon={CalendarClock}
                caption="Valid for"
                hint="From when gold is given"
                control={box('durationMonths', 'Valid for months', { suffix: 'months' })}
              />
              {/*
                Every gold setting from the other sections, again, so turning
                gold on shows everything it changes [owner, 2026-09-29]. Each is
                the same value as its original: the boxes share this draft, and
                free packaging edits Orders' own.
              */}
              {pointsOn && (
                <>
                  <SettingTile
                    depth={2}
                    icon={Percent}
                    caption="Max points discount"
                    hint={
                      whole(typed.useCap) === null
                        ? 'For gold members, at least everybody’s'
                        : `For gold members, at least ${whole(typed.useCap)}%`
                    }
                    control={box('goldUseCap', 'Max points discount for gold members', {
                      suffix: '%',
                      copy: true,
                    })}
                  />
                  <SettingTile
                    depth={2}
                    icon={Sparkles}
                    caption="Points multiplier"
                    hint={`${multiplierLabel(100)} is everybody’s rate`}
                    control={box('multiplier', 'Gold members points multiplier', {
                      suffix: '×',
                      decimal: true,
                      copy: true,
                    })}
                  />
                </>
              )}
              {packaging?.available && (
                <SettingTile
                  depth={2}
                  icon={ShoppingBag}
                  caption="Free packaging"
                  hint="Set in Orders too"
                  control={
                    <Switch
                      checked={packaging.value}
                      label="Free packaging for gold members"
                      testId="loyalty-gold-free-packaging"
                      disabled={busy}
                      onChange={(value) => {
                        packaging.set(value)
                        setError(null)
                      }}
                    />
                  }
                />
              )}
              <SettingTile
                depth={2}
                icon={UserRoundCheck}
                caption="Allow billers to upgrade to Gold"
                hint={counterGold ? undefined : 'Once a customer has spent enough here'}
                control={
                  <Switch
                    checked={counterGold}
                    label="Allow billers to upgrade to Gold"
                    testId="loyalty-counter-gold-switch"
                    disabled={busy}
                    onChange={switchCounterGold}
                  />
                }
              >
                {counterGold && (
                  <SettingTile
                    depth={3}
                    icon={Coins}
                    caption="Gold eligibility"
                    hint={`Min monthly spend: paid here in the last ${GOLD_WINDOW_DAYS} days`}
                    control={box('thresholdRupees', 'Gold eligibility, min monthly spend', {
                      prefix: '₹',
                    })}
                  />
                )}
              </SettingTile>
            </>
          )}
        </SettingTile>

        <SaveBar
          dirty={dirty}
          phase={phase}
          error={error}
          name="Loyalty"
          testPrefix="loyalty"
          onSave={() => void submit()}
          onCancel={() => {
            resetTo(stored)
            setError(null)
          }}
        />
      </Card>
    </OutletSection>
  )
}

/** Boxes and the words between them, as one line that wraps on a narrow phone. */
function RateRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-content">
      {children}
    </div>
  )
}

/** For a reader who may see the page and not write it: each answer where its control would be. */
function ReadOnlyLoyalty({
  outletId,
  stored,
}: {
  outletId: string
  stored: OutletLoyaltySettings
}) {
  const rupees = (paise: number | null) => (paise === null ? '' : `₹${paise / 100}`)
  return (
    <OutletSection id={`loyalty-${outletId}`} title="Loyalty" data-testid="loyalty-section">
      <Card className="space-y-2 p-3">
        <SettingTile
          depth={1}
          icon={Coins}
          caption="Points"
          control={
            <Answer>
              {stored.pointsEnabled
                ? `${stored.earnPoints} per ${rupees(stored.earnBlockPaise)}`
                : 'Off'}
            </Answer>
          }
        />
        <SettingTile
          depth={1}
          icon={MemberMark}
          caption="Gold members"
          control={
            <Answer>
              {stored.goldEnabled ? `Valid for ${stored.goldDurationMonths} months` : 'Off'}
            </Answer>
          }
        />
      </Card>
    </OutletSection>
  )
}
