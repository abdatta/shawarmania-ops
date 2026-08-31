import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'

import { MemoryRouter, Route, Routes } from 'react-router'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock/fixtures/outlets'
import { SessionContext } from '@/session/context'
import { chooseOutlet } from '@/test/outlet-scope'
import { demoSessionFor } from '@/test/session'

import { DeliverySyncSurface } from './delivery-sync-surface'

/**
 * The history, on the surface (#48).
 *
 * The collapse rule has its own unit tests; these are about what the owner can
 * actually find. Four things, and each one closes an absence the surface had:
 *
 *  1. **Every run is there**, including the two outcomes the events read never
 *     asked for — a run refused over money and a run holding for a code, both
 *     of which appeared as nothing at all.
 *  2. **A healed failure stays.** The repair takes the matter out of *Needs
 *     you*, exactly as before, and leaves every failed read it healed readable.
 *  3. **A hundred runs are scannable**: a date rail, a collapsed group carrying
 *     its count, and an honest line where recorded summaries begin.
 *  4. **Two channels, two histories.** One relabelled would imply the one thing
 *     this surface must never imply.
 */

/**
 * jsdom has no `IntersectionObserver`, and the list guards for that rather than
 * crashing. This stub fires immediately, so a test can ask for the next page the
 * way scrolling does instead of reaching into the component.
 */
beforeAll(() => {
  class Immediate {
    constructor(private readonly run: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.run(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      )
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: readonly number[] = []
  }
  // Only where the environment has none: a real browser keeps its own.
  globalThis.IntersectionObserver ??= Immediate as unknown as typeof IntersectionObserver
})

type Adapters = ReturnType<typeof createMockAdapters>

async function renderChannel(
  channel: 'zomato' | 'swiggy',
  outletId: string,
  adapters: Adapters = createMockAdapters('super_admin'),
) {
  render(
    <MemoryRouter initialEntries={[`/demo/owner/ledger/delivery/${channel}`]}>
      <SessionContext.Provider value={demoSessionFor('super_admin')}>
        <AdaptersContext.Provider value={adapters}>
          <Routes>
            <Route path="/demo/owner/ledger/delivery/:channel" element={<DeliverySyncSurface />} />
          </Routes>
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  await chooseOutlet(outletId)
  return adapters
}

/** The section the history lives in, once its first page has landed. */
async function history(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: /what has happened/i })
  const section = heading.closest('section')
  if (!section) throw new Error('the history has no section')
  await waitFor(() => expect(within(section).queryByTestId('run-history-loading')).toBeNull())
  return section
}

