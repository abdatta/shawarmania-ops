import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import {
  INVENTORY_CHICKEN_ID,
  INVENTORY_MAYO_ID,
  INVENTORY_PITA_ID,
} from '@/data-access/mock/fixtures/operations'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'

import { InventorySurface } from './inventory-surface'
import { MovementLedger } from './movement-ledger'

const managerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.franchise_admin.profile.id,
  role: 'franchise_admin',
  outletId: personaFixtures.franchise_admin.profile.outlet_id,
  displayName: personaFixtures.franchise_admin.profile.full_name,
  persona: personaFixtures.franchise_admin,
}

function renderStock(adapters: DataAdapters = createMockAdapters('franchise_admin')) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={managerSession}>
          <AdaptersContext.Provider value={adapters}>
            <InventorySurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

function renderLedger(itemId: string, adapters = createMockAdapters('franchise_admin')) {
  return {
    adapters,
    ...render(
      <MemoryRouter initialEntries={[`/admin/inventory/${itemId}`]}>
        <SessionContext.Provider value={managerSession}>
          <AdaptersContext.Provider value={adapters}>
            <Routes>
              <Route path="/admin/inventory/:itemId" element={<MovementLedger />} />
            </Routes>
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('InventorySurface', () => {
  it('marks the low item with an icon and the words, not a colour', async () => {
    renderStock()

    const low = await screen.findByTestId(`low-stock-${INVENTORY_PITA_ID}`)
    expect(low).toHaveTextContent('Low stock')
    // The item above its threshold carries no such mark.
    expect(screen.queryByTestId(`low-stock-${INVENTORY_CHICKEN_ID}`)).not.toBeInTheDocument()
  })

  it('shows each item’s quantity with its unit', async () => {
    renderStock()
    expect(await screen.findByTestId(`quantity-${INVENTORY_CHICKEN_ID}`)).toHaveTextContent(
      '12.5 kg',
    )
    expect(screen.getByTestId(`quantity-${INVENTORY_PITA_ID}`)).toHaveTextContent('8 packet')
  })

  it('takes stock down when a used movement is recorded, with no minus typed', async () => {
    const user = userEvent.setup()
    renderStock()

    await user.click(await screen.findByTestId(`record-${INVENTORY_CHICKEN_ID}`))
    await user.selectOptions(screen.getByLabelText('What happened'), 'used')
    await user.type(screen.getByLabelText('How much (kg)'), '2.5')
    await user.click(screen.getByRole('button', { name: 'Record movement' }))

    await waitFor(() => {
      expect(screen.getByTestId(`quantity-${INVENTORY_CHICKEN_ID}`)).toHaveTextContent('10 kg')
    })
  })

  it('crosses into low stock when enough is used', async () => {
    const user = userEvent.setup()
    renderStock()

    await user.click(await screen.findByTestId(`record-${INVENTORY_CHICKEN_ID}`))
    await user.selectOptions(screen.getByLabelText('What happened'), 'used')
    await user.type(screen.getByLabelText('How much (kg)'), '8')
    await user.click(screen.getByRole('button', { name: 'Record movement' }))

    expect(await screen.findByTestId(`low-stock-${INVENTORY_CHICKEN_ID}`)).toBeInTheDocument()
  })

  it('refuses a movement of nothing, and records nothing', async () => {
    const user = userEvent.setup()
    renderStock()

    await user.click(await screen.findByTestId(`record-${INVENTORY_CHICKEN_ID}`))
    await user.click(screen.getByRole('button', { name: 'Record movement' }))

    expect(await screen.findByTestId('form-sheet-error')).toHaveTextContent(/cannot be zero/i)
    expect(screen.getByTestId(`quantity-${INVENTORY_CHICKEN_ID}`)).toHaveTextContent('12.5 kg')
  })

  it('adds a new item, which starts at nothing because its ledger is empty', async () => {
    const user = userEvent.setup()
    renderStock()

    await screen.findByTestId('stock-list')
    await user.click(screen.getByRole('button', { name: 'Add stock item' }))
    await user.type(screen.getByLabelText('Name'), 'Tahini')
    await user.selectOptions(screen.getByLabelText('Counted in'), 'litre')
    await user.type(screen.getByLabelText('Warn me at'), '1')
    await user.click(screen.getByRole('button', { name: 'Create item' }))

    const added = await screen.findByText('Tahini')
    const row = added.closest<HTMLElement>('[data-testid^="stock-"]')
    expect(row).not.toBeNull()
    expect(within(row!).getByText(/0 litre/)).toBeInTheDocument()
  })
})

describe('MovementLedger', () => {
  it('lists the movements newest first, with what was left after each', async () => {
    renderLedger(INVENTORY_PITA_ID)

    await screen.findByRole('heading', { name: 'Pita bread' })
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.length).toBe(5)

    // The newest row leaves the item at its current quantity.
    expect(within(rows[0]!).getByText('8 packet')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('−3')).toBeInTheDocument()
  })

  it('shows a correction beside the row it corrects, both intact', async () => {
    renderLedger(INVENTORY_MAYO_ID)

    await screen.findByRole('heading', { name: 'Mayonnaise' })
    expect(screen.getByText('Correction')).toBeInTheDocument()
    expect(screen.getByText(/half a litre less/i)).toBeInTheDocument()
    expect(screen.getAllByText('Used').length).toBe(2)
  })

  it('offers nothing that would edit or remove a movement', async () => {
    renderLedger(INVENTORY_PITA_ID)
    await screen.findByRole('heading', { name: 'Pita bread' })

    for (const label of [/edit/i, /delete/i, /remove/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
    expect(screen.getByText(/record a correction with a note/i)).toBeInTheDocument()
  })
})
