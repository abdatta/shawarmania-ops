import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock'
import { OutletDiscountPresets } from './outlet-discount-presets'

function setup(mayWrite = true) {
  const adapters = createMockAdapters('super_admin')
  const view = render(
    <AdaptersContext.Provider value={adapters}>
      <OutletDiscountPresets outletId={OUTLET_KALYANI_ID} mayWrite={mayWrite} />
    </AdaptersContext.Provider>,
  )
  return { adapters, ...view }
}

describe('counter presets in outlet settings', () => {
  it('keeps the counter presets to four, so the panel row never wraps, and saves explicitly', async () => {
    const user = userEvent.setup()
    const { adapters } = setup()
    const section = await screen.findByTestId('outlet-discount-presets')
    expect(screen.getByTestId('presets-card')).not.toHaveAttribute('data-saved')
    expect(section).toHaveTextContent('10%')
    for (const value of [1000, 1500, 2000])
      expect(screen.getByTestId(`preset-percent-${value}`)).toBeInTheDocument()
    await user.type(screen.getByLabelText('New preset value'), '25')
    await user.click(screen.getByTestId('add-preset'))
    expect(screen.getByTestId('preset-percent-2500')).toBeInTheDocument()
    expect(screen.queryByTestId('add-preset')).not.toBeInTheDocument()
    expect((await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).presets).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByTestId('presets-saved')
    expect(screen.getByTestId('presets-card')).toHaveAttribute('data-saved', 'true')
    expect(screen.getByTestId('presets-card').className).toContain('saved-glow')
    expect(section).toHaveTextContent('25%')
    expect((await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).presets).toHaveLength(4)
    await expect(
      adapters.menu.setDiscountPresets(
        OUTLET_KALYANI_ID,
        Array.from({ length: 5 }, (_, index) => ({ basis: 'percent', value: (index + 1) * 100 })),
      ),
    ).rejects.toThrow(/four presets/)
  })

  it('offers a rupee preset as readily as a percentage one', async () => {
    const user = userEvent.setup()
    const { adapters } = setup()
    await screen.findByTestId('outlet-discount-presets')
    await user.type(screen.getByLabelText('New preset value'), '20')
    await user.click(screen.getByTestId('preset-unit-amount'))
    await user.click(screen.getByTestId('add-preset'))
    expect(screen.getByTestId('preset-amount-2000')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByTestId('presets-saved')
    expect(screen.getByTestId('outlet-discount-presets')).toHaveTextContent('₹20')
    expect((await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).presets).toContainEqual({
      basis: 'amount',
      value: 2000,
    })
  })

  it('cancels additions and removals, then saves an empty configuration without changing another outlet', async () => {
    const user = userEvent.setup()
    const { adapters } = setup()
    const saved = (await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).presets
    const other = (await adapters.menu.readOutletMenu(OUTLET_KANCHRAPARA_ID)).presets
    await screen.findByTestId('outlet-discount-presets')
    await user.click(screen.getByRole('button', { name: 'Remove the 10% preset' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect((await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).presets).toEqual(saved)
    for (const value of [10, 15, 20])
      await user.click(screen.getByRole('button', { name: `Remove the ${value}% preset` }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByTestId('outlet-discount-presets')).toHaveTextContent('No shortcuts'),
    )
    expect((await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).presets).toEqual([])
    expect((await adapters.menu.readOutletMenu(OUTLET_KANCHRAPARA_ID)).presets).toEqual(other)
  })

  it('keeps a refused save visible and permits a retry', async () => {
    const user = userEvent.setup()
    const { adapters } = setup()
    const write = vi
      .spyOn(adapters.menu, 'setDiscountPresets')
      .mockRejectedValueOnce(new Error('Could not save this outlet.'))
    await screen.findByTestId('outlet-discount-presets')
    await user.click(screen.getByRole('button', { name: 'Remove the 10% preset' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this outlet.')
    expect(screen.getByTestId('presets-card')).not.toHaveAttribute('data-saved')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByTestId('preset-percent-1000')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByTestId('presets-saved')
    expect(write).toHaveBeenLastCalledWith(OUTLET_KALYANI_ID, [
      { basis: 'percent', value: 1500 },
      { basis: 'percent', value: 2000 },
    ])
  })

  it('shows saved values without editing controls to a read-only reader', async () => {
    setup(false)
    const section = await screen.findByTestId('outlet-discount-presets')
    expect(section).toHaveTextContent('10%')
    expect(within(section).queryByRole('button')).not.toBeInTheDocument()
  })

  it('closes an old draft on an outlet change and reads that outlet’s own presets', async () => {
    const user = userEvent.setup()
    const { adapters, rerender } = setup()
    await adapters.menu.setDiscountPresets(OUTLET_KANCHRAPARA_ID, [{ basis: 'amount', value: 500 }])
    await screen.findByTestId('outlet-discount-presets')
    await user.click(screen.getByRole('button', { name: 'Remove the 10% preset' }))
    rerender(
      <AdaptersContext.Provider value={adapters}>
        <OutletDiscountPresets outletId={OUTLET_KANCHRAPARA_ID} mayWrite />
      </AdaptersContext.Provider>,
    )
    await waitFor(() => expect(screen.getByTestId('preset-amount-500')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect((await adapters.menu.readOutletMenu(OUTLET_KALYANI_ID)).presets).toHaveLength(3)
  })
})
