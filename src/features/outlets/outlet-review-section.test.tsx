import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters, OUTLET_KALYANI_ID, OUTLET_KANCHRAPARA_ID } from '@/data-access/mock'
import { OutletReviewSection } from './outlet-review-section'

function setup(outletId: string, mayWrite = true) {
  const adapters = createMockAdapters('super_admin')
  render(
    <AdaptersContext.Provider value={adapters}>
      <OutletReviewSection outletId={outletId} mayWrite={mayWrite} />
    </AdaptersContext.Provider>,
  )
  return adapters
}

describe('the Google review section', () => {
  it('shows the outlet’s ask, and saves a new thank-you percentage', async () => {
    const user = userEvent.setup()
    const adapters = setup(OUTLET_KALYANI_ID)
    await screen.findByTestId('review-ask-section')
    expect(screen.getByTestId('review-ask-switch')).toBeChecked()
    expect(screen.getByTestId('review-ask-url')).toHaveValue(
      'https://g.page/r/Cef3CrZy-ZyuEBE/review',
    )
    await user.clear(screen.getByTestId('review-ask-percent'))
    await user.type(screen.getByTestId('review-ask-percent'), '8')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByTestId('review-ask-saved')
    expect(await adapters.outlets.getReviewAsk(OUTLET_KALYANI_ID)).toEqual({
      enabled: true,
      url: 'https://g.page/r/Cef3CrZy-ZyuEBE/review',
      percent: 8,
    })
  })

  it('refuses to ask with no review link, in a sentence, and stores nothing', async () => {
    const user = userEvent.setup()
    const adapters = setup(OUTLET_KANCHRAPARA_ID)
    await screen.findByTestId('review-ask-section')
    expect(screen.getByTestId('review-ask-switch')).not.toBeChecked()
    expect(screen.queryByTestId('review-ask-url')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('review-ask-switch'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Paste the outlet’s Google review link/)).toBeInTheDocument()
    expect((await adapters.outlets.getReviewAsk(OUTLET_KANCHRAPARA_ID)).enabled).toBe(false)
  })

  it('reads as one line to somebody who cannot change it', async () => {
    setup(OUTLET_KALYANI_ID, false)
    expect(await screen.findByTestId('review-ask-section')).toHaveTextContent('5% thank-you')
    expect(screen.queryByTestId('review-ask-switch')).not.toBeInTheDocument()
  })
})
