import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import { deriveSessionScope, type Role, type Session } from '@/session/session'
import type { DataAdapters } from '@/data-access/adapters'
import { createMockAdapters } from '@/data-access/mock'
import { createDemoData } from '@/data-access/mock'
import {
  customerIdForPhone,
  DEMO_MEMBER_CUSTOMER_PHONE,
  DEMO_REGULAR_CUSTOMER_PHONE,
  DEMO_RETURNING_CUSTOMER_PHONE,
} from '@/data-access/mock/fixtures/customers'

import { CustomersSurface } from './customers-surface'

const MOUMITA = customerIdForPhone(DEMO_REGULAR_CUSTOMER_PHONE)
const RITIKA = customerIdForPhone(DEMO_RETURNING_CUSTOMER_PHONE)
const ARJUN = customerIdForPhone(DEMO_MEMBER_CUSTOMER_PHONE)

/**
 * jsdom has no `IntersectionObserver`. This one reports the sentinel in view the
 * moment it is watched, so a test asks for the next page the way scrolling does.
 */
beforeAll(() => {
  class Immediate {
    constructor(private readonly run: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.run(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      )
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: readonly number[] = []
  }
  globalThis.IntersectionObserver ??= Immediate as unknown as typeof IntersectionObserver
})

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

function renderSurface(
  adapters: DataAdapters = createMockAdapters('super_admin'),
  role: Role = 'super_admin',
) {
  render(
    <MemoryRouter>
      <SessionContext.Provider value={sessionFor(role)}>
        <AdaptersContext.Provider value={adapters}>
          <CustomersSurface />
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  return adapters
}

/** Open a customer from one tab's list. */
async function openCard(
  user: ReturnType<typeof userEvent.setup>,
  list: 'regulars' | 'members',
  id: string,
) {
  await user.click(await screen.findByTestId(`tab-${list}`))
  const section = await screen.findByTestId(`customer-list-${list}`)
  await user.click(await within(section).findByTestId(`customer-${id}`))
  return screen.findByTestId('customer-card')
}

describe('CustomersSurface', () => {
  it('opens on the Regulars tab, and Gold is one tap away', async () => {
    const user = userEvent.setup()
    renderSurface()

    const regulars = await screen.findByTestId('customer-list-regulars')
    expect(screen.getByTestId('tab-regulars')).toHaveAttribute('aria-pressed', 'true')
    // No count on either tab: each is the whole of its kind.
    expect(screen.getByTestId('tab-members')).toHaveTextContent(/^Gold$/)
    expect(screen.getByTestId('tab-regulars')).toHaveTextContent(/^Regulars$/)
    const top = within(regulars).getAllByRole('button')[0]!
    expect(top).toHaveTextContent('Moumta Ghosh')
    expect(top).toHaveTextContent(/\d+ visits/)
    // Money is on the card, one person at a time — never ranked down a list.
    expect(regulars).not.toHaveTextContent('₹')

    await user.click(screen.getByTestId('tab-members'))
    const members = await screen.findByTestId('customer-list-members')
    expect(within(members).getByTestId(`customer-${ARJUN}`)).toHaveTextContent('Arjun Das')
    expect(within(members).getByTestId(`customer-${RITIKA}`)).toHaveTextContent('Ritika Sen')
    expect(screen.queryByTestId('customer-list-regulars')).not.toBeInTheDocument()
  })

  it('loads the next twenty as the end of a list comes into view', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    for (let n = 0; n < 30; n += 1) {
      const id = `extra-${String(n).padStart(2, '0')}`
      data.customers.byPhone.set(`+9198765${String(n).padStart(5, '0')}`, {
        id,
        phone: `+9198765${String(n).padStart(5, '0')}`,
        name: `Member ${n}`,
        createdAt: '2026-09-01T00:00:00.000Z',
      })
      data.customers.memberships.push({
        customerId: id,
        grantedAt: '2026-09-10T12:00:00.000Z',
        grantedBy: 'owner',
        revokedAt: null,
        revokedBy: null,
      })
    }
    renderSurface(createMockAdapters('super_admin', data))

    await user.click(await screen.findByTestId('tab-members'))
    const members = await screen.findByTestId('customer-list-members')
    // The sentinel is in view at once in this environment, so the second page
    // follows the first, and then the list ends.
    await waitFor(() =>
      expect(within(members).getAllByRole('button', { name: /Member|Das|Sen/ })).toHaveLength(32),
    )
    expect(screen.queryByTestId('customer-list-more')).not.toBeInTheDocument()
  })

  it('finds a customer by part of their name, and the lists step aside', async () => {
    const user = userEvent.setup()
    renderSurface()
    const input = await screen.findByTestId('customer-search')
    await screen.findByTestId('customer-list-regulars')

    await user.type(input, 'gh')
    expect(screen.getByTestId('customer-search-result')).toHaveTextContent('Keep typing')
    expect(screen.queryByTestId('customer-list-regulars')).not.toBeInTheDocument()
    expect(screen.queryByTestId('customer-tabs')).not.toBeInTheDocument()

    await user.type(input, 'osh')
    const found = await within(screen.getByTestId('customer-search-result')).findByTestId(
      `customer-${MOUMITA}`,
    )
    expect(found).toHaveTextContent('Moumta Ghosh')
    // The part that matched is what is bold.
    expect([...found.querySelectorAll('[data-match]')].map((node) => node.textContent)).toEqual([
      'Ghosh',
    ])

    await user.click(screen.getByRole('button', { name: 'Clear the search' }))
    expect(await screen.findByTestId('customer-list-regulars')).toBeInTheDocument()
  })

  it('finds a customer by the last digits of their number', async () => {
    const user = userEvent.setup()
    renderSurface()
    const input = await screen.findByTestId('customer-search')

    await user.type(input, '90')
    expect(screen.getByTestId('customer-search-result')).toHaveTextContent('Keep typing')

    await user.clear(input)
    await user.type(input, '0104')
    expect(
      await within(screen.getByTestId('customer-search-result')).findByTestId(
        `customer-${MOUMITA}`,
      ),
    ).toHaveTextContent('+91 90000 00104')

    await user.clear(input)
    await user.type(input, '+91 90000 00999')
    expect(
      await within(screen.getByTestId('customer-search-result')).findByText('Nobody matches that.'),
    ).toBeInTheDocument()
  })

  it('makes a regular a gold member behind one confirmation, and the list follows', async () => {
    const user = userEvent.setup()
    renderSurface()
    const card = await openCard(user, 'regulars', MOUMITA)

    expect(within(card).getByTestId('customer-card-membership')).toHaveTextContent(
      'Not a gold member',
    )
    await user.click(within(card).getByRole('button', { name: 'Make gold member' }))

    const confirm = await screen.findByRole('dialog', { name: /a gold member\?$/ })
    await user.click(within(confirm).getByRole('button', { name: 'Make gold member' }))

    await waitFor(() =>
      expect(within(card).getByTestId('customer-card-membership')).toHaveTextContent(
        /Gold member since/,
      ),
    )
    expect(within(card).getByRole('button', { name: 'Remove gold membership' })).toBeInTheDocument()
    // The Gold tab lists her when it is next opened.
    await user.click(within(card).getByRole('button', { name: 'Close' }))
    await user.click(screen.getByTestId('tab-members'))
    expect(
      await within(await screen.findByTestId('customer-list-members')).findByTestId(
        `customer-${MOUMITA}`,
      ),
    ).toBeInTheDocument()
  })

  it('confirms a revoke the same way, and a dismissed confirmation changes nothing', async () => {
    const user = userEvent.setup()
    renderSurface()
    const card = await openCard(user, 'members', ARJUN)

    await user.click(within(card).getByRole('button', { name: 'Remove gold membership' }))
    const confirm = await screen.findByRole('dialog', { name: /gold membership\?$/ })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))

    // Still a member, and the card underneath is still open.
    expect(within(card).getByTestId('customer-card-membership')).toHaveTextContent(
      /Gold member since/,
    )
    expect(screen.getByTestId('customer-card')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Remove gold membership' }))
    const again = await screen.findByRole('dialog', { name: /gold membership\?$/ })
    await user.click(within(again).getByRole('button', { name: 'Remove gold' }))
    await waitFor(() =>
      expect(within(card).getByTestId('customer-card-membership')).toHaveTextContent(
        'Not a gold member',
      ),
    )
  })

  it('corrects a name in place, and will not erase one', async () => {
    const user = userEvent.setup()
    renderSurface()
    const card = await openCard(user, 'regulars', MOUMITA)

    await user.click(within(card).getByRole('button', { name: 'Correct the name' }))
    const input = within(card).getByTestId('customer-card-name-input')
    await user.clear(input)
    expect(within(card).getByRole('button', { name: 'Save the name' })).toBeDisabled()

    await user.type(input, 'Moumita Ghosh{Enter}')
    expect(await within(card).findByTestId('customer-card-name')).toHaveTextContent('Moumita Ghosh')
  })

  it('reports thirty days of activity on the card', async () => {
    const user = userEvent.setup()
    const data = createDemoData()
    renderSurface(createMockAdapters('super_admin', data))
    const card = await openCard(user, 'members', RITIKA)

    const figures = within(card).getByTestId('customer-card-figures')
    expect(figures).toHaveTextContent('Last 30 days')
    expect(figures).toHaveTextContent('9 visits')
    expect(figures).toHaveTextContent('Last seen')
    expect(figures).toHaveTextContent('Customer since')
  })

  describe('as a manager', () => {
    const asManager = () =>
      renderSurface(createMockAdapters('franchise_admin', createDemoData()), 'franchise_admin')

    it('lists only the customers their outlet has served', async () => {
      asManager()
      const regulars = await screen.findByTestId('customer-list-regulars')
      expect(regulars).toHaveTextContent('Moumta Ghosh')
      // Imran and Sourav have only ever bought at Kanchrapara.
      expect(regulars).not.toHaveTextContent('Imran Sheikh')
      expect(regulars).not.toHaveTextContent('Sourav Pal')
      expect(screen.getByText(/at your outlet/)).toBeInTheDocument()
    })

    it('changes a customer who has only ever bought at their outlet', async () => {
      const user = userEvent.setup()
      asManager()
      const card = await openCard(user, 'members', ARJUN)
      expect(within(card).getByRole('button', { name: 'Remove gold membership' })).toBeVisible()
      expect(within(card).getByRole('button', { name: 'Correct the name' })).toBeVisible()
      expect(within(card).getByTestId('customer-card-figures')).toHaveTextContent(
        'First visit here',
      )
    })

    it('only reads a customer another outlet also serves, and says why', async () => {
      const user = userEvent.setup()
      asManager()
      const card = await openCard(user, 'members', RITIKA)
      expect(within(card).queryByRole('button', { name: 'Remove gold membership' })).toBeNull()
      expect(within(card).queryByRole('button', { name: 'Correct the name' })).toBeNull()
      expect(within(card).getByTestId('customer-card-read-only')).toHaveTextContent(
        'only the owner can change',
      )
    })
  })
})
