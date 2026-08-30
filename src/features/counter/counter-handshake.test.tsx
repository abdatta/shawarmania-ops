import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import type { DataAdapters } from '@/data-access/adapters'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import { CounterDeviceContext } from '@/session/counter-context'
import type { CounterDeviceSession } from '@/session/counter-session'
import { SessionContext } from '@/session/context'
import { demoSessionFor } from '@/test/session'

import { CounterHandshakeCards } from './counter-handshake-cards'
import { ShiftRequestScreen } from './shift-request-screen'

/**
 * The two-device handshake, from both ends.
 *
 * The mock adapter reproduces the states rather than the security, so what is
 * asserted here is what a person and a tablet **see and can do** — that a wrong
 * code refuses, that rejecting needs no code, that a request nobody answers
 * leaves the screen, and that an unknown username is indistinguishable from a
 * real one. Whether the database actually refuses any of it is proved in
 * `supabase/tests/23_counter_tablet_and_shift.sql`, and nothing here is a
 * substitute for that.
 */

const DEVICE: CounterDeviceSession = {
  kind: 'counter-device',
  device: {
    deviceId: 'd5000000-0000-4000-a000-000000000001',
    outletId: '00000000-0000-4000-a000-000000000001',
    label: 'Counter tablet',
  },
  shift: null,
}

/**
 * One demo session shared by both ends, which is what makes this a handshake
 * test rather than two component tests: the tablet's request and the phone's
 * card are the same row seen twice.
 */
function bothEnds() {
  const data = createDemoData()
  return {
    tablet: createMockAdapters('biller', data),
    phone: createMockAdapters('employee', data),
  }
}

function renderPhone(adapters: DataAdapters) {
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={demoSessionFor('employee')}>
        <AdaptersContext.Provider value={adapters}>
          <CounterHandshakeCards />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

function renderTablet(adapters: DataAdapters, onOpened = vi.fn()) {
  return {
    onOpened,
    ...render(
      <CounterDeviceContext.Provider value={DEVICE}>
        <AdaptersContext.Provider value={adapters}>
          <ShiftRequestScreen onOpened={onOpened} />
        </AdaptersContext.Provider>
      </CounterDeviceContext.Provider>,
    ),
  }
}

/** The four digits, as the tablet is showing them. */
async function askFor(name: string, adapters: DataAdapters): Promise<string> {
  const user = userEvent.setup()
  renderTablet(adapters)
  await user.type(await screen.findByLabelText('Username'), name)
  await user.click(screen.getByRole('button', { name: /ask to open the counter/i }))
  const code = await screen.findByTestId('counter-shift-code')
  return code.textContent ?? ''
}

describe('the tablet asking', () => {
  it('shows four digits, and shows them big enough to read across a counter', async () => {
    const { tablet } = bothEnds()
    const code = await askFor('Demo Staff', tablet)

    expect(code).toMatch(/^\d{4}$/)
    // The size is the property, not the styling: a code nobody can read from the
    // other side of a counter proves nothing about where they are standing.
    expect(screen.getByTestId('counter-shift-code').className).toMatch(/text-7xl/)
  })

  it('answers an unknown username exactly as it answers a real one', async () => {
    const { tablet } = bothEnds()
    const known = await askFor('Demo Staff', tablet)
    const knownWait = screen.getByRole('button', { name: /cancel/i })
    expect(knownWait).toBeInTheDocument()
    cleanup()

    const fresh = bothEnds()
    const unknown = await askFor('nobody-works-here', fresh.tablet)

    // Same shape, same waiting state, same controls. Nothing on this screen
    // distinguishes a name that exists from one that does not.
    expect(known).toMatch(/^\d{4}$/)
    expect(unknown).toMatch(/^\d{4}$/)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByTestId('counter-shift-code').className).toMatch(/text-7xl/)
  })

  it('withdraws its own request when the name was mistyped', async () => {
    const user = userEvent.setup()
    const { tablet, phone } = bothEnds()
    await askFor('Demo Staff', tablet)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(await screen.findByLabelText('Username')).toBeInTheDocument()

    // And the card is gone from the phone, which is the half that matters: a
    // withdrawn request left sitting on somebody's screen is worse than none.
    renderPhone(phone)
    await waitFor(() => {
      expect(screen.queryByTestId('counter-request-card')).not.toBeInTheDocument()
    })
  })

  it('takes the card off the phone and says why, rather than letting it vanish', async () => {
    const user = userEvent.setup()
    const { tablet, phone } = bothEnds()
    await askFor('Demo Staff', tablet)

    renderPhone(phone)
    await screen.findByTestId('counter-request-card')

    await user.click(screen.getAllByRole('button', { name: /cancel/i })[0]!)

    // A card that disappears mid-sentence reads as a glitch, and worse, sends
    // somebody to type four digits into a form that is no longer there.
    const notice = await screen.findByTestId('counter-request-withdrawn')
    expect(notice).toHaveTextContent(/no longer waiting/i)
    expect(notice).toHaveTextContent(/withdrawn at the tablet, or it timed out/i)
    expect(screen.queryByTestId('counter-request-card')).not.toBeInTheDocument()
  })
})

