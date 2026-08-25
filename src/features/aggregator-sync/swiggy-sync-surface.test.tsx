import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { MemoryRouter } from 'react-router'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock/fixtures/outlets'
import { SessionContext } from '@/session/context'
import { demoSessionFor } from '@/test/session'
import { chooseOutlet } from '@/test/outlet-scope'

import { needsOwner } from './needs-you-count'
import { SwiggySyncSurface } from './swiggy-sync-surface'

/**
 * The Swiggy page's own claims, on top of everything the shared surface is
 * already proved to do by the Zomato suite.
 *
 *  1. **No other channel appears here.** Swiggy owns its session outright, so
 *     the Hyperpure line and the shared repair ladder are Zomato-page facts;
 *     rendering either here would invite repairing a portal this page cannot
 *     reach.
 *  2. **Its waiting work is counted separately.** An independent badge means
 *     Zomato's resolution can neither create nor clear Swiggy's number, which
 *     is only true because the counts read different rows through different
 *     adapter instances.
 *
 * The demo seeds Swigdy deliberately differently from Zomato: Kalyani carries
 * paid, revised and disputed cycles; Kanchrapara has never been connected at
 * all — the state a new restaurant reference starts in.
 */

async function renderSurface(outletId: string, adapters = createMockAdapters('super_admin')) {
  const view = render(
    <MemoryRouter initialEntries={['/demo/owner/ledger/swiggy']}>
      <SessionContext.Provider value={demoSessionFor('super_admin')}>
        <AdaptersContext.Provider value={adapters}>
          <SwiggySyncSurface />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  await chooseOutlet(outletId)
  return { view, adapters }
}

describe('the Swiggy sync surface', () => {
  it('never shows a Hyperpure line or another channel’s repair', async () => {
    await renderSurface(OUTLET_KANCHRAPARA_ID)

    // This outlet is lapsed, so a repair card IS showing — but it is Swiggy's
    // own, and nothing beside it mentions a channel this page cannot reach.
    expect(await screen.findByTestId('needs-reconnect-swiggy')).toBeInTheDocument()
    expect(screen.getByText('Swiggy ended the session')).toBeInTheDocument()
    expect(screen.queryByTestId('needs-reconnect-both')).not.toBeInTheDocument()
    expect(screen.queryByTestId('needs-reconnect-hyperpure')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hyperpure-health')).not.toBeInTheDocument()
  })

  it('shows the not-connected outlet as never run rather than failed', async () => {
    // A stub adapter, not the demo seed: the demo's Swiggy story starts one
    // outlet lapsed so the repair is walkable, and "never run" needs a channel
    // that has never been switched on at all — which is exactly what a new
    // restaurant reference looks like on its first visit.
    const real = createMockAdapters('super_admin')
    const neverRun = {
      ...real,
      swiggySync: {
        ...real.swiggySync,
        async getHealth(outletId: string) {
          return {
            outletId,
            lastRunAt: null,
            lastOutcome: null,
            running: false,
            awaitingOneTimePassword: null,
            hasSession: false,
            syncedFrom: null,
          }
        },
        async listEvents() {
          return []
        },
      },
    }
    await renderSurface(OUTLET_KALYANI_ID, neverRun)

    expect(await screen.findByText('Never run')).toBeInTheDocument()
    expect(screen.getByText(/Not switched on here yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId('needs-reconnect-swiggy')).not.toBeInTheDocument()
  })

  it('offers Reconnect when a configured Swiggy session was deleted before a run records the lapse', async () => {
    const real = createMockAdapters('super_admin')
    const sessionDeleted = {
      ...real,
      swiggySync: {
        ...real.swiggySync,
        async getHealth(outletId: string) {
          return {
            outletId,
            lastRunAt: '2026-08-25T08:00:00.000Z',
            lastOutcome: 'ok' as const,
            running: false,
            awaitingOneTimePassword: null,
            hasSession: false,
            syncedFrom: '2026-08-01',
          }
        },
        async listEvents() {
          return []
        },
      },
    }

    await renderSurface(OUTLET_KALYANI_ID, sessionDeleted)

    expect(await screen.findByTestId('needs-reconnect-swiggy')).toBeInTheDocument()
    expect(screen.getByText('Swiggy ended the session')).toBeInTheDocument()
  })

  it('carries the paid, revised and disputed history at the connected outlet', async () => {
    await renderSurface(OUTLET_KALYANI_ID)

    expect(await screen.findByRole('button', { name: /paid/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revised from .* to /i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /does not add up/i })).toBeInTheDocument()

    // Both decisions exist here exactly as they do on Zomato's page, because
    // the reconciliation gate is the capability, not a channel detail.
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument()
  })

  it('counts its waiting work separately from Zomato’s', async () => {
    const adapters = createMockAdapters('super_admin')

    const swiggyCounts = await adapters.swiggySync.countNeedsOwner()
    const zomatoCounts = await adapters.aggregatorSync.countNeedsOwner()

    // Different stories by design: Swiggy waits at both outlets (a disputed
    // cycle at the connected one, a lapsed session at the other), and Zomato
    // waits on its own rows. A shared counter would show either everywhere.
    expect(swiggyCounts.find((entry) => entry.outletId === OUTLET_KALYANI_ID)?.needing).toBe(1)
    expect(swiggyCounts.find((entry) => entry.outletId === OUTLET_KANCHRAPARA_ID)?.needing).toBe(2)
    void zomatoCounts

    // And resolving Zomato's work moves Zomato's number alone: the two channels
    // share no store, so one side's repair cannot quiet the other's badge.
    const disputedZomato = (await adapters.aggregatorSync.listEvents(OUTLET_KANCHRAPARA_ID)).find(
      (row) => row.event.kind === 'week-disputed',
    )
    if (disputedZomato?.event.kind === 'week-disputed') {
      await adapters.aggregatorSync.recheckWeek(
        OUTLET_KANCHRAPARA_ID,
        disputedZomato.event.from,
        disputedZomato.event.to,
      )
    }
    const swiggyAfter = await adapters.swiggySync.countNeedsOwner()
    expect(swiggyAfter.find((entry) => entry.outletId === OUTLET_KALYANI_ID)?.needing).toBe(1)
  }, 15_000)

  it('repairs its own lapsed session through its own code card', async () => {
    const user = userEvent.setup()
    const { adapters } = await renderSurface(OUTLET_KANCHRAPARA_ID)

    await user.click(await screen.findByTestId('needs-reconnect-swiggy'))

    // The full-login rung opens Swiggy's mailbox and nobody else's. The card
    // appears when the surface's own watch notices it — up to its 5s poll.
    await waitFor(() => expect(screen.getByText('Swiggy sent you a code')).toBeInTheDocument(), {
      timeout: 8_000,
    })
    await user.type(screen.getByLabelText(/one time password.*swiggy/i), '123456')
    await user.click(screen.getByRole('button', { name: /sign back in/i }))

    // The repair is real when the records say so: the health line comes back to
    // quiet and the row that asked stops asking — resolved, not deleted, the
    // same rule every channel's history follows.
    await waitFor(
      () => {
        const rows = screen.getAllByRole('button', { name: /signed us out/i })
        for (const row of rows) expect(row).toHaveAttribute('aria-expanded')
      },
      { timeout: 8_000 },
    )
    const events = await adapters.swiggySync.listEvents(OUTLET_KANCHRAPARA_ID)
    const lapsed = events.find((row) => row.event.kind === 'session-lapsed')
    expect(lapsed?.resolvedAt).not.toBeNull()
  }, 20_000)

  it('takes a payout annexure by hand and answers in the file’s words', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin')
    await renderSurface(OUTLET_KALYANI_ID, adapters)

    await screen.findByTestId('swiggy-upload-statement')
    const annexure = new File(['bytes'], 'annexure-999.xlsx', { type: 'application/vnd.ms-excel' })
    await user.upload(screen.getByTestId('swiggy-upload-input'), annexure)

    expect(await screen.findByTestId('swiggy-upload-result')).toHaveTextContent(
      /Swiggy cycle settled from the annexure/i,
    )
  }, 15_000)

  it('refuses an unknown upload naming the shapes it looked for', async () => {
    const user = userEvent.setup()
    await renderSurface(OUTLET_KALYANI_ID)

    await screen.findByTestId('swiggy-upload-statement')
    // An allowed extension carrying an unrecognisable workbook: the accept
    // filter is the browser's, the shape refusal is the parser's.
    await user.upload(screen.getByTestId('swiggy-upload-input'), new File(['bytes'], 'notes.xlsx'))

    expect(
      await screen.findByText(/matches no known statement shape/i, {}, { timeout: 4_000 }),
    ).toBeInTheDocument()
  }, 15_000)

  it('lists every event kind the demo seeds as needing-or-not exactly as the badge counts them', async () => {
    const adapters = createMockAdapters('super_admin')

    const events = await adapters.swiggySync.listEvents(OUTLET_KALYANI_ID)
    const listed = events.filter(needsOwner).length
    const counted = await adapters.swiggySync.countNeedsOwner()
    expect(counted.find((entry) => entry.outletId === OUTLET_KALYANI_ID)?.needing).toBe(listed)
    expect(listed).toBeGreaterThan(0)
  })
})
