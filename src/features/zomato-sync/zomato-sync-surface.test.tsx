import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { MemoryRouter } from 'react-router'

import type { AggregatorSyncHealth } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock/fixtures/outlets'
import { SessionContext } from '@/session/context'
import { chooseOutlet } from '@/test/outlet-scope'
import { demoSessionFor } from '@/test/session'

import { needsOwner } from './needs-you-count'
import { readAgainInHours, ZomatoSyncSurface } from './zomato-sync-surface'

/**
 * The two claims this surface makes that are easy to break and hard to notice.
 *
 *  1. **A row stops asking once it has been dealt with.** A resolved week left
 *     under "Needs you" reads as still open, and the owner would go looking for
 *     a decision they have already made. This was wrong on the first build and
 *     is exactly the kind of thing that stays wrong.
 *
 *  2. **Nothing can absorb a discrepancy quietly.** A week that will not
 *     reconcile offers checking again and accepting the gap on the record. The
 *     absence of a third option is the whole point of the reconciliation gate,
 *     and a well-meaning "just write it" button added later would defeat the
 *     capability without failing anything else.
 *
 * The outlet scope is not exercised here: it belongs to `useOutletScope` and has
 * its own tests. These render against one outlet each, chosen for the state it
 * starts in.
 */

async function renderSurface(outletId: string) {
  render(
    // At its real address, because the ledger link is derived from it: the role
    // segment differs per shell and demo mode carries the persona in the URL, so
    // a hard-coded path would walk the reader into somebody else's shell.
    <MemoryRouter initialEntries={['/demo/owner/ledger/zomato']}>
      <SessionContext.Provider value={demoSessionFor('super_admin')}>
        <AdaptersContext.Provider value={createMockAdapters('super_admin')}>
          <ZomatoSyncSurface />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  // Chosen rather than assumed: the demo seeds one outlet healthy and one with a
  // lapsed session and a week that will not reconcile, and each test needs the
  // one whose state it is about.
  await chooseOutlet(outletId)
}

/** Which section a row currently sits under, by its heading. */
function sectionHolding(name: RegExp): string {
  const row = screen.getByRole('button', { name })
  return row.closest('section')?.querySelector('h2')?.textContent ?? ''
}

describe('the Zomato sync surface', () => {
  it('offers no way to write a week that does not reconcile without saying so', async () => {
    await renderSurface(OUTLET_KANCHRAPARA_ID)

    // By accessible name rather than visible text. The row shows a tag, a week
    // and a figure; the sentence is what it is announced as, and that is the
    // thing a person who cannot see the colour has to be given.
    expect(await screen.findByRole('button', { name: /does not add up/i })).toBeInTheDocument()

    // Both offers, and nothing else. A button that wrote the figures without
    // recording the gap would pass every other test in this file.
    expect(screen.getByRole('button', { name: /check again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /accept the difference/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ignore/i })).not.toBeInTheDocument()
  })

  it('names what a figure changed from on the closed row, not inside it', async () => {
    await renderSurface(OUTLET_KALYANI_ID)

    // The question this page exists to answer is "why did this day's number
    // move", so a row that only says something moved has sent the reader away to
    // find out. Both figures are shown, and both are spoken: a screen reader
    // told only that a day was revised has been told less than the screen says.
    const revised = await screen.findByRole('button', { name: /revised from .* to /i })
    expect(revised).toHaveAttribute('aria-expanded', 'false')
  })

  it('stops a resolved week asking for a decision, and keeps it on the page', async () => {
    const user = userEvent.setup()
    await renderSurface(OUTLET_KANCHRAPARA_ID)

    await screen.findByRole('button', { name: /does not add up/i })
    expect(screen.getByRole('heading', { name: /needs you/i })).toBeInTheDocument()

    // The lapsed session at this outlet is still asking, so the section itself
    // stays. What must change is which section this row is in — asserting that
    // the heading disappeared would pass for the wrong reason at an outlet with
    // one problem and fail at one with two.
    expect(sectionHolding(/does not add up/i)).toMatch(/needs you/i)

    await user.click(screen.getByRole('button', { name: /check again/i }))

    // Resolved, not deleted: "this week did not add up in July" is worth being
    // able to find later, and removing the row would remove the only record that
    // it ever did not.
    await waitFor(() => expect(sectionHolding(/does not add up/i)).toMatch(/what changed/i), {
      timeout: 8_000,
    })

    expect(
      within(screen.getByRole('heading', { name: /needs you/i }).closest('section')!).queryByRole(
        'button',
        { name: /check again/i },
      ),
    ).not.toBeInTheDocument()
  }, 15_000)

  it('badges exactly what the page lists as needing you, across both outlets', async () => {
    const adapters = createMockAdapters('super_admin')

    // The count the tab badge reads, and the rows the page groups under "Needs
    // you", are computed in two different places: one in the adapter, one in the
    // surface. They can drift, and a badge counting something other than what
    // the page shows is worse than no badge — it sends somebody looking for work
    // that is not there, or hides work that is.
    const counted = await adapters.aggregatorSync.countNeedsOwner()

    // Per outlet as well as in total, because the chip on each outlet shows its
    // own number. A total that matched while the split did not would send the
    // reader to the wrong outlet, which is the failure this page exists to spare
    // them.
    for (const outletId of [OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID]) {
      const listed = (await adapters.aggregatorSync.listEvents(outletId)).filter(needsOwner).length
      expect(counted.find((entry) => entry.outletId === outletId)?.needing).toBe(listed)
    }

    // Not vacuous: the demo deliberately starts with work waiting at both
    // outlets, or every assertion above would pass on zeroes.
    expect(counted.every((entry) => entry.needing > 0)).toBe(true)
  })

  it('inverts the badge on the chosen outlet, which is filled with the badge colour', async () => {
    await renderSurface(OUTLET_KALYANI_ID)

    const chosen = await screen.findByTestId(`zomato-needing-${OUTLET_KALYANI_ID}`)
    const other = screen.getByTestId(`zomato-needing-${OUTLET_KANCHRAPARA_ID}`)

    // A selected chip is filled with `--primary`, which is also the badge's own
    // background. Left alone the badge disappears into the chip and only its
    // digit survives, which is how this shipped the first time. The inversion is
    // the same asserted pair the other way round, so the contrast validator
    // already covers both directions.
    expect(chosen.className).toContain('bg-on-primary')
    expect(chosen.className).toContain('text-primary')
    expect(other.className).not.toContain('bg-on-primary')
  })

  it('carries a reconnect on the Hyperpure line when its session is down, even with Zomato healthy', async () => {
    // The gap this closes: Hyperpure rides the Zomato login, but a healthy Zomato
    // shows no reconnect anywhere, so a lapsed Hyperpure with only that button
    // elsewhere would strand the owner. Kalyani's Zomato is healthy; Hyperpure
    // starts lapsed. The line names the state and offers the fix on the spot.
    await renderSurface(OUTLET_KALYANI_ID)

    const line = await screen.findByTestId('hyperpure-health')
    expect(line).toHaveTextContent(/Hyperpure/)
    expect(line).toHaveTextContent(/Session ended/)
    const reconnect = within(line).getByTestId('hyperpure-reconnect')
    expect(reconnect).toBeEnabled()

    // It is the same login as Zomato's: one code restores both channels.
    await userEvent.click(reconnect)
    expect(
      await screen.findByText(/Zomato sent you a code/, {}, { timeout: 3000 }),
    ).toBeInTheDocument()
  })

  it('offers Read now only when reading again could say something new', async () => {
    /*
     * Two reasons to withhold it, and they are different in kind [owner,
     * 2026-08-18]. A run in progress is about correctness: two readers would race
     * for one Zomato session. A successful run in the last six hours is about not
     * offering a button whose only effect is to make the owner wait for figures
     * they already have.
     *
     * Kalyani is the healthy outlet, and the demo seeds its last run 36 minutes
     * ago — inside the window, so the button is withheld and says why.
     */
    await renderSurface(OUTLET_KALYANI_ID)

    const button = await screen.findByTestId('read-now')
    expect(button).toBeDisabled()
    expect(screen.getByTestId('read-now-why')).toHaveTextContent(/again in \d+h/i)
  })

  it('offers Read now after a failure, which is exactly when it is wanted', async () => {
    /*
     * The lockout counts SUCCESSFUL runs only. Kanchrapara's session has lapsed, so
     * its last run failed 15 minutes ago — well inside six hours. A rule that
     * counted failures would leave the owner staring at a disabled button on the
     * one screen built to fix the thing that failed.
     */
    await renderSurface(OUTLET_KANCHRAPARA_ID)

    const button = await screen.findByTestId('read-now')
    expect(button).toBeEnabled()
    expect(screen.queryByTestId('read-now-why')).not.toBeInTheDocument()
  })

  it('decides the six-hour lockout from the run outcome, not from the clock alone', () => {
    /*
     * Tested as a function rather than through the screen, because the interesting
     * cases are times of day and the surface can only be rendered at one of them.
     * `now` is a parameter for the same reason it is not read during render: a
     * component that consults a clock while rendering can disagree with itself.
     */
    const at = (iso: string, outcome: AggregatorSyncHealth['lastOutcome']) =>
      ({
        outletId: OUTLET_KALYANI_ID,
        lastRunAt: iso,
        lastOutcome: outcome,
        running: false,
        awaitingOneTimePassword: null,
        syncedFrom: '2026-08-01',
      }) satisfies AggregatorSyncHealth

    const now = Date.parse('2026-08-18T12:00:00Z')
    const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString()

    // Inside the window, and the remainder is rounded up so it never reads "0h".
    expect(readAgainInHours(at(hoursAgo(0.1), 'ok'), now)).toBe(6)
    expect(readAgainInHours(at(hoursAgo(5.2), 'ok'), now)).toBe(1)
    // On the boundary and past it, the button comes back.
    expect(readAgainInHours(at(hoursAgo(6), 'ok'), now)).toBeNull()
    expect(readAgainInHours(at(hoursAgo(30), 'ok'), now)).toBeNull()
    // A failure never locks it out, whatever the clock says.
    expect(readAgainInHours(at(hoursAgo(0.2), 'session_lapsed'), now)).toBeNull()
    expect(readAgainInHours(at(hoursAgo(0.2), 'reconciliation_failed'), now)).toBeNull()
    // And neither does a sync that has never run.
    expect(readAgainInHours(at(hoursAgo(0.2), null), now)).toBeNull()
  })

  it('sends a possible duplicate to the exact day it is about', async () => {
    await renderSurface(OUTLET_KALYANI_ID)

    // The row asks the owner to withdraw one of two expenses, which happens in
    // the ledger. Telling somebody to go somewhere without taking them there is
    // how they end up on the wrong day, and this row is about one specific day.
    const link = await screen.findByRole('link', { name: /open .* ledger/i })
    expect(link.getAttribute('href')).toMatch(/\/ledger\?date=\d{4}-\d{2}-\d{2}$/)

    // And the one answer the ledger cannot give: both are real. Without it the
    // flag would sit there forever asking a question already answered.
    expect(screen.getByRole('button', { name: /not a duplicate/i })).toBeInTheDocument()
  })

  it('offers the safer option inside the dialog that recommends it', async () => {
    const user = userEvent.setup()
    await renderSurface(OUTLET_KANCHRAPARA_ID)

    await user.click(await screen.findByRole('button', { name: /accept the difference/i }))

    const dialog = await screen.findByRole('dialog', { name: /accept the difference/i })
    // The consequence tells the reader to check again first. A dialog that says
    // so and then offers only Cancel and Confirm is asking them to go and find a
    // button they cannot see, which is how they press this one instead.
    expect(within(dialog).getByRole('button', { name: /check again/i })).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: /record it as unexplained/i }),
    ).toBeInTheDocument()
  }, 15_000)

  it('asks for the code by a name that says which outlet it belongs to', async () => {
    const user = userEvent.setup()
    await renderSurface(OUTLET_KANCHRAPARA_ID)

    await user.click(await screen.findByRole('button', { name: /reconnect zomato/i }))

    const field = await screen.findByLabelText(/one time password/i, {}, { timeout: 8_000 })
    // Typed on a phone by definition, so it must not trip the mobile-zoom
    // threshold and must offer the platform's own code autofill.
    expect(field).toHaveAttribute('autocomplete', 'one-time-code')
    expect(field).toHaveAttribute('inputmode', 'numeric')
  }, 15_000)

  it('takes a statement uploaded by hand and says what it wrote, per outlet', async () => {
    await renderSurface(OUTLET_KALYANI_ID)

    const upload = await screen.findByTestId('upload-statement')
    // The control names the three files it takes, so a person reaching for it
    // under pressure is not guessing which to bring.
    expect(within(upload).getByText(/order history/i)).toBeInTheDocument()

    const file = new File(['fake-bytes'], 'order_history_20260817_20260818.zip')
    await userEvent.upload(screen.getByTestId('upload-input'), file)

    const result = await screen.findByTestId('upload-result')
    // A per-outlet report rather than a silent refresh: the owner sees the upload
    // did something and where.
    expect(result).toHaveTextContent(/Kalyani/)
    expect(result).toHaveTextContent(/Kanchrapara/)
  })

  it('refuses a file it cannot place, in the file’s own words', async () => {
    await renderSurface(OUTLET_KALYANI_ID)
    await screen.findByTestId('upload-statement')

    const file = new File(['nope'], 'holiday-photos.zip')
    await userEvent.upload(screen.getByTestId('upload-input'), file)

    // The specific refusal, not a generic "did not go through": "matches no known
    // shape" tells the owner the file is wrong rather than the connection.
    expect(await screen.findByText(/matches no known statement shape/i)).toBeInTheDocument()
    expect(screen.queryByTestId('upload-result')).not.toBeInTheDocument()
  })

  it('says an upload needs a connection rather than pretending to queue it', async () => {
    const online = Object.getOwnPropertyDescriptor(navigator, 'onLine')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    try {
      await renderSurface(OUTLET_KALYANI_ID)
      await screen.findByTestId('upload-statement')

      const file = new File(['x'], 'order_history_20260817_20260818.zip')
      await userEvent.upload(screen.getByTestId('upload-input'), file)

      // Said outright, and nothing written: a statement is a deliberate recovery,
      // not something to replay later against figures that may have moved.
      expect(await screen.findByText(/needs a connection/i)).toBeInTheDocument()
      expect(screen.queryByTestId('upload-result')).not.toBeInTheDocument()
    } finally {
      if (online) Object.defineProperty(navigator, 'onLine', online)
    }
  })
})