describe('the phone answering', () => {
  it('renders nothing at all when no counter is asking', async () => {
    const { phone } = bothEnds()
    const { container } = renderPhone(phone)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="counter-request-card"]')).toBeNull()
    })
    expect(screen.queryByTestId('counter-shift-card')).not.toBeInTheDocument()
  })

  it('names the tablet, takes the code, and opens the counter', async () => {
    const user = userEvent.setup()
    const { tablet, phone } = bothEnds()
    const code = await askFor('Demo Staff', tablet)

    renderPhone(phone)
    const card = await screen.findByTestId('counter-request-card')
    // The tablet is named, because a prompt that says only "somebody wants to
    // open a counter" is the shape people tap through without reading.
    expect(card.textContent).toMatch(/Counter tablet/)

    await user.type(screen.getByLabelText('Code on the tablet'), code)
    await user.click(screen.getByRole('button', { name: /open counter/i }))

    expect(await screen.findByTestId('counter-shift-card')).toBeInTheDocument()
    expect(screen.queryByTestId('counter-request-card')).not.toBeInTheDocument()
  })

  it('refuses a wrong code and says so', async () => {
    const user = userEvent.setup()
    const { tablet, phone } = bothEnds()
    const code = await askFor('Demo Staff', tablet)
    const wrong = code === '0000' ? '1111' : '0000'

    renderPhone(phone)
    await screen.findByTestId('counter-request-card')
    await user.type(screen.getByLabelText('Code on the tablet'), wrong)
    await user.click(screen.getByRole('button', { name: /open counter/i }))

    expect(await screen.findByTestId('counter-request-error')).toHaveTextContent(
      /not the code on the tablet/i,
    )
    expect(screen.queryByTestId('counter-shift-card')).not.toBeInTheDocument()
  })

  it('rejects without asking for a code at all', async () => {
    const user = userEvent.setup()
    const { tablet, phone } = bothEnds()
    await askFor('Demo Staff', tablet)

    renderPhone(phone)
    await screen.findByTestId('counter-request-card')
    // No code typed. Refusing something is not an act anybody should have to
    // walk to a counter to take.
    await user.click(screen.getByRole('button', { name: /not me/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('counter-request-card')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('counter-shift-card')).not.toBeInTheDocument()
  })

  it('explains immediate remote leave before ending the shift it holds', async () => {
    const user = userEvent.setup()
    const { tablet, phone } = bothEnds()
    const code = await askFor('Demo Staff', tablet)

    renderPhone(phone)
    await screen.findByTestId('counter-request-card')
    await user.type(screen.getByLabelText('Code on the tablet'), code)
    await user.click(screen.getByRole('button', { name: /open counter/i }))
    await screen.findByTestId('counter-shift-card')

    await user.click(screen.getByRole('button', { name: /leave counter/i }))
    const dialog = screen.getByRole('dialog', { name: /leave this counter now/i })
    expect(dialog).toHaveTextContent(/authority ends immediately/i)
    expect(dialog).toHaveTextContent(/use Hand over on the tablet/i)
    expect(dialog).toHaveTextContent(/flagged last-known context/i)
    await user.click(within(dialog).getByRole('button', { name: 'Leave counter' }))
    await waitFor(() => {
      expect(screen.queryByTestId('counter-shift-card')).not.toBeInTheDocument()
    })
  })

  it('still shows the card when the live channel never fires', async () => {
    const { tablet, phone } = bothEnds()
    // The whole degradation story in one assertion: a subscription that delivers
    // nothing must cost latency, never correctness. Everything on screen here
    // arrived from the load read.
    vi.spyOn(phone.counter, 'subscribeToOwnHandshake').mockReturnValue(() => {})
    await askFor('Demo Staff', tablet)

    renderPhone(phone)
    expect(await screen.findByTestId('counter-request-card')).toBeInTheDocument()
  })
})
