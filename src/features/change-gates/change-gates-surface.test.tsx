import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import type { ChangeGateSummary } from '@/data-access/adapters'
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

function renderAt(
  path: string,
  role: Role = 'super_admin',
  { alsoListed = [] }: { alsoListed?: ChangeGateSummary[] } = {},
) {
  const adapters = createMockAdapters(role, createDemoData())
  if (alsoListed.length > 0) {
    const overview = adapters.changeGates.overview.bind(adapters.changeGates)
    adapters.changeGates.overview = async () => {
      const read = await overview()
      return { ...read, gates: [...alsoListed, ...read.gates] }
    }
  }
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

/**
 * Rows the database still lists after this build tombstoned their keys — the
 * week between a retirement and its contract migration (a-retired-gate-waits-below).
 * Listed before the gates in use, as their rows are older, so the page has to
 * move them.
 */
function waitingRow(
  key: string,
  code: string,
  title: string,
  dependsOn: string[] = [],
  enabled = true,
): ChangeGateSummary {
  return {
    key,
    code,
    kind: 'change',
    title,
    onMeans: `${title} on.`,
    offMeans: `${title} off.`,
    changeName: 'each-dish-is-ticked-off',
    changeNumber: 74,
    dependsOn,
    enabled,
    changedAt: '2026-10-15T06:00:00.000Z',
    changedByName: 'Abhishek Datta',
  }
}
const WAITING = [
  waitingRow('kitchen-ready', 'KR', 'Kitchen Ready', ['dish-ticks']),
  waitingRow('dish-ticks', 'DT', 'Dish ticks'),
  waitingRow('outside-tap-closes', 'OT', 'Tap outside closes pop-ups', [], false),
]

describe('the Change gates list', () => {
  it('lists every gate with its code and state', async () => {
    const user = userEvent.setup()
    renderAt('/owner/change-gates')

    const list = await screen.findByTestId('change-gate-list')
    expect(within(rowOf('probe')).getByTestId('gate-code')).toHaveTextContent('PB')
    // No declared gate depends on another since the dish ticks retired.
    expect(screen.queryByTestId('depends-probe')).not.toBeInTheDocument()
    expect(
      within(list)
        .getAllByTestId('gate-state')
        .every((cell) => cell.textContent === 'On'),
    ).toBe(true)

    await user.click(rowOf('probe'))
    expect(await screen.findByTestId('gate-probe')).toBeInTheDocument()
  })

  it('has no retired section while no listed gate is retired', async () => {
    renderAt('/owner/change-gates')
    await screen.findByTestId('change-gate-list')
    expect(screen.queryByTestId('retired-gate-list')).not.toBeInTheDocument()
    expect(screen.queryByText('Retired · waiting for cleanup')).not.toBeInTheDocument()
  })

  it('moves a gate this build retired below the gates in use, where it opens nothing', async () => {
    renderAt('/owner/change-gates', 'super_admin', { alsoListed: WAITING })

    const inUse = await screen.findByTestId('change-gate-list')
    const retired = screen.getByTestId('retired-gate-list')
    expect(within(inUse).queryByText('Dish ticks')).not.toBeInTheDocument()
    expect(within(inUse).getByText('Probe')).toBeInTheDocument()
    expect(inUse.compareDocumentPosition(retired) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: 'Retired · waiting for cleanup' }),
    ).toBeInTheDocument()

    // Its own dependency order, its code and its state — Off is worth seeing.
    const rows = within(retired).getAllByTestId(/^retired-gate-/)
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      'retired-gate-dish-ticks',
      'retired-gate-kitchen-ready',
      'retired-gate-outside-tap-closes',
    ])
    expect(within(rows[0]!).getByTestId('gate-code')).toHaveTextContent('DT')
    expect(
      within(retired)
        .getAllByTestId('gate-state')
        .map((cell) => cell.textContent),
    ).toEqual(['On', 'On', 'Off'])

    expect(within(retired).queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryByTestId('open-gate-dish-ticks')).not.toBeInTheDocument()
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

  it('offers no switch on a retired gate’s page, and still shows its tablets', async () => {
    renderAt('/owner/change-gates/kitchen-ready', 'super_admin', { alsoListed: WAITING })
    const page = await screen.findByTestId('gate-kitchen-ready')

    expect(screen.getByTestId('gate-retired')).toHaveTextContent('Retired · waiting for cleanup')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByTestId('turn-gate')).not.toBeInTheDocument()
    expect(screen.getByTestId('gate-since')).toHaveTextContent(/^On · since/)
    expect(within(screen.getByTestId('gate-dependencies')).queryAllByRole('link')).toHaveLength(0)
    expect(within(page).getByTestId(`tablet-${DEMO_COUNTER_DEVICE_ID}`)).toBeInTheDocument()
  })

  it('says plainly when there is no such gate', async () => {
    renderAt('/owner/change-gates/no-such-gate')
    expect(await screen.findByText('There is no change gate by that name.')).toBeInTheDocument()
  })
})
