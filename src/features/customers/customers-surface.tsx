import { ChevronRight, Contact, Search, Star, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { LoadingList, Shimmer } from '@/components/ui/loading'
import { MemberMark } from '@/components/ui/member-mark'
import { useAdapters } from '@/data-access'
import { useSession } from '@/session/context'
import { holdsRole } from '@/session/session'
import {
  DataActionError,
  type DirectoryCustomerCard,
  type DirectoryList,
  type DirectoryCustomerRow,
  type DirectoryCustomerSearch,
} from '@/data-access/adapters'
import {
  highlightName,
  highlightPhone,
  parseCustomerQuery,
  type CustomerQuery,
  type MatchSegment,
} from '@/domain'
import { cn } from '@/lib/cn'
import { formatIndianPhone } from '../../../shared/phone'

import { CustomerCardDialog } from './customer-card-dialog'
import { visitsLabel } from './visits-label'

/**
 * The owner's customers (a-gold-member-is-a-label).
 *
 * **Two ways in, and neither is an address.** A search by name or by part of a
 * number [owner, 2026-09-24]; and two short lists for the people whose name the
 * owner does not have to hand — because the owner decides to make somebody gold
 * when they notice that person keeps coming back, and nobody knows a regular's
 * number by heart [owner, 2026-09-23].
 *
 * Whoever is picked opens as a card over this page, never at a route: a URL
 * naming a person with their phone number on it would sit in browser history
 * and paste into a chat.
 *
 * The search and the lists are a browse path, and that is exactly why they
 * exist here and nowhere else. The owner already reads every bill at every
 * outlet; no counter can list anybody.
 */
export function CustomersSurface() {
  // Wording only. What a manager can see and change is the adapter's to decide,
  // and it decides from the same assignments.
  const wholeBusiness = holdsRole(useSession(), 'super_admin')
  /** Regulars first [owner, 2026-09-24]: it is where the owner finds who to make gold. */
  const [tab, setTab] = useState<DirectoryList>('regulars')
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** Bumped when the card changed something, so the search re-reads. */
  const [revision, setRevision] = useState(0)
  /**
   * What the card changed, laid over every row already on screen.
   *
   * Reloading the open list instead would throw away every page scrolled
   * through and drop the owner back at the top of it, forty names from where
   * they were. The other tab reads fresh when it is next opened.
   */
  const [patches, setPatches] = useState<ReadonlyMap<string, RowPatch>>(new Map())

  function changed(card: DirectoryCustomerCard) {
    setPatches((current) =>
      new Map(current).set(card.id, {
        name: card.name,
        tier: card.memberSince === null ? null : 'gold',
      }),
    )
    setRevision((value) => value + 1)
  }

  const patch = (row: DirectoryCustomerRow): DirectoryCustomerRow => {
    const changes = patches.get(row.id)
    return changes ? { ...row, ...changes } : row
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Customers"
        subtitle={
          wholeBusiness
            ? 'Search by name or number, or open a regular from the lists below.'
            : 'The customers your outlet has served. Search by name or number, or open a regular below.'
        }
      />

      <CustomerSearch
        query={query}
        onQuery={setQuery}
        revision={revision}
        patch={patch}
        onOpen={setOpenId}
      />

      {/*
        While a search is on screen the lists step aside: the results are the
        answer being looked for, and a list underneath them is one more place a
        name could appear and be mistaken for a match.
      */}
      {query.trim() !== '' ? null : (
        <>
          {/*
            One control in two halves — the same pressed pair Attendance and the
            Ledger use for their own switches, because a `role="tab"` with no
            tabpanel beneath it is a tablist that is not one (design D3).
            Regulars first [owner, 2026-09-24].
          */}
          <div
            role="group"
            aria-label="Show"
            data-testid="customer-tabs"
            className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1"
          >
            {LIST_ORDER.map((which) => (
              <button
                key={which}
                type="button"
                aria-pressed={tab === which}
                data-testid={`tab-${which}`}
                onClick={() => setTab(which)}
                className={cn(
                  'h-[var(--size-control-phone)] rounded-lg text-sm font-semibold focus-visible:focus-ring',
                  tab === which
                    ? 'bg-primary text-on-primary'
                    : 'text-content-muted hover:bg-surface-raised hover:text-content',
                )}
              >
                {/*
                  No count [owner, 2026-09-24]: Regulars is everybody seen this
                  month and Gold is everybody who is gold, so a number beside
                  either would only restate the length of the list below it.
                */}
                {LIST_LABELS[which]}
              </button>
            ))}
          </div>
          <p className="mb-2 text-xs text-content-muted">
            {tab === 'members'
              ? 'Everyone who is gold now, newest first'
              : wholeBusiness
                ? 'Most visits in the last 30 days'
                : 'Most visits at your outlet in the last 30 days'}
          </p>

          {/*
            Keyed by tab: each tab reads its own list when opened, and the open
            one keeps every page already scrolled through.
          */}
          <CustomerListPanel key={tab} which={tab} patch={patch} onOpen={setOpenId} />
        </>
      )}

      <CustomerCardDialog customerId={openId} onClose={() => setOpenId(null)} onChanged={changed} />
    </div>
  )
}

const LIST_ORDER: readonly DirectoryList[] = ['regulars', 'members']
const LIST_LABELS: Record<DirectoryList, string> = { regulars: 'Regulars', members: 'Gold' }

/** A name or a membership the card changed, until the row is next read. */
type RowPatch = Pick<DirectoryCustomerRow, 'name' | 'tier'>

/** How long typing settles before a search is asked — one request per pause, not per key. */
const SEARCH_SETTLE_MS = 250

type SearchAnswer =
  | { query: string; state: 'found'; result: DirectoryCustomerSearch }
  | { query: string; state: 'error'; message: string }

/**
 * A name, or part of a number [owner, 2026-09-24].
 *
 * Letters match anywhere in a saved name; digits match anywhere in the number,
 * so the four somebody remembers from the end of it are enough. This breadth is
 * the owner's alone — the till can still only complete a number, or match four
 * digits among its own outlet's customers.
 *
 * Names were typed at a counter, so some are misspelt and some customers never
 * gave one. That is why a number still finds them.
 */
function CustomerSearch({
  query,
  onQuery,
  revision,
  patch,
  onOpen,
}: {
  query: string
  onQuery: (query: string) => void
  revision: number
  patch: (row: DirectoryCustomerRow) => DirectoryCustomerRow
  onOpen: (id: string) => void
}) {
  const { customerDirectory } = useAdapters()
  const [answer, setAnswer] = useState<SearchAnswer | null>(null)
  const trimmed = query.trim()
  const parsed = parseCustomerQuery(trimmed)
  const askable = parsed.kind !== 'too-short'

  useEffect(() => {
    if (!askable) return
    let current = true
    const timer = setTimeout(() => {
      customerDirectory
        .search(trimmed)
        .then((result) => {
          if (current) setAnswer({ query: trimmed, state: 'found', result })
        })
        .catch((cause: unknown) => {
          if (current) {
            setAnswer({
              query: trimmed,
              state: 'error',
              message: messageOf(cause, 'That search failed.'),
            })
          }
        })
    }, SEARCH_SETTLE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
    // `revision` re-asks after the card changed somebody, so a renamed or newly
    // gold customer does not sit in the results as they were.
  }, [customerDirectory, trimmed, askable, revision])

  const shown = answer !== null && answer.query === trimmed ? answer : null

  return (
    <section className="mb-6" aria-label="Find a customer">
      <label htmlFor="customer-search" className="text-sm font-semibold text-content">
        Find a customer
      </label>
      <div className="mt-1 flex h-[var(--size-control)] items-center gap-2 rounded-lg border border-border bg-surface pl-3 focus-within:focus-ring">
        <Search aria-hidden size={18} className="shrink-0 text-content-muted" />
        <input
          id="customer-search"
          data-testid="customer-search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Name, or digits of their number"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-content outline-none placeholder:text-content-muted"
        />
        {query !== '' && (
          <button
            type="button"
            aria-label="Clear the search"
            onClick={() => onQuery('')}
            className="flex h-full w-[var(--size-control)] shrink-0 items-center justify-center rounded-r-lg text-content-muted hover:bg-surface-raised focus-visible:focus-ring"
          >
            <X aria-hidden size={18} />
          </button>
        )}
      </div>

      {trimmed !== '' && (
        <div className="mt-3" data-testid="customer-search-result">
          {!askable ? (
            <p className="text-sm text-content-muted">
              Keep typing — at least three letters or digits.
            </p>
          ) : shown === null ? (
            <LoadingList label="matching customers" rows={2} blockHeight="h-14" />
          ) : shown.state === 'error' ? (
            <p role="alert" className="text-sm font-semibold text-danger">
              {shown.message}
            </p>
          ) : shown.result.matches.length === 0 ? (
            <p className="text-sm text-content-muted">Nobody matches that.</p>
          ) : (
            <>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {shown.result.matches.map((row) => (
                  <li key={row.id}>
                    <CustomerButton row={patch(row)} query={parsed} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
              {shown.result.more > 0 && (
                // A count and never a door: the way to the rest is a longer query.
                <p className="mt-2 text-xs text-content-muted" data-testid="customer-search-more">
                  {shown.result.more} more match. Keep typing to narrow it down.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * One list, twenty at a time, loading the next twenty as the reader nears the
 * bottom [owner, 2026-09-24].
 *
 * The same sentinel the Delivery run history uses: an observer a little ahead
 * of the viewport, re-armed after every page, because an observer fires on a
 * *change* in intersection and a sentinel already in view when a short page
 * landed would otherwise never ask again. A failed page says so and offers to
 * try again rather than stopping silently at a list that only looks complete.
 */
function CustomerListPanel({
  which,
  patch,
  onOpen,
}: {
  which: DirectoryList
  patch: (row: DirectoryCustomerRow) => DirectoryCustomerRow
  onOpen: (id: string) => void
}) {
  const { customerDirectory } = useAdapters()
  /** Null until the first page lands. */
  const [rows, setRows] = useState<DirectoryCustomerRow[] | null>(null)
  /** Where the next page starts; 0 before anything has been read. */
  const [next, setNext] = useState<number | null>(0)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const sentinel = useRef<HTMLLIElement>(null)

  const loadMore = useCallback(() => {
    if (inFlight.current || next === null) return
    inFlight.current = true
    setFailed(false)
    customerDirectory
      .list(which, next)
      .then((page) => {
        // Nobody twice, should the list have moved between two pages.
        setRows((current) => {
          const seen = new Set((current ?? []).map((row) => row.id))
          return [...(current ?? []), ...page.rows.filter((row) => !seen.has(row.id))]
        })
        setNext(page.next)
      })
      .catch(() => setFailed(true))
      .finally(() => {
        inFlight.current = false
      })
  }, [customerDirectory, which, next])

  // The first page, read when the tab opens.
  useEffect(() => {
    if (rows === null && !failed) loadMore()
  }, [rows, failed, loadMore])

  useEffect(() => {
    const node = sentinel.current
    if (!node || next === null || failed) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { rootMargin: '300px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [next, failed, loadMore, rows?.length])

  if (rows === null) {
    return failed ? (
      <div className="flex items-center justify-between gap-3">
        <p role="alert" className="text-sm font-semibold text-danger">
          This list could not be loaded.
        </p>
        <Button variant="secondary" size="phone" onClick={() => setFailed(false)}>
          Try again
        </Button>
      </div>
    ) : (
      <LoadingList
        label="the customer list"
        rows={6}
        blockHeight="h-14"
        data-testid="customers-loading"
      />
    )
  }

  if (rows.length === 0) {
    return (
      <div data-testid={`customer-list-${which}`}>
        <EmptyState
          icon={which === 'members' ? Star : Contact}
          title={
            which === 'members'
              ? 'Nobody is a gold member yet. Open a regular to make them one.'
              : 'Nobody has given their number at the counter in the last 30 days.'
          }
        />
      </div>
    )
  }

  return (
    <div data-testid={`customer-list-${which}`}>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {rows.map((row) => (
          <li key={row.id}>
            <CustomerButton row={patch(row)} showVisits={which === 'regulars'} onOpen={onOpen} />
          </li>
        ))}
        {next !== null && !failed && (
          // The next page's shape, standing where it will land.
          <li ref={sentinel} aria-hidden data-testid="customer-list-more">
            <Shimmer className="m-2 h-10 rounded-lg" />
          </li>
        )}
      </ul>
      {failed && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p role="alert" className="text-sm font-semibold text-danger">
            The rest of this list could not be loaded.
          </p>
          <Button variant="secondary" size="phone" onClick={loadMore}>
            Try again
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * One customer, as a row in a bordered list that opens their card.
 *
 * In search results the part that matched is bold [owner, 2026-09-24] — one run
 * for an exact match, the scattered letters for a loose one — so it is plain
 * why somebody is on the list, and a near-miss reads as one.
 */
function CustomerButton({
  row,
  showVisits = false,
  query = null,
  onOpen,
}: {
  row: DirectoryCustomerRow
  showVisits?: boolean
  query?: CustomerQuery | null
  onOpen: (id: string) => void
}) {
  const phone = formatIndianPhone(row.phone)
  return (
    <button
      type="button"
      data-testid={`customer-${row.id}`}
      onClick={() => onOpen(row.id)}
      className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-raised focus-visible:focus-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 font-bold text-content">
          <span className={row.name ? 'truncate' : 'truncate text-content-muted'}>
            {row.name === null ? (
              'No saved name'
            ) : query ? (
              <Highlighted segments={highlightName(row.name, query)} strong="font-black" />
            ) : (
              row.name
            )}
          </span>
          {row.tier === 'gold' && <MemberMark />}
        </span>
        <span className="block text-sm tabular-nums text-content-muted">
          +91{' '}
          {query ? (
            <Highlighted segments={highlightPhone(phone, query)} strong="font-bold text-content" />
          ) : (
            phone
          )}
        </span>
      </span>
      {showVisits && (
        <span className="shrink-0 text-sm font-semibold tabular-nums text-content">
          {visitsLabel(row.visits30d)}
        </span>
      )}
      <ChevronRight aria-hidden size={18} className="shrink-0 text-content-muted" />
    </button>
  )
}

/** Text with its matched runs set in `strong`. The whole string is still one readable line. */
function Highlighted({ segments, strong }: { segments: MatchSegment[]; strong: string }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.matched ? (
          <mark key={index} data-match="" className={`bg-transparent text-inherit ${strong}`}>
            {segment.text}
          </mark>
        ) : (
          <span key={index} className="font-semibold">
            {segment.text}
          </span>
        ),
      )}
    </>
  )
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof DataActionError ? cause.message : fallback
}
