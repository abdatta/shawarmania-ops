import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createDemoData, createMockAdapters } from '@/data-access/mock'
import {
  DEMO_COUNTER_DEVICE_ID,
  DEMO_COUNTER_DEVICE_TWO_ID,
  DEMO_KANCHRAPARA_DEVICE_ID,
} from '@/data-access/mock/fixtures/billing'
import { DEMO_KITCHEN_DEVICE_ID } from '@/data-access/mock/kitchen'
import { SessionContext } from '@/session/context'
import type { Role } from '@/session/session'
import { demoSessionFor } from '@/test/session'

import { ChangeGatePage, ChangeGatesSurface } from './change-gates-surface'

/**
 * The owner's Change gates (a-release-can-be-switched-off, D18, D21): a list
 * like Team, each gate after the gates it depends on and naming them by code;
 * each gate's own page with its state and switch first, then its code, what On
 * and Off mean, the gates it depends on and the gates that need it as rows, every
 * tablet as a live reading, and the history.
 */

afterEach(() => window.sessionStorage.clear())

function renderAt(path: string, role: Role = 'super_admin') {
  const adapters = createMockAdapters(role, createDemoData())
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionContext.Provider value={demoSessionFor(role)}>
        <AdaptersContext.Provider value={adapters}>
          <Routes>
            <Route path="/owner/change-gates" element={<ChangeGatesSurface />} />
            <Route path="/owner/change-gates/:gateKey" element={<ChangeGatePage />} />
          </Routes>
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

const rowOf = (key: string) => screen.getByTestId(`open-gate-${key}`)

describe('the Change gates list', () => {
  it('lists every gate after the gates it depends on, naming them by code', async () => {
    const user = userEvent.setup()
    renderAt('/owner/change-gates')

    const list = await screen.findByTestId('change-gate-list')
    const order = within(list)
      .getAllByRole('link')
      .map((link) => link.getAttribute('data-testid'))
    expect(order.indexOf('open-gate-dish-ticks')).toBeLessThan(
      order.indexOf('open-gate-kitchen-ready'),
    )
    expect(within(rowOf('probe')).getByTestId('gate-code')).toHaveTextContent('PB')
    expect(screen.getByTestId('depends-kitchen-ready')).toHaveTextContent('Dependent on DT')
    expect(screen.queryByTestId('depends-probe')).not.toBeInTheDocument()
    expect(
      within(list)
        .getAllByTestId('gate-state')
        .every((cell) => cell.textContent === 'On'),
    ).toBe(true)

    await user.click(rowOf('probe'))
    expect(await screen.findByTestId('gate-probe')).toBeInTheDocument()
  })

  it('says why it cannot list gates for anybody but the owner', async () => {
    renderAt('/owner/change-gates', 'franchise_admin')
    expect(await screen.findByTestId('change-gates-error')).toHaveTextContent(
      'Only the owner turns a change gate.',
    )
  })
})

describe('a change gate’s own page', () => {
  it('leads with its state and switch, then its code and meanings, then every tablet', async () => {
    renderAt('/owner/change-gates/probe')
    const page = await screen.findByTestId('gate-probe')

    const toggle = screen.getByRole('switch', { name: 'Turn off Probe' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('gate-since')).toHaveTextContent(/^On · since/)
    expect(
      toggle.compareDocumentPosition(within(page).getByText('On means')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(within(page).getAllByTestId('gate-code')[0]).toHaveTextContent('PB')

    const tablet = (id: string) => screen.getByTestId(`tablet-${id}`)
    expect(tablet(DEMO_COUNTER_DEVICE_ID)).toHaveAttribute('data-health', 'ok')
    expect(tablet(DEMO_COUNTER_DEVICE_ID)).toHaveAttribute('data-follows', 'running')
    expect(tablet(DEMO_COUNTER_DEVICE_ID)).toHaveTextContent('38 requests · 0 failed')
    expect(tablet(DEMO_KITCHEN_DEVICE_ID)).toHaveAttribute('data-follows', 'waiting')
    expect(tablet(DEMO_COUNTER_DEVICE_TWO_ID)).toHaveAttribute('data-health', 'failing')
    expect(tablet(DEMO_KANCHRAPARA_DEVICE_ID)).toHaveAttribute('data-health', 'stale')
    expect(tablet(DEMO_KANCHRAPARA_DEVICE_ID)).toHaveTextContent(/Silent · last heard/)

    expect(screen.getByTestId('gate-history')).toBeInTheDocument()
    expect(screen.getByTestId('build-version')).toHaveTextContent(/^Build \S+ · /)
  })

  it('turns a gate off for the whole business from its switch, with a reason in the history', async () => {
    const user = userEvent.setup()
    renderAt('/owner/change-gates/probe')
    await screen.findByTestId('gate-probe')

    await user.click(screen.getByRole('switch', { name: 'Turn off Probe' }))
    const sheet = await screen.findByTestId('confirm-turn')
    expect(sheet).toHaveTextContent('Every tablet switches at its next free moment')
    expect(within(sheet).queryByTestId('turn-also-off')).not.toBeInTheDocument()
    await user.type(within(sheet).getByTestId('turn-reason'), 'Comparing the two')
    await user.click(within(sheet).getByTestId('confirm-turn-submit'))

    await waitFor(() => expect(screen.getByTestId('gate-since')).toHaveTextContent(/^Off/))
    expect(screen.getByRole('switch', { name: 'Turn on Probe' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    const newest = within(screen.getByTestId('gate-history')).getAllByRole('listitem')[0]
    expect(newest).toHaveTextContent('Off')
    expect(newest).toHaveTextContent('Comparing the two')
  })

  it('lists the gates that need it, and says turning it off takes them too', async () => {
    const user = userEvent.setup()
    renderAt('/owner/change-gates/dish-ticks')
    await screen.findByTestId('gate-dish-ticks')
    expect(
      within(screen.getByTestId('gate-needed-by')).getByTestId('open-gate-kitchen-ready'),
    ).toBeInTheDocument()

    await user.click(screen.getByTestId('turn-gate'))
    expect(await screen.findByTestId('turn-also-off')).toHaveTextContent(
      'This also turns off Kitchen Ready, which depends on it.',
    )
  })

  it('holds a gate off while a gate it depends on is off, and links to that gate', async () => {
    const user = userEvent.setup()
    renderAt('/owner/change-gates/dish-ticks')
    await screen.findByTestId('gate-dish-ticks')
    await user.click(screen.getByTestId('turn-gate'))
    await user.click(screen.getByTestId('confirm-turn-submit'))
    await waitFor(() => expect(screen.getByTestId('gate-since')).toHaveTextContent(/^Off/))

    await user.click(
      within(screen.getByTestId('gate-needed-by')).getByTestId('open-gate-kitchen-ready'),
    )
    await screen.findByTestId('gate-kitchen-ready')
    expect(
      within(screen.getByTestId('gate-dependencies')).getByTestId('open-gate-dish-ticks'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('turn-gate')).toBeDisabled()
    expect(screen.getByTestId('gate-blocked')).toHaveTextContent(
      'Turn on Dish ticks first: this is dependent on it.',
    )
  })

  it('opens each time with an empty reason', async () => {
    const user = userEvent.setup()
    renderAt('/owner/change-gates/probe')
    await screen.findByTestId('gate-probe')

    await user.click(screen.getByTestId('turn-gate'))
    await user.type(screen.getByTestId('turn-reason'), 'Not this time')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByTestId('turn-gate'))
    expect(screen.getByTestId('turn-reason')).toHaveValue('')
  })

  it('says plainly when there is no such gate', async () => {
    renderAt('/owner/change-gates/no-such-gate')
    expect(await screen.findByText('There is no change gate by that name.')).toBeInTheDocument()
  })
})