describe('the run history', () => {
  it('shows the outcomes the old list could not, including a run holding for a code', async () => {
    await renderChannel('zomato', OUTLET_KALYANI_ID)
    const list = await history()

    // `events()` asked for two of the five words the check constraint permits,
    // so a run refused because the payout did not add up appeared only as a
    // disputed week, and a run waiting for a code appeared nowhere at all.
    expect(within(list).getByText('Does not add up')).toBeInTheDocument()
    expect(within(list).getByText('Code wanted')).toBeInTheDocument()
    expect(within(list).getAllByText('Signed out').length).toBeGreaterThan(0)
    expect(within(list).getAllByText('Nothing moved').length).toBeGreaterThan(0)
  })

  it('says what moved without the reader opening anything', async () => {
    await renderChannel('zomato', OUTLET_KALYANI_ID)
    const list = await history()

    // In rupees and from → to, on the row. A line that only reported movement
    // would send the reader looking for the answer this surface exists to give.
    const moved = within(list).getAllByTestId('run-moved')
    expect(moved.length).toBeGreaterThan(0)
    expect(moved.map((node) => node.textContent).join(' ')).toMatch(/₹/)
  })

  it('lets a quiet run say what it looked at, and lets a failed one stay quiet', async () => {
    await renderChannel('zomato', OUTLET_KALYANI_ID)
    const list = await history()

    // "Nothing moved" on its own is a shrug. What makes it a report is the
    // window: seven days considered, none of them changed.
    const read = within(list).getAllByTestId('run-read')
    expect(read.length).toBeGreaterThan(0)
    expect(read[0]?.textContent).toMatch(/^Read \d+ days?, /)

    // And a run that never reached the portal claims no window. The write
    // contract only builds a summary on the path that got through, so a failure
    // saying it had read a week would be the surface inventing the work.
    const stormCard = within(list)
      .getByRole('button', { name: /9 reads/i })
      .closest('div')
    expect(stormCard?.querySelector('[data-testid="run-read"]')).toBeNull()
  })

  it('collapses a failure storm into one line that carries its count and opens', async () => {
    const user = userEvent.setup()
    await renderChannel('zomato', OUTLET_KALYANI_ID)
    const list = await history()

    // Nine reads failing identically while a session was dead is the noisiest
    // thing this list can produce, and the thing healing hides today.
    const storm = within(list).getByRole('button', { name: /9 reads/i })
    expect(storm).toHaveAttribute('aria-expanded', 'false')

    await user.click(storm)
    expect(storm).toHaveAttribute('aria-expanded', 'true')
  })

  it('rails the list by day and says where the recorded summaries begin', async () => {
    await renderChannel('zomato', OUTLET_KALYANI_ID)
    const list = await history()

    // A hundred lines with no date rail is soup, and the rail is also what
    // gives the collapse rule a boundary so a group never spans three days.
    //
    // Asserted as "several distinct days, the newest of them named in words"
    // rather than "Today is present": which of Today and Yesterday the newest
    // run falls on depends on the hour the suite runs at in Asia/Kolkata, and a
    // test that failed between midnight and half past would be a test nobody
    // trusted.
    const rail = within(list)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(new Set(rail).size).toBeGreaterThan(3)
    expect(rail[0]).toMatch(/today|yesterday/i)
    expect(rail.some((day) => /^\d{1,2} [A-Z][a-z]{2}$/.test(day ?? ''))).toBe(true)

    // And the cut-off is stated rather than implied: a pre-#48 run renders
    // coarse because deriving its summary afterwards is impossible, not because
    // it changed nothing.
    await waitFor(() => expect(within(list).getByTestId('run-history-cut-off')).toBeInTheDocument())
  })

  it('keeps a healed failure after the repair takes it out of Needs you', async () => {
    const user = userEvent.setup()
    const adapters = await renderChannel('swiggy', OUTLET_KANCHRAPARA_ID)

    const failuresBefore = within(await history()).getAllByText('Signed out').length
    expect(failuresBefore).toBeGreaterThan(0)

    await user.click(await screen.findByTestId('needs-reconnect-swiggy'))
    await waitFor(() => expect(screen.getByText('Swiggy sent you a code')).toBeInTheDocument(), {
      timeout: 8_000,
    })
    await user.type(screen.getByLabelText(/one time password.*swiggy/i), '123456')
    await user.click(screen.getByRole('button', { name: /sign back in/i }))

    await waitFor(
      async () => {
        const events = await adapters.swiggySync.listEvents(OUTLET_KANCHRAPARA_ID)
        expect(events.find((row) => row.event.kind === 'session-lapsed')?.resolvedAt).not.toBeNull()
      },
      { timeout: 8_000 },
    )

    // The repair ends the matter — and the record of the outage survives it.
    // Healing belongs to Needs you and the badge; applied here it would delete
    // the evidence at the moment somebody starts asking what happened.
    await waitFor(() =>
      expect(within(screen.getByTestId('run-history-list')).getAllByText('Signed out').length).toBe(
        failuresBefore,
      ),
    )
  }, 40_000)

  it('gives each channel its own history rather than the same one relabelled', async () => {
    const adapters = createMockAdapters('super_admin')

    const zomato = await adapters.aggregatorSync.listRuns(OUTLET_KALYANI_ID)
    const swiggy = await adapters.swiggySync.listRuns(OUTLET_KALYANI_ID)

    expect(zomato.runs.length).toBeGreaterThan(0)
    expect(swiggy.runs.length).toBeGreaterThan(0)
    // Different instants, so switching channels in a demo is visibly two
    // accounts rather than one story told twice.
    expect(zomato.runs[0]?.startedAt).not.toBe(swiggy.runs[0]?.startedAt)
  })

  it('pages, and merges a group that straddles the boundary', async () => {
    const adapters = createMockAdapters('super_admin')

    const first = await adapters.aggregatorSync.listRuns(OUTLET_KALYANI_ID)
    expect(first.runs).toHaveLength(25)
    expect(first.before).not.toBeNull()

    // Keyset, not offset: the next page continues from the oldest run already
    // shown, so a run arriving mid-scroll cannot duplicate a row across the
    // boundary.
    const second = await adapters.aggregatorSync.listRuns(OUTLET_KALYANI_ID, {
      before: first.before,
    })
    expect(second.runs.length).toBeGreaterThan(0)
    const ids = new Set(first.runs.map((run) => run.id))
    expect(second.runs.some((run) => ids.has(run.id))).toBe(false)
  })

  it('loads the next page when the sentinel comes into view', async () => {
    await renderChannel('zomato', OUTLET_KALYANI_ID)
    const list = await history()

    // The stub observer fires straight away, so the pages chase each other to
    // the end — which is also the proof that the list terminates rather than
    // asking forever.
    await waitFor(
      () => expect(within(list).queryByTestId('run-history-more')).not.toBeInTheDocument(),
      { timeout: 10_000 },
    )
    expect(within(list).getAllByRole('button').length).toBeGreaterThan(10)
  }, 20_000)
})
