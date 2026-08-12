import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { activationLink } from '@/lib/activation-link'

import { AccountHandoverPanel, type AccountHandoverProps } from './account-handover'

const activationHandover: AccountHandoverProps['handover'] = {
  profileId: 'account-1',
  username: 'new.starter',
  code: 'ABCDE-FGHJK',
  expiresAt: '2030-08-19T12:00:00.000Z',
  purpose: 'activation',
}

function renderHandover(overrides: Partial<AccountHandoverProps> = {}) {
  const props: AccountHandoverProps = {
    handover: activationHandover,
    name: 'New Starter',
    ...overrides,
  }
  return render(<AccountHandoverPanel {...props} />)
}

describe('AccountHandoverPanel', () => {
  it('uses set-up wording and a labelled QR for a first account handover', () => {
    renderHandover()

    expect(screen.getByRole('heading', { name: 'Set up account' })).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Set up account link for New Starter' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('account-handover-username')).toHaveTextContent('new.starter')
    expect(screen.getByText(/Shown once · works once · expires/)).toBeInTheDocument()
    expect(screen.queryByText(/replaces the password/i)).not.toBeInTheDocument()
  })

  it('uses reset wording and states the real password and session consequence', () => {
    renderHandover({ handover: { ...activationHandover, purpose: 'password_reset' } })

    expect(screen.getByRole('heading', { name: 'Reset password' })).toBeInTheDocument()
    expect(
      screen.getByText(/replaces the password and ends other personal sessions/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Reset password link for New Starter' }),
    ).toBeInTheDocument()
  })

  it('only shows the replacement warning when an earlier link was replaced', () => {
    const { rerender } = renderHandover()
    expect(screen.queryByTestId('account-handover-replacement')).not.toBeInTheDocument()

    rerender(<AccountHandoverPanel handover={activationHandover} name="New Starter" replacement />)
    expect(screen.getByTestId('account-handover-replacement')).toHaveTextContent(
      'This replaces the earlier set-up link. The earlier link no longer works.',
    )
  })

  it('confirms copying the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(window.navigator.clipboard?.writeText).toBe(writeText)
    renderHandover()

    screen.getByRole('button', { name: 'Copy link' }).click()

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(activationLink('ABCDE-FGHJK')))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(screen.getByText('Link copied.')).toBeInTheDocument()
  })

  it('shows an inactive warning only when that current state is supplied', () => {
    const { rerender } = renderHandover()
    expect(screen.queryByTestId('account-handover-inactive')).not.toBeInTheDocument()

    rerender(<AccountHandoverPanel handover={activationHandover} name="New Starter" inactive />)
    expect(screen.getByTestId('account-handover-inactive')).toHaveTextContent(
      'Reactivate it before issuing a link.',
    )
  })

  it('keeps the QR and primary copy action ahead of the selectable link', () => {
    renderHandover()
    const panel = screen.getByTestId('account-handover')
    const qr = within(panel).getByRole('button', { name: /tap to enlarge/i })
    const copy = within(panel).getByRole('button', { name: 'Copy link' })
    const link = within(panel).getByTestId('account-handover-link')

    expect(qr.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(copy.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps identity out of the link and never renders the raw code as a second handover', () => {
    renderHandover()
    const link = screen.getByTestId('account-handover-link').textContent ?? ''

    expect(link).not.toContain('new.starter')
    expect(screen.queryByTestId('account-handover-code')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy code' })).not.toBeInTheDocument()
  })

  it('uses semantic token classes rather than raw hex values', async () => {
    const source = await import('./account-handover.tsx?raw')
    expect(source.default).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})
