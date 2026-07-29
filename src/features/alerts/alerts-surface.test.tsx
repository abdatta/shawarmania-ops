import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import type { DataAdapters } from '@/data-access/adapters'
import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Role, Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { AlertsSurface } from './alerts-surface'

/**
 * Alerts, from both ends. The demonstration the proposal asks for is exactly
 * this: raise one as a Franchise Admin, flip roles, answer it as the owner —
 * so the tests walk that path rather than checking each screen in isolation.
 */

function sessionFor(role: Role): Session {
  const persona = personaFixtures[role]
  return {
    mode: 'demo',
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
    persona,
  }
}

function renderAlerts(role: Role, adapters: DataAdapters = createMockAdapters(role)) {
  return {
    adapters,
    ...render(
      <MemoryRouter>
        <SessionContext.Provider value={sessionFor(role)}>
          <AdaptersContext.Provider value={adapters}>
            <AlertsSurface />
          </AdaptersContext.Provider>
        </SessionContext.Provider>
      </MemoryRouter>,
    ),
  }
}

describe('AlertsSurface — the owner’s inbox', () => {
  it('lists every outlet’s alerts, each naming its outlet', async () => {
    renderAlerts('super_admin')

    const list = await screen.findByTestId('alert-list')
    expect(within(list).getByText('Pita bread will not last tomorrow')).toBeInTheDocument()
    expect(within(list).getByText('Packaging supplier raised prices')).toBeInTheDocument()

    const outletNames = [...list.querySelectorAll('[data-testid^="alert-outlet-"]')].map(
      (node) => node.textContent,
    )
    expect(new Set(outletNames).size).toBeGreaterThan(1)
  })

  it('puts what has not been read first', async () => {
    renderAlerts('super_admin')

    const list = await screen.findByTestId('alert-list')
    const statuses = [...list.querySelectorAll('[data-status]')].map((node) =>
      node.getAttribute('data-status'),
    )
    expect(statuses[0]).toBe('open')
    expect(statuses.lastIndexOf('open')).toBeLessThan(statuses.indexOf('resolved'))
  })

  it('states priority in words alongside a non-colour marker', async () => {
    renderAlerts('super_admin')

    const list = await screen.findByTestId('alert-list')
    const high = within(list).getByTestId('priority-high')
    expect(high).toHaveTextContent('High')
    // A distinct glyph as well as the word, so the ranking survives for a
    // reader who cannot use the colour.
    expect(high.querySelector('svg')).not.toBeNull()

    const low = within(list).getByTestId('priority-low')
    expect(low.querySelector('svg')?.innerHTML).not.toBe(high.querySelector('svg')?.innerHTML)
  })

  it('offers the owner no way to raise one', async () => {
    renderAlerts('super_admin')

    await screen.findByTestId('alert-list')
    // Alerts go up from an outlet. An owner raising one to themselves is not a
    // thing the product does.
    expect(screen.queryByTestId('raise-alert')).not.toBeInTheDocument()
  })

  it('adds a reply without moving the alert along', async () => {
    const user = userEvent.setup()
    renderAlerts('super_admin')

    const list = await screen.findByTestId('alert-list')
    await user.click(within(list).getByText('Pita bread will not last tomorrow'))

    const detail = await screen.findByTestId('alert-detail')
    expect(within(detail).getByText(/Down to 8 packets/)).toBeInTheDocument()

    await user.type(screen.getByTestId('alert-reply'), 'Approved — buy from Kanchrapara this week.')
    await user.click(screen.getByRole('button', { name: 'Send reply' }))

    await waitFor(() =>
      expect(screen.getByTestId('alert-responses')).toHaveTextContent(
        'Approved — buy from Kanchrapara this week.',
      ),
    )
    // Still open: reading something is not the same as acting on it.
    expect(
      within(screen.getByTestId('alert-detail')).getByText('Status — Open'),
    ).toBeInTheDocument()
  })

  it('walks the sequence and offers nothing once an alert is closed', async () => {
    const user = userEvent.setup()
    renderAlerts('super_admin')

    const list = await screen.findByTestId('alert-list')
    await user.click(within(list).getByText('Pita bread will not last tomorrow'))
    await screen.findByTestId('alert-detail')

    // Open offers acknowledgement and nothing further — the step that tells a
    // manager somebody has seen what they raised cannot be skipped.
    expect(screen.getByTestId('set-status-acknowledged')).toBeInTheDocument()
    expect(screen.queryByTestId('set-status-closed')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('set-status-acknowledged'))
    await waitFor(() => expect(screen.getByTestId('set-status-resolved')).toBeInTheDocument())

    await user.click(screen.getByTestId('set-status-resolved'))
    await waitFor(() => expect(screen.getByTestId('set-status-closed')).toBeInTheDocument())

    await user.click(screen.getByTestId('set-status-closed'))
    await waitFor(() => expect(screen.getByTestId('alert-terminal')).toBeInTheDocument())
    expect(screen.queryByTestId('set-status-open')).not.toBeInTheDocument()
  })
})

describe('AlertsSurface — the manager’s end', () => {
  it('shows only their own outlet’s alerts', async () => {
    renderAlerts('franchise_admin')

    const list = await screen.findByTestId('alert-list')
    expect(within(list).getByText('Pita bread will not last tomorrow')).toBeInTheDocument()
    expect(within(list).queryByText('Packaging supplier raised prices')).not.toBeInTheDocument()
  })

  it('raises an alert, which then reaches the owner’s inbox', async () => {
    const user = userEvent.setup()
    // One bag of adapters over one store, so the two roles are looking at the
    // same data — which is the whole demonstration.
    const store = createMockAdapters('franchise_admin')
    renderAlerts('franchise_admin', store)

    await screen.findByTestId('alert-list')
    await user.click(screen.getByTestId('raise-alert'))

    await user.type(screen.getByLabelText('Subject'), 'Freezer is not holding temperature')
    await user.type(screen.getByLabelText('What happened'), 'It read −4 this morning.')
    await user.selectOptions(screen.getByLabelText('How urgent'), 'urgent')
    await user.click(screen.getByRole('button', { name: 'Raise it' }))

    await waitFor(() =>
      expect(screen.getByTestId('alert-list')).toHaveTextContent(
        'Freezer is not holding temperature',
      ),
    )

    const raised = await store.alerts.listAlerts()
    expect(
      raised.find((alert) => alert.subject === 'Freezer is not holding temperature')?.status,
    ).toBe('open')
  })

  it('refuses a blank message by naming the field, and records nothing', async () => {
    const user = userEvent.setup()
    const adapters = createMockAdapters('franchise_admin')
    const before = (await adapters.alerts.listAlerts()).length
    renderAlerts('franchise_admin', adapters)

    await screen.findByTestId('alert-list')
    await user.click(screen.getByTestId('raise-alert'))
    await user.type(screen.getByLabelText('Subject'), 'Something')
    await user.type(screen.getByLabelText('What happened'), '   ')
    await user.click(screen.getByRole('button', { name: 'Raise it' }))

    expect(await screen.findByTestId('form-sheet-error')).toHaveTextContent(/message/i)
    expect(await adapters.alerts.listAlerts()).toHaveLength(before)
  })
})
