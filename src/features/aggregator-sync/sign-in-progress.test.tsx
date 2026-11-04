import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MemoryRouter, Route, Routes } from 'react-router'

import type { AggregatorSyncAdapter, AggregatorSyncHealth } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { OUTLET_KANCHRAPARA_ID } from '@/data-access/mock/fixtures/outlets'
import type { SignInView } from '@/domain/sign-in-progress'
import { SessionContext } from '@/session/context'
import { chooseOutlet } from '@/test/outlet-scope'
import { demoSessionFor } from '@/test/session'

import type { AggregatorChannelConfig } from './channel-config'
import { DeliverySyncSurface } from './delivery-sync-surface'
import { SignInProgress } from './sign-in-progress'

/**
 * The sign-in, told as it happens (#46).
 *
 * Two layers. The card on its own, for every way a sign-in can stand — live,
 * quiet, stopped, retried, Swiggy's shorter list — and the surface around it,
 * for what the card replaces and what a finished sign-in stops asking for.
 */

const now = new Date('2026-11-03T10:00:00Z').getTime()

function configFor(channel: 'zomato' | 'swiggy'): AggregatorChannelConfig {
  const label = channel === 'zomato' ? 'Zomato' : 'Swiggy'
  return {
    channel,
    adapter: {} as AggregatorSyncAdapter,
    title: label,
    subtitle: '',
    label,
    showsHyperpure: channel === 'zomato',
    testIdPrefix: channel,
    attention: { source: channel === 'zomato' ? 'zomato-needs-you' : 'swiggy-needs-you' },
    pathSegment: channel === 'zomato' ? '/delivery/zomato' : '/delivery/swiggy',
    otpHeading: `${label} sent you a code`,
    uploadHint: '',
    uploadAccept: '',
    lapsedTitle: '',
  }
}

function renderCard(
  view: Extract<SignInView, { kind: 'live' | 'quiet' | 'stopped' }>,
  overrides: Partial<Parameters<typeof SignInProgress>[0]> = {},
) {
  const onReconnect = vi.fn()
  render(
    <SignInProgress
      config={configFor('zomato')}
      view={view}
      waiting={null}
      codeAttempts={0}
      codeSent={false}
      code=""
      now={now}
      busy={false}
      onCode={() => undefined}
      onSubmitCode={(event) => event.preventDefault()}
      onReconnect={onReconnect}
      {...overrides}
    />,
  )
  return { onReconnect }
}

const stateOf = (step: string) =>
  document.querySelector(`[data-step="${step}"]`)?.getAttribute('data-step-state')

