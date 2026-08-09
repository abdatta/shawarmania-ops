import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import type { DataAdapters } from '@/data-access/adapters'
import {
  createDemoData,
  createMockAdapters,
  OUTLET_KALYANI_ID,
  OUTLET_KANCHRAPARA_ID,
} from '@/data-access/mock'
import { SessionContext } from '@/session/context'
import type { Role } from '@/session/session'
import { demoSessionFor } from '@/test/session'

import { DevicesSurface } from './devices-surface'

/**
 * The Tablets surface: what it says about hardware it cannot see, and what it
 * warns about before removing one.
 *
 * The interesting assertions here are all about **honesty rather than
 * capability**. Whether a manager may remove another outlet's tablet is the
 * database's answer and is proved in `supabase/tests/23_...sql`; what this file
 * proves is that a figure written by a tablet that stopped talking two days ago
 * is not presented as though it were current.
 */

/**
 * The switcher is multi-select here, like attendance: a chip toggles rather than
 * replaces, so a test adds and removes outlets from the selection rather than
 * choosing one.
 */
async function addOutlet(outletId: string): Promise<void> {
  await userEvent.click(await screen.findByTestId(`surface-outlet-${outletId}`))
  await waitFor(() => {
    expect(screen.getByTestId(`surface-outlet-${outletId}`)).toHaveAttribute('aria-pressed', 'true')
  })
}

async function removeOutlet(outletId: string): Promise<void> {
  await userEvent.click(await screen.findByTestId(`surface-outlet-${outletId}`))
  await waitFor(() => {
    expect(screen.getByTestId(`surface-outlet-${outletId}`)).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
}

function renderSurface(role: Role, adapters: DataAdapters) {
  return render(
    <MemoryRouter>
      <SessionContext.Provider value={demoSessionFor(role)}>
        <AdaptersContext.Provider value={adapters}>
          <DevicesSurface />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

describe('the Tablets surface', () => {
  it('marks telemetry that has stopped moving rather than showing it as current', async () => {
    const adapters = createMockAdapters('super_admin', createDemoData())
    renderSurface('super_admin', adapters)
    // Several outlets at once, so both counters are on screen and the one that
    // stopped talking is visible without switching to it.
    await addOutlet(OUTLET_KANCHRAPARA_ID)

    const rows = await screen.findAllByTestId('device-telemetry')
    const text = rows.map((row) => row.textContent ?? '').join(' ')

    // "Last reported", never "current": both figures are the tablet's own claim
    // about itself, and one that is switched off simply stops moving them.
    expect(text).toMatch(/Last reported/)
    // Kanchrapara's tablet has said nothing for two days in the demo data, so
    // there is something genuinely stale on screen to mark.
    expect(text).toMatch(/Out of touch/)
  })

  it('offers no setup code where a tablet is already standing', async () => {
    const adapters = createMockAdapters('franchise_admin', createDemoData())
    renderSurface('franchise_admin', adapters)

    await screen.findAllByTestId('device-telemetry')
    // One active tablet per outlet is a database invariant, so the control that
    // would be refused is simply not offered.
    expect(screen.queryByRole('button', { name: /set up a tablet/i })).not.toBeInTheDocument()
  })

  it('names the outlet with no tablet, beside the ones that have one', async () => {
    const adapters = createMockAdapters('super_admin', createDemoData())
    const devices = await adapters.counter.listDevices()
    await adapters.counter.removeDevice(
      devices.find((device) => device.outletId === OUTLET_KANCHRAPARA_ID)!.id,
    )

    renderSurface('super_admin', adapters)
    await addOutlet(OUTLET_KANCHRAPARA_ID)

    // Both counters on one screen: one covered, one not, and the empty one says
    // which shop it is rather than "this outlet". That is the whole reason the
    // surface takes several outlets at once.
    expect(await screen.findByTestId('device-telemetry')).toBeInTheDocument()
    expect(
      await screen.findByText(/No tablet is set up at Shawarmania Kanchrapara yet/i),
    ).toBeInTheDocument()
  })

  it('shows a setup code once, and says that it is once', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    const adapters = createMockAdapters('franchise_admin', data)
    // Nothing at this counter: the manager's outlet is empty, so setting one up
    // is the act available.
    await adapters.counter.removeDevice(
      (await adapters.counter.listDevices()).find(
        (device) => device.outletId === OUTLET_KALYANI_ID,
      )!.id,
    )

    renderSurface('franchise_admin', adapters)
    await user.click(await screen.findByRole('button', { name: /set up a tablet/i }))
    await user.type(screen.getByLabelText('What to call it'), 'Kalyani counter tablet')
    await user.click(screen.getByRole('button', { name: /generate a code/i }))

    const shown = await screen.findByText(/is not shown again/i)
    expect(shown).toBeInTheDocument()
    expect(screen.getByText('DEMO0-SETUP')).toBeInTheDocument()
  })

  it('names what would be left unsent before it removes a tablet', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('super_admin', createDemoData())
    renderSurface('super_admin', adapters)

    // Kanchrapara's tablet is the one carrying three unsent, which is the number
    // somebody will ask about afterwards. Kalyani's is deselected so there is one
    // Remove button on screen and no ambiguity about which it belongs to.
    await addOutlet(OUTLET_KANCHRAPARA_ID)
    await removeOutlet(OUTLET_KALYANI_ID)
    await screen.findAllByTestId('device-telemetry')
    await user.click(await screen.findByRole('button', { name: /^remove$/i }))

    const consequence = await screen.findByText(/This is permanent/i)
    expect(consequence).toHaveTextContent(/3 not sent yet/i)
    expect(consequence).toHaveTextContent(/nothing else can send it/i)
  })
})
