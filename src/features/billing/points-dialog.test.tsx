import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PointsDialog } from './points-dialog'

/**
 * The Use points pad (a-regular-earns-points-and-gold) [owner, 2026-09-29]: it
 * opens on the max, the two figures only inform, the biller types anything
 * else, and too many says so under the number.
 */
function open(overrides: Partial<Parameters<typeof PointsDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <PointsDialog
      open
      netPaise={13_900}
      capPercent={10}
      balance={36}
      max={13}
      current={null}
      onClose={onClose}
      onConfirm={onConfirm}
      {...overrides}
    />,
  )
  return { onConfirm, onClose, user: userEvent.setup() }
}

describe('PointsDialog', () => {
  it('opens on the max, with the balance and the max as figures, not controls', async () => {
    const { onConfirm, user } = open()
    expect(screen.getByTestId('points-readout')).toHaveTextContent('13')
    expect(screen.getByTestId('points-limits')).toHaveTextContent('Balance36')
    expect(screen.getByTestId('points-max')).toHaveTextContent('Max this bill1310% off')
    expect(screen.getByTestId('points-max').closest('button')).toBeNull()

    await user.click(screen.getByTestId('apply-points'))
    expect(onConfirm).toHaveBeenCalledWith(13)
  })

  it('uses any other number the biller types', async () => {
    const { onConfirm, user } = open()
    await user.click(screen.getByRole('button', { name: 'Delete last digit' }))
    await user.click(screen.getByRole('button', { name: 'Delete last digit' }))
    await user.click(screen.getByRole('button', { name: '5' }))
    await user.click(screen.getByTestId('apply-points'))
    expect(onConfirm).toHaveBeenCalledWith(5)
  })

  it('says so under the number, and will not use, more than the bill allows', async () => {
    const { onConfirm, user } = open()
    await user.click(screen.getByRole('button', { name: '5' }))

    expect(screen.getByTestId('points-readout')).toHaveTextContent('At most 13 on this bill')
    expect(screen.getByTestId('apply-points')).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('goes back without using anything', async () => {
    const { onConfirm, onClose, user } = open()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