describe('the sign-in card', () => {
  it('ticks what is behind, marks where it is, and leaves the rest waiting', () => {
    renderCard({ kind: 'live', stage: 'signing_in' })

    expect(stateOf('starting')).toBe('past')
    expect(stateOf('opening_portal')).toBe('past')
    expect(stateOf('signing_in')).toBe('current')
    expect(stateOf('waiting_for_code')).toBe('upcoming')
    expect(screen.getByText('Opening the Zomato partner portal')).toBeInTheDocument()
    expect(screen.getByText('Signing in as you').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    )
  })

  it('offers no second Reconnect while the sign-in is live', () => {
    renderCard({ kind: 'live', stage: 'starting' })
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()
  })

  it('shows no code field before the stage that asks for one', () => {
    renderCard(
      { kind: 'live', stage: 'signing_in' },
      { waiting: { expiresAt: new Date(now + 300_000).toISOString() } },
    )
    expect(screen.queryByLabelText(/one time password/i)).not.toBeInTheDocument()
  })

  it('puts the code field and its countdown inside “Waiting for your code”', () => {
    renderCard(
      { kind: 'live', stage: 'waiting_for_code' },
      { waiting: { expiresAt: new Date(now + 272_000).toISOString() } },
    )
    const step = document.querySelector('[data-step="waiting_for_code"]') as HTMLElement
    const field = within(step).getByLabelText(/one time password zomato sent/i)
    expect(field).toHaveAttribute('autocomplete', 'one-time-code')
    expect(within(step).getByTestId('zomato-otp-left')).toHaveTextContent('4:32 left')
    expect(within(step).getByRole('button', { name: /sign back in/i })).toBeInTheDocument()
  })

  it('says a refused code was refused, rather than silently asking again', () => {
    renderCard(
      { kind: 'live', stage: 'waiting_for_code' },
      { waiting: { expiresAt: new Date(now + 200_000).toISOString() }, codeAttempts: 1 },
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/not accepted/i)
    expect(stateOf('checking_code')).toBe('upcoming')
  })

  it('steps the field aside once a code is on its way', () => {
    renderCard(
      { kind: 'live', stage: 'waiting_for_code' },
      { waiting: { expiresAt: new Date(now + 200_000).toISOString() }, codeSent: true },
    )
    expect(screen.queryByLabelText(/one time password/i)).not.toBeInTheDocument()
    expect(screen.getByText('Code sent')).toBeInTheDocument()
  })

  it('stills the ring while the code is the owner’s to give, and turns it again once sent', () => {
    const mark = () =>
      document.querySelector('[data-step="waiting_for_code"] [data-mark]') as HTMLElement
    const waiting = { expiresAt: new Date(now + 200_000).toISOString() }

    renderCard({ kind: 'live', stage: 'waiting_for_code' }, { waiting })
    expect(mark()).toHaveAttribute('data-mark', 'still')
    expect(mark()).not.toHaveClass('animate-spin')
    cleanup()

    renderCard({ kind: 'live', stage: 'waiting_for_code' }, { waiting, codeSent: true })
    expect(mark()).toHaveAttribute('data-mark', 'turning')
  })

  it('stops claiming a stage that went quiet, and offers Reconnect', async () => {
    const user = userEvent.setup()
    const { onReconnect } = renderCard({ kind: 'quiet', stage: 'opening_portal' })

    expect(stateOf('opening_portal')).toBe('quiet')
    expect(document.querySelector('[aria-current="step"] .animate-pulse')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('This sign-in has gone quiet.')
    await user.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(onReconnect).toHaveBeenCalledOnce()
  })

  it('says a stopped sign-in stopped, and claims no stage at all', () => {
    renderCard({ kind: 'stopped' })
    expect(screen.getByRole('status')).toHaveTextContent('The sign-in stopped.')
    expect(document.querySelector('[data-step]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
  })

  it('gives Swiggy no Hyperpure step to wait on', () => {
    render(
      <SignInProgress
        config={configFor('swiggy')}
        view={{ kind: 'live', stage: 'checking_code' }}
        waiting={null}
        codeAttempts={0}
        codeSent={false}
        code=""
        now={now}
        busy={false}
        onCode={() => undefined}
        onSubmitCode={() => undefined}
        onReconnect={() => undefined}
      />,
    )
    expect(screen.queryByText('Bringing Hyperpure along')).not.toBeInTheDocument()
    expect(screen.getByText('Opening the Swiggy partner portal')).toBeInTheDocument()
  })
})

/** The surface with this outlet's Zomato health replaced by `patch`. */
async function renderWithHealth(patch: (live: AggregatorSyncHealth) => AggregatorSyncHealth) {
  const adapters = createMockAdapters('super_admin')
  const real = adapters.aggregatorSync.getHealth
  adapters.aggregatorSync.getHealth = async (outletId) => patch(await real(outletId))
  const requestRun = vi.spyOn(adapters.aggregatorSync, 'requestRun')
  render(
    <MemoryRouter initialEntries={['/demo/owner/ledger/delivery/zomato']}>
      <SessionContext.Provider value={demoSessionFor('super_admin')}>
        <AdaptersContext.Provider value={adapters}>
          <Routes>
            <Route path="/demo/owner/ledger/delivery/:channel" element={<DeliverySyncSurface />} />
          </Routes>
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  await chooseOutlet(OUTLET_KANCHRAPARA_ID)
  return { adapters, requestRun }
}

const recently = (ms: number) => new Date(Date.now() - ms).toISOString()

describe('the surface around a sign-in', () => {
  it('replaces the card the owner tapped rather than sitting beside it', async () => {
    await renderWithHealth((health) => ({
      ...health,
      signIn: { stage: 'signing_in', at: recently(5_000) },
    }))

    expect(await screen.findByTestId('zomato-sign-in')).toHaveAttribute(
      'data-sign-in-state',
      'live',
    )
    expect(screen.queryByTestId(/needs-reconnect-/)).not.toBeInTheDocument()
  })

  it('keeps the old code card when a code is awaited and no sign-in is on screen', async () => {
    await renderWithHealth((health) => ({
      ...health,
      signIn: null,
      awaitingOneTimePassword: { requestedAt: recently(10_000), expiresAt: recently(-200_000) },
    }))

    expect(await screen.findByText('Zomato sent you a code')).toBeInTheDocument()
    expect(screen.getByLabelText(/one time password/i)).toBeInTheDocument()
    expect(screen.queryByTestId('zomato-sign-in')).not.toBeInTheDocument()
  })

  it('shows one code field, never two, while the sign-in holds it', async () => {
    await renderWithHealth((health) => ({
      ...health,
      signIn: { stage: 'waiting_for_code', at: recently(5_000) },
      awaitingOneTimePassword: { requestedAt: recently(5_000), expiresAt: recently(-295_000) },
    }))

    await screen.findByTestId('zomato-sign-in')
    expect(screen.getAllByLabelText(/one time password/i)).toHaveLength(1)
  })

  it('stops asking to reconnect once a sign-in finished, and reads once per outlet', async () => {
    const { requestRun } = await renderWithHealth((health) => ({
      ...health,
      signIn: { stage: 'done', at: recently(20_000) },
    }))

    expect(await screen.findByTestId('zomato-signed-back-in')).toHaveTextContent(
      'Signed back in to Zomato',
    )
    expect(screen.queryByTestId(/needs-reconnect-(zomato|both)/)).not.toBeInTheDocument()
    // Each outlet's figures are their own read, so the outlet on screen is
    // asked for once — and never again for the same finished sign-in.
    await waitFor(() => expect(requestRun).toHaveBeenCalledWith(OUTLET_KANCHRAPARA_ID))
    await new Promise((resolve) => setTimeout(resolve, 3_500))
    const forThisOutlet = requestRun.mock.calls.filter(
      ([outlet]) => outlet === OUTLET_KANCHRAPARA_ID,
    )
    expect(forThisOutlet).toHaveLength(1)
  })

  it('does not let the old “signed us out” row ask again after a finished sign-in', async () => {
    const adapters = createMockAdapters('super_admin')
    const real = adapters.aggregatorSync.getHealth
    adapters.aggregatorSync.getHealth = async (outletId) => ({
      ...(await real(outletId)),
      // Kept unread so the lapsed row stays unresolved, as it does live until a
      // read succeeds.
      syncedFrom: null,
      signIn: { stage: 'done', at: recently(20_000) },
    })
    adapters.aggregatorSync.getHyperpureHealth = async () => ({
      lastRunAt: recently(60_000),
      lastOutcome: 'ok',
      running: false,
      hasSession: true,
      sessionExpiresAt: recently(-86_400_000),
      readsPerDay: 4,
    })
    render(
      <MemoryRouter initialEntries={['/demo/owner/ledger/delivery/zomato']}>
        <SessionContext.Provider value={demoSessionFor('super_admin')}>
          <AdaptersContext.Provider value={adapters}>
            <Routes>
              <Route
                path="/demo/owner/ledger/delivery/:channel"
                element={<DeliverySyncSurface />}
              />
            </Routes>
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    )
    await chooseOutlet(OUTLET_KANCHRAPARA_ID)

    await screen.findByTestId('zomato-signed-back-in')
    const lapsedRows = (await adapters.aggregatorSync.listEvents(OUTLET_KANCHRAPARA_ID)).filter(
      (row) => row.event.kind === 'session-lapsed' && row.resolvedAt === null,
    )
    expect(lapsedRows.length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()
  })

  it('locks the page beneath a live sign-in, and only that page', async () => {
    await renderWithHealth((health) => ({
      ...health,
      signIn: { stage: 'opening_portal', at: recently(5_000) },
    }))

    const lock = await screen.findByTestId('zomato-sign-in-lock')
    expect(within(lock).getByTestId('zomato-sign-in')).toHaveAttribute('data-sign-in-state', 'live')
    // Everything else on the page takes no input until the sign-in ends.
    const page = lock.previousElementSibling as HTMLElement
    expect(page).toHaveAttribute('inert')
  })

  it('does not lock the page for a sign-in that went quiet', async () => {
    await renderWithHealth((health) => ({
      ...health,
      signIn: { stage: 'signing_in', at: recently(5 * 60_000) },
    }))

    expect(await screen.findByTestId('zomato-sign-in')).toHaveAttribute(
      'data-sign-in-state',
      'quiet',
    )
    expect(screen.queryByTestId('zomato-sign-in-lock')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read now' })).toBeInTheDocument()
  })

  it('frees the page the moment a held sign-in reports it stopped', async () => {
    // What login.yml's failure-or-cancel step records when the run ends badly.
    let signIn: AggregatorSyncHealth['signIn'] = { stage: 'waiting_for_code', at: recently(1_000) }
    await renderWithHealth((health) => ({ ...health, signIn }))
    await screen.findByTestId('zomato-sign-in-lock')

    signIn = { stage: 'stopped', at: recently(0) }
    await waitFor(
      () => expect(screen.queryByTestId('zomato-sign-in-lock')).not.toBeInTheDocument(),
      { timeout: 8_000 },
    )
    expect(screen.getByTestId('zomato-sign-in')).toHaveAttribute('data-sign-in-state', 'stopped')
    expect(screen.getByTestId('zomato-sign-in-again')).toBeEnabled()
  }, 15_000)

  it('ends a watched sign-in with every step ticked until Done, even after the read', async () => {
    let signIn: AggregatorSyncHealth['signIn'] = {
      stage: 'bringing_hyperpure',
      at: recently(1_000),
    }
    await renderWithHealth((health) => ({ ...health, signIn }))
    await screen.findByTestId('zomato-sign-in-lock')

    signIn = { stage: 'done', at: recently(0) }
    const done = await screen.findByTestId('zomato-sign-in-done', {}, { timeout: 8_000 })
    expect(screen.getByTestId('zomato-sign-in')).toHaveAttribute('data-sign-in-state', 'done')
    for (const step of within(screen.getByTestId('zomato-sign-in')).getAllByRole('listitem')) {
      expect(step).toHaveAttribute('data-step-state', 'past')
    }

    // The read it starts overtakes the finished sign-in; the panel waits for Done.
    signIn = null
    await new Promise((resolve) => setTimeout(resolve, 6_000))
    expect(screen.getByTestId('zomato-sign-in-lock')).toBeInTheDocument()

    await userEvent.click(done)
    expect(screen.queryByTestId('zomato-sign-in-lock')).not.toBeInTheDocument()
  }, 20_000)

  it('lets an old sign-in fall away, so the ordinary card speaks again', async () => {
    await renderWithHealth((health) => ({
      ...health,
      signIn: { stage: 'stopped', at: recently(45 * 60_000) },
    }))

    expect(await screen.findByTestId('needs-reconnect-both')).toBeInTheDocument()
    expect(screen.queryByTestId('zomato-sign-in')).not.toBeInTheDocument()
  })
})
