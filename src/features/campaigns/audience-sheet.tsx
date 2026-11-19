import { ArrowDownUp, Search, SlidersHorizontal, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { FormSheet } from '@/components/layout/form-sheet'
import { Button } from '@/components/ui/button'
import { LoadingRegion, LoadingTable, Shimmer } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { useAdapters, type Tables } from '@/data-access'
import {
  isPicked,
  nobodyAt,
  type CampaignAudience,
  type CampaignAudiencePerson,
  type CampaignAudienceSort,
} from '@/data-access/campaigns'
import { formatPaise, parseCustomerQuery } from '@/domain'
import { Group, Option } from '@/features/billing/bill-filter-sheet'
import { OutletChips, useOutletScope } from '@/features/outlet-scope'
import { cn } from '@/lib/cn'

import { count, messageOf } from './words'

/**
 * Choosing the customers a campaign goes to
 * (a-campaign-goes-out-on-whatsapp, #85).
 *
 * **It is the customer list, with a search and a few filters above it, and a
 * tick on every customer** [owner, 2026-11-18, twice]. The first version
 * opened on a form of filters and kept the customers behind a button; the
 * second showed the customers but chose them only by filters. Now the
 * customers show as the sheet opens, in the order they would be sent to,
 * loading more as the reader scrolls, as the Customers page does, and the
 * partner ticks the ones it goes to, or **Select all**.
 *
 * - **Search** finds somebody by name or by digits of their number, by the
 *   Customers page's own rules. It narrows the list to tick from; it never
 *   unticks anybody.
 * - **Filters** are one choice each from a short list, two to a row, and
 *   nothing is typed [owner: keep the selectors simple]. Outlet (only where
 *   there is more than one, and opening on the one last used), order, when
 *   they last ordered, what they spent and gold or not are always there; the
 *   number of orders and whether they were sent a campaign before sit behind
 *   **More filters**.
 * - **Select all N** picks everybody the filters match, N of them, and keeps
 *   picking whoever matches as they change; a tick taken off one of them
 *   leaves that one out. Ticks taken one by one stay ticked whatever the
 *   filters show next. Changing the outlet starts the picking again.
 *
 * **It suggests nothing** [owner, proposal decision 6]: a new campaign opens
 * with nobody ticked, and Done waits for somebody to be.
 *
 * A row is a name and the last four digits of a number and nothing more. The
 * read behind it returns no more, because this is the first place in the app
 * that lists customers by what they did.
 */

// ── The choices ─────────────────────────────────────────────────────────────

interface Choice {
  value: string
  label: string
}

/** A filter that takes a kind and a number, as one value: `within:30`. */
function coded(kind: string, amount?: number): string {
  return amount === undefined ? kind : `${kind}:${amount}`
}

function decoded(value: string): { kind: string; amount: number } {
  const [kind = 'any', amount = '0'] = value.split(':')
  return { kind, amount: Number(amount) }
}

const orderedLabel = (kind: string, days: number) =>
  kind === 'within' ? `Last ${days} days` : `Not for ${days} days`

const ORDERED: readonly Choice[] = [
  { value: 'any', label: 'Any time' },
  ...[7, 30, 90].map((days) => ({
    value: coded('within', days),
    label: orderedLabel('within', days),
  })),
  ...[30, 90].map((days) => ({
    value: coded('not_within', days),
    label: orderedLabel('not_within', days),
  })),
]

const spentLabel = (paise: number) => `${formatPaise(paise)} or more`

const SPENT: readonly Choice[] = [
  { value: 'any', label: 'Any amount' },
  ...[50_000, 100_000, 200_000, 500_000].map((paise) => ({
    value: String(paise),
    label: spentLabel(paise),
  })),
]

const GOLD: readonly Choice[] = [
  { value: 'any', label: 'Everyone' },
  { value: 'gold', label: 'Gold' },
  { value: 'not_gold', label: 'Not gold' },
]

const ordersLabel = (kind: string, count: number) =>
  kind === 'at_least' ? `${count} or more` : count === 1 ? 'Only 1' : `${count} or fewer`

const ORDERS: readonly Choice[] = [
  { value: 'any', label: 'Any number' },
  ...[2, 5, 10].map((count) => ({
    value: coded('at_least', count),
    label: ordersLabel('at_least', count),
  })),
  { value: coded('at_most', 1), label: ordersLabel('at_most', 1) },
]

const CAMPAIGNS: readonly Choice[] = [
  { value: 'any', label: 'Either way' },
  { value: 'never', label: 'Never' },
  ...[30, 90].map((days) => ({
    value: coded('not_within', days),
    label: `Not for ${days} days`,
  })),
]

const SORTS: readonly { value: CampaignAudienceSort; label: string }[] = [
  { value: 'most_orders', label: 'Most orders' },
  { value: 'most_recent', label: 'Most recent' },
  { value: 'longest_away', label: 'Longest away' },
]

/**
 * The presets, plus the value in hand where it is not one of them. A draft
 * saved with a figure no preset names keeps it, and says it, and does not
 * snap to the nearest preset by being opened.
 */
function withCurrent(choices: readonly Choice[], value: string, label: string): readonly Choice[] {
  return choices.some((choice) => choice.value === value) ? choices : [...choices, { value, label }]
}

const orderedValue = (audience: CampaignAudience) =>
  audience.ordered.kind === 'any' ? 'any' : coded(audience.ordered.kind, audience.ordered.days)

const ordersValue = (audience: CampaignAudience) =>
  audience.orders.kind === 'any' ? 'any' : coded(audience.orders.kind, audience.orders.count)

const campaignsValue = (audience: CampaignAudience) =>
  audience.campaigns.kind === 'not_within'
    ? coded('not_within', audience.campaigns.days)
    : audience.campaigns.kind

/** The filters alone, as one string: what the list is keyed and read by. Picks are not in it. */
function filtersKey(audience: CampaignAudience): string {
  const { picked: _picked, ...filters } = audience
  return JSON.stringify(filters)
}

/** How long typing settles before the list is asked again: one read per pause, not per key. */
const SEARCH_SETTLE_MS = 250

// ── The sheet ───────────────────────────────────────────────────────────────

/** Every filter at "any": what Clear puts back. Outlet, order and picks are not filters. */
function withoutFilters(audience: CampaignAudience): CampaignAudience {
  return {
    ...audience,
    ordered: { kind: 'any' },
    orders: { kind: 'any' },
    gold: 'any',
    spentAtLeastPaise: null,
    campaigns: { kind: 'any' },
  }
}

/** The filters in force, as the Filter button's line says them; null with none. */
function filterSummary(audience: CampaignAudience): string | null {
  const words = [
    audience.ordered.kind === 'any'
      ? null
      : `${orderedLabel(audience.ordered.kind, audience.ordered.days)}`,
    audience.spentAtLeastPaise === null ? null : `Spent ${spentLabel(audience.spentAtLeastPaise)}`,
    audience.gold === 'any' ? null : GOLD.find((choice) => choice.value === audience.gold)?.label,
    audience.orders.kind === 'any'
      ? null
      : `${ordersLabel(audience.orders.kind, audience.orders.count)} orders`,
    audience.campaigns.kind === 'never'
      ? 'Never sent one'
      : audience.campaigns.kind === 'not_within'
        ? `Not sent one for ${audience.campaigns.days} days`
        : null,
  ].filter((word): word is string => Boolean(word))
  return words.length > 0 ? words.join(' · ') : null
}

export function AudienceSheet({
  value,
  onClose,
  onDone,
}: {
  /** What was chosen before, or null for a campaign with nobody chosen yet. */
  value: CampaignAudience | null
  onClose: () => void
  onDone: (audience: CampaignAudience) => void
}) {
  const { outlets } = useAdapters()
  // The outlet every outlet-scoped page opens on, so this does too.
  const scope = useOutletScope()
  const [shops, setShops] = useState<Tables<'outlets'>[] | null>(null)
  const [held, setHeld] = useState<CampaignAudience | null>(value)
  const [filtering, setFiltering] = useState(false)
  const [search, setSearch] = useState('')
  const [settledSearch, setSettledSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    outlets
      .listOutlets()
      .then((rows) => {
        if (active) setShops(rows)
      })
      .catch((cause: unknown) => {
        if (active) setError(messageOf(cause, 'Could not load the outlets. Try again in a moment.'))
      })
    return () => {
      active = false
    }
  }, [outlets])

  useEffect(() => {
    const timer = setTimeout(() => setSettledSearch(search), SEARCH_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [search])

  // Nobody chosen yet: nobody ticked, at the outlet last used, or else the first.
  const startAt = scope.outletId ?? shops?.[0]?.id ?? null
  const audience = held ?? (startAt ? nobodyAt(startAt) : null)

  const change = (patch: Partial<CampaignAudience>) => {
    if (audience) setHeld({ ...audience, ...patch })
  }

  const toggle = (customerId: string) => {
    if (!audience) return
    const { picked } = audience
    const flip = (ids: string[]) =>
      ids.includes(customerId) ? ids.filter((id) => id !== customerId) : [...ids, customerId]
    setHeld({
      ...audience,
      picked:
        picked.kind === 'all'
          ? { kind: 'all', except: flip(picked.except) }
          : { kind: 'only', ids: flip(picked.ids) },
    })
  }

  const matching = useAudienceCount(
    audience ? { ...audience, picked: { kind: 'all', except: [] } } : null,
  )
  const pickedCount = useAudienceCount(audience?.picked.kind === 'all' ? audience : null)
  const selected =
    audience === null
      ? null
      : audience.picked.kind === 'only'
        ? audience.picked.ids.length
        : pickedCount

  const everybody = audience?.picked.kind === 'all' && audience.picked.except.length === 0
  const somebody =
    audience !== null &&
    !everybody &&
    (audience.picked.kind === 'all' || audience.picked.ids.length > 0)

  const query = parseCustomerQuery(search)
  const tooShort = search.trim() !== '' && query.kind === 'too-short'
  const summary = audience ? filterSummary(audience) : null

  return (
    <FormSheet
      open
      scrollsItself
      onClose={onClose}
      title="Choose customers"
      error={error}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p
            role="status"
            data-testid="audience-sheet-count"
            className="text-base font-bold tabular-nums text-content"
          >
            {selected === null ? '…' : `${count(selected)} selected`}
          </p>
          <Button
            size="phone"
            className="min-w-28"
            disabled={audience === null || !selected}
            data-testid="audience-done"
            onClick={() => {
              if (audience) onDone(audience)
            }}
          >
            Done
          </Button>
        </div>
      }
    >
      {audience === null || shops === null ? (
        error ? null : (
          <SheetShimmer />
        )
      ) : (
        <>
          {/* Still: the search, the outlet, the filters and Select all. Only the list below scrolls. */}
          <div className="shrink-0 space-y-3 pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-[var(--size-control-phone)] min-w-0 flex-1 items-center gap-2 rounded-xl border-2 border-border bg-surface pl-3 focus-within:focus-ring">
                <Search aria-hidden size={18} className="shrink-0 text-content-muted" />
                <input
                  aria-label="Search by name or number"
                  data-testid="audience-search"
                  autoComplete="off"
                  enterKeyHint="search"
                  placeholder="Search name or number"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-full min-w-0 flex-1 bg-transparent text-content outline-none placeholder:text-content-muted"
                />
                {search !== '' && (
                  <button
                    type="button"
                    aria-label="Clear the search"
                    onClick={() => setSearch('')}
                    className="flex h-full w-[var(--size-control-phone)] shrink-0 items-center justify-center rounded-r-xl text-content-muted hover:bg-surface-raised focus-visible:focus-ring"
                  >
                    <X aria-hidden size={18} />
                  </button>
                )}
              </div>
              {/* Billing's Filter: one button opens every choice. */}
              <button
                type="button"
                onClick={() => setFiltering(true)}
                aria-label={summary ? `Filter: ${summary}` : 'Filter'}
                data-testid="audience-filter"
                className={cn(
                  'inline-flex size-[var(--size-control-phone)] shrink-0 items-center justify-center rounded-xl border-2 font-bold focus-visible:focus-ring',
                  summary ? 'border-primary text-accent-text' : 'border-border text-content',
                )}
              >
                <SlidersHorizontal aria-hidden size={20} />
              </button>
            </div>
            {tooShort && (
              <p className="-mt-1 text-xs text-content-muted">
                Keep typing: at least three letters or digits.
              </p>
            )}
            {summary && (
              // What is in force, and the way back to everybody, as Billing has it.
              <div className="-mt-1 flex items-center gap-2">
                <p
                  data-testid="audience-filter-summary"
                  className="min-w-0 flex-1 truncate text-sm font-semibold text-accent-text"
                >
                  {summary}
                </p>
                <Button
                  variant="ghost"
                  size="phone"
                  className="shrink-0"
                  data-testid="audience-filter-clear"
                  onClick={() => setHeld(withoutFilters(audience))}
                >
                  Clear
                </Button>
              </div>
            )}

            {shops.length > 1 && (
              // The chips every outlet page uses. Ticks belong to one outlet's
              // customers, so choosing another starts them again.
              <OutletChips
                outlets={shops}
                chosen={[audience.outletId]}
                label="Outlet"
                testId="audience-outlet"
                onToggle={(outletId) => {
                  scope.choose(outletId)
                  setHeld({ ...nobodyAt(outletId), sort: audience.sort })
                }}
              />
            )}

            <div className="flex items-center gap-2">
              <SelectAll
                all={everybody}
                some={somebody}
                matching={matching}
                onChange={(next) =>
                  change({
                    picked: next ? { kind: 'all', except: [] } : { kind: 'only', ids: [] },
                  })
                }
              />
              {/* An order, said by the arrows as well as the word. */}
              <div className="relative shrink-0">
                <ArrowDownUp
                  aria-hidden
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
                />
                <Select
                  aria-label="Sort by"
                  data-testid="audience-sort"
                  value={audience.sort}
                  onChange={(event) => change({ sort: event.target.value as CampaignAudienceSort })}
                  className="h-[var(--size-control-phone)] w-auto rounded-xl pl-9"
                >
                  {SORTS.map((sort) => (
                    <option key={sort.value} value={sort.value}>
                      {sort.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          {/* The list takes what room is left, and scrolls inside its own box. */}
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Keyed by the filters and the search, so either starts the list again from the top; a tick does not. */}
            <AudienceList
              key={`${filtersKey(audience)}|${settledSearch}`}
              filters={filtersKey(audience)}
              search={settledSearch}
              isPicked={(id) => isPicked(audience, id)}
              onToggle={toggle}
            />
          </div>

          {filtering && (
            <FiltersSheet
              audience={audience}
              onChange={(next) => setHeld(next)}
              onClose={() => setFiltering(false)}
            />
          )}
        </>
      )}
    </FormSheet>
  )
}

/**
 * Every filter but the outlet and the order, as Billing's filter sheet has
 * them: one choice per group, applied as it is tapped, and Done closes it.
 */
function FiltersSheet({
  audience,
  onChange,
  onClose,
}: {
  audience: CampaignAudience
  onChange: (audience: CampaignAudience) => void
  onClose: () => void
}) {
  const choose = (
    label: string,
    choices: readonly Choice[],
    value: string,
    set: (value: string) => Partial<CampaignAudience>,
  ) => (
    <Group label={label}>
      {choices.map((choice) => (
        <Option
          key={choice.value}
          role="radio"
          selected={choice.value === value}
          onClick={() => onChange({ ...audience, ...set(choice.value) })}
        >
          {choice.label}
        </Option>
      ))}
    </Group>
  )
  const spent = audience.spentAtLeastPaise === null ? 'any' : String(audience.spentAtLeastPaise)

  return (
    <FormSheet
      open
      title="Filter customers"
      onClose={onClose}
      footer={
        <Button
          size="phone"
          className="w-full"
          data-testid="audience-filter-done"
          onClick={onClose}
        >
          Done
        </Button>
      }
    >
      <div className="space-y-5" data-testid="audience-filter-sheet">
        {choose(
          'Last ordered',
          withCurrent(
            ORDERED,
            orderedValue(audience),
            audience.ordered.kind === 'any'
              ? ''
              : orderedLabel(audience.ordered.kind, audience.ordered.days),
          ),
          orderedValue(audience),
          (next) => {
            const { kind, amount } = decoded(next)
            return {
              ordered:
                kind === 'within' || kind === 'not_within'
                  ? { kind, days: amount }
                  : { kind: 'any' },
            }
          },
        )}
        {choose(
          'Spent',
          withCurrent(SPENT, spent, spentLabel(audience.spentAtLeastPaise ?? 0)),
          spent,
          // Integer paise in and out; nothing is typed or rounded here.
          (next) => ({ spentAtLeastPaise: next === 'any' ? null : Number(next) }),
        )}
        {choose('Members', GOLD, audience.gold, (next) => ({
          gold: next as CampaignAudience['gold'],
        }))}
        {choose(
          'Orders',
          withCurrent(
            ORDERS,
            ordersValue(audience),
            audience.orders.kind === 'any'
              ? ''
              : ordersLabel(audience.orders.kind, audience.orders.count),
          ),
          ordersValue(audience),
          (next) => {
            const { kind, amount } = decoded(next)
            return {
              orders:
                kind === 'at_least' || kind === 'at_most'
                  ? { kind, count: amount }
                  : { kind: 'any' },
            }
          },
        )}
        {choose(
          'Sent a campaign',
          withCurrent(
            CAMPAIGNS,
            campaignsValue(audience),
            audience.campaigns.kind === 'not_within'
              ? `Not for ${audience.campaigns.days} days`
              : '',
          ),
          campaignsValue(audience),
          (next) => {
            const { kind, amount } = decoded(next)
            return {
              campaigns:
                kind === 'not_within'
                  ? { kind, days: amount }
                  : kind === 'never'
                    ? { kind }
                    : { kind: 'any' },
            }
          },
        )}
      </div>
    </FormSheet>
  )
}

/**
 * The tick above the list. Ticked is everybody the filters match; part-ticked
 * is some of them, by hand or with a few left out; a press from either state
 * picks them all, and a press from ticked picks nobody.
 */
function SelectAll({
  all,
  some,
  matching,
  onChange,
}: {
  all: boolean
  some: boolean
  matching: number | null
  onChange: (all: boolean) => void
}) {
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (box.current) box.current.indeterminate = some
  }, [some])
  return (
    <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-3 hover:bg-surface-raised">
      <input
        ref={box}
        type="checkbox"
        data-testid="audience-select-all"
        className="size-4 shrink-0 accent-primary"
        checked={all}
        disabled={matching === 0}
        onChange={() => onChange(!all)}
      />
      <span className="text-sm font-semibold text-content">
        Select all{matching === null ? '' : ` ${count(matching)}`}
      </span>
    </label>
  )
}

/** How many customers an audience holds now; null while it is being asked, or for no audience. */
function useAudienceCount(audience: CampaignAudience | null): number | null {
  const { campaigns } = useAdapters()
  const key = audience ? JSON.stringify(audience) : null
  const [answer, setAnswer] = useState<{ key: string; count: number } | null>(null)
  useEffect(() => {
    if (key === null) return
    let current = true
    campaigns
      .audienceCount(JSON.parse(key) as CampaignAudience)
      .then((value) => {
        if (current) setAnswer({ key, count: value })
      })
      .catch(() => {
        // Left at the dots: the list below says what went wrong.
      })
    return () => {
      current = false
    }
  }, [campaigns, key])
  return answer !== null && answer.key === key ? answer.count : null
}

/**
 * The customers, in the order they would be sent to, a page at a time and
 * more as the reader nears the bottom: the same sentinel the Customers page
 * uses, watched against the sheet's own scrolling area, so it loads ahead of
 * the reader there. A failed page says so and offers to try again, and never
 * stops silently at a list that only looks complete.
 */
function AudienceList({
  filters,
  search,
  isPicked: picked,
  onToggle,
}: {
  /** The filters as `filtersKey` writes them. */
  filters: string
  search: string
  isPicked: (customerId: string) => boolean
  onToggle: (customerId: string) => void
}) {
  const { campaigns } = useAdapters()
  const audience = useMemo(() => JSON.parse(filters) as CampaignAudience, [filters])
  /** Null until the first page lands. */
  const [rows, setRows] = useState<CampaignAudiencePerson[] | null>(null)
  /** Where the next page starts; null at the end. */
  const [next, setNext] = useState<number | null>(0)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const sentinel = useRef<HTMLLIElement>(null)

  const page = useCallback(
    (from: number) => {
      if (inFlight.current) return
      inFlight.current = true
      campaigns
        // The filters alone: the list shows who matches, ticked or not.
        .audiencePage({ ...audience, picked: { kind: 'all', except: [] } }, from, search)
        .then((answer) => {
          // Nobody twice, should the list have moved between two pages.
          setRows((held) => {
            const seen = new Set((held ?? []).map((row) => row.customerId))
            return [...(held ?? []), ...answer.rows.filter((row) => !seen.has(row.customerId))]
          })
          setNext(answer.next)
          setFailed(false)
        })
        .catch(() => setFailed(true))
        .finally(() => {
          inFlight.current = false
        })
    },
    [campaigns, audience, search],
  )

  // The first page, as the list opens.
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    page(0)
  }, [page])

  useEffect(() => {
    const node = sentinel.current
    if (!node || next === null || failed) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) page(next)
      },
      // The list's box scrolls, not the page, so the margin is measured in the box.
      { root: node.closest('[data-testid="audience-scroller"]'), rootMargin: '300px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [next, failed, page, rows?.length])

  if (rows === null) {
    return failed ? (
      <Retry words="The customers could not be loaded." onRetry={() => page(0)} />
    ) : (
      <div className="min-h-0 overflow-hidden">
        <LoadingTable label="the customers" rows={8} rowHeight="h-11" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <p
        data-testid="audience-nobody"
        className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-content-muted"
      >
        {search.trim() === '' ? 'Nobody matches. Loosen a filter.' : 'Nobody matches that search.'}
      </p>
    )
  }

  return (
    <div data-testid="audience-people" className="flex min-h-0 flex-col">
      {/*
        The rounded box is what scrolls, so the rows move inside it and its
        corners are never cut. As high as its rows, and no higher than the
        room the sheet leaves; a thin scrollbar on a clear track, inside the
        box, where a mouse shows one at all.
      */}
      <div
        data-testid="audience-scroller"
        className="relative min-h-0 overflow-y-auto rounded-xl border border-border bg-surface [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
      >
        <ol className="divide-y divide-border">
          {rows.map((row, index) => {
            const ticked = picked(row.customerId)
            return (
              <li key={row.customerId}>
                <label
                  data-testid={`audience-row-${row.customerId}`}
                  className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-surface-raised"
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={ticked}
                    onChange={() => onToggle(row.customerId)}
                    aria-label={`Pick ${row.name ?? `the number ending ${row.phoneLast4}`}`}
                  />
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-content-muted">
                    {index + 1}
                  </span>
                  <span
                    className={
                      row.name
                        ? 'min-w-0 flex-1 truncate font-semibold text-content'
                        : 'min-w-0 flex-1 truncate text-content-muted'
                    }
                  >
                    {row.name ?? 'No saved name'}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-content-muted">
                    <span aria-hidden>•••• </span>
                    <span className="sr-only">number ending </span>
                    {row.phoneLast4}
                  </span>
                </label>
              </li>
            )
          })}
          {next !== null && !failed && (
            // The next page's shape, standing where it will land.
            <li ref={sentinel} aria-hidden data-testid="audience-more">
              <Shimmer className="m-2 h-8 rounded-lg" />
            </li>
          )}
        </ol>
      </div>
      {failed && next !== null && (
        <div className="mt-2 shrink-0">
          <Retry
            words="The rest of the customers could not be loaded."
            onRetry={() => page(next)}
          />
        </div>
      )}
    </div>
  )
}

function Retry({ words, onRetry }: { words: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p role="alert" className="text-sm font-semibold text-danger">
        {words}
      </p>
      <Button variant="secondary" size="phone" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/** The sheet's own shape: the search and its Filter, the outlet chips, Select all and the order, then customer rows. */
function SheetShimmer() {
  return (
    <LoadingRegion label="the customers" className="space-y-3" data-testid="audience-loading">
      <div className="flex gap-2">
        <Shimmer className="h-[var(--size-control-phone)] flex-1" />
        <Shimmer className="size-[var(--size-control-phone)]" />
      </div>
      <div className="flex gap-1.5">
        <Shimmer className="h-8 w-24 rounded-full" />
        <Shimmer className="h-8 w-28 rounded-full" />
      </div>
      <div className="flex gap-2">
        <Shimmer className="h-11 flex-1" />
        <Shimmer className="h-[var(--size-control-phone)] w-36" />
      </div>
      <div className="space-y-1">
        {Array.from({ length: 8 }, (_, index) => (
          <Shimmer key={index} className="h-11" />
        ))}
      </div>
    </LoadingRegion>
  )
}
