import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID } from '@/data-access/mock'

import { OutletAttendanceSection } from './outlet-attendance-section'

/**
 * An outlet's Attendance rules on its own page (a-check-in-at-the-shop-
 * approves-itself, design D2): both off to begin with, saved by the owner or the
 * outlet's manager, read-only to anyone else.
 */

async function setup(role: 'super_admin' | 'franchise_admin', mayWrite = true) {
  const adapters = createMockAdapters(role)
  const outlet = await adapters.outlets.getOutlet(OUTLET_KALYANI_ID)
  if (!outlet) throw new Error('missing demo outlet')
  render(
    <AdaptersContext.Provider value={adapters}>
      <OutletAttendanceSection outlet={outlet} mayWrite={mayWrite} />
    </AdaptersContext.Provider>,
  )
  return adapters
}

describe('the Attendance section', () => {
  it('starts with both rules off, saying what that means', async () => {
    await setup('franchise_admin')

    expect(screen.getByTestId('attendance-needs-manager-switch')).not.toBeChecked()
    expect(screen.getByTestId('attendance-blocks-away-switch')).not.toBeChecked()
    expect(screen.getByText('Check-ins at the shop are approved automatically')).toBeInTheDocument()
    expect(screen.getByText('Away check-ins wait for a manager')).toBeInTheDocument()
  })

  it('saves a manager’s choice to block check-ins from away', async () => {
    const user = userEvent.setup()
    const adapters = await setup('franchise_admin')

    await user.click(screen.getByTestId('attendance-blocks-away-switch'))
    expect(screen.getByText('Away check-ins are refused. You record them instead')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByTestId('attendance-rules-saved')

    expect((await adapters.outlets.getOutlet(OUTLET_KALYANI_ID))?.attendance_blocks_away).toBe(true)
  })

  it('reads as plain answers to someone who cannot change them', async () => {
    await setup('super_admin', false)

    expect(screen.queryByTestId('attendance-blocks-away-switch')).not.toBeInTheDocument()
    expect(screen.getAllByText('Off')).toHaveLength(2)
  })
})
