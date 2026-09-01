import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { SessionContext } from '@/session/context'
import type { Session } from '@/session/session'
import { deriveSessionScope } from '@/session/session'

import { PhoneShell } from './phone-shell'

/**
 * Navigation's second level, as the reader meets it (#51).
 *
 * `registry.test.ts` holds the tree's shape to account; this holds the two
 * shells that draw it. **Both are in the document at once**, with one hidden by
 * CSS — jsdom has no viewport, so every query here says which row it means.
 *
 * The rail's sections are open by default, so it is the phone bar that carries
 * the collapsed-group behaviour, and the phone bar is where a folded-away count
 * would go missing.
 */

const ownerSession: Session = {
  mode: 'demo',
  userId: personaFixtures.super_admin.profile.id,
  assignments: personaFixtures.super_admin.assignments,
  ...deriveSessionScope(personaFixtures.super_admin.assignments),
  displayName: personaFixtures.super_admin.profile.full_name,
  persona: personaFixtures.super_admin,
}

function renderAt(path: string) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <SessionContext.Provider value={ownerSession}>
        <AdaptersContext.Provider value={createMockAdapters('super_admin')}>
          <Routes>
            <Route element={<PhoneShell />}>
              <Route path="*" element={<p>a surface</p>} />
            </Route>
          </Routes>
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  const navs = screen.getAllByRole('navigation', { name: 'Primary' })
  // The rail is drawn first, then the bottom bar. Both are always present.
  const [rail, bar] = navs
  return { ...view, rail: rail!, bar: bar! }
}

describe('a navigation group', () => {
  it('is a heading that expands, never a link', () => {
    const { bar } = renderAt('/demo/owner')

    for (const label of ['Finances', 'Setup']) {
      const control = within(bar).getByRole('button', { name: new RegExp(`^${label}`) })
      expect(control).toHaveAttribute('aria-expanded')
      // It has no address of its own and must never acquire one.
      expect(within(bar).queryByRole('link', { name: new RegExp(`^${label}`) })).toBeNull()
    }
  })

  it('folds the owner’s bar down to entries they can reach without scrolling', () => {
    const { bar } = renderAt('/demo/owner')

    // The demo owner holds a manager assignment at Kalyani, so they hold both
    // homes — but both are the same screen since #51 and share the label
    // `Overview`, so dedup leaves one and the bar is four.
    // The tab row is the bar's last child; a group's card, when one is open,
    // sits above it. Found structurally rather than by a styling class, which
    // this test used to do and which broke the moment the rule moved.
    const top = [...(bar.lastElementChild?.children ?? [])].map((entry) =>
      entry.textContent?.replace(/\d|:.*/g, '').trim(),
    )
    expect(top).toEqual(['Overview', 'Finances', 'Attendance', 'Setup'])
  })

  it('keeps a shut group’s children off the page rather than merely hidden', () => {
    const { bar } = renderAt('/demo/owner')

    // A real disclosure, not a CSS trick: a screen reader reaches Delivery by
    // opening Setup, the same as everybody else.
    expect(within(bar).queryByRole('link', { name: /^Delivery/ })).toBeNull()
    expect(within(bar).getByRole('button', { name: /^Setup/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('opens on arrival at a surface inside it, and closes on leaving', async () => {
    const { bar, unmount } = renderAt('/demo/owner/ledger')

    expect(within(bar).getByRole('button', { name: /^Finances/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(within(bar).getByRole('link', { name: /^Ledger/ })).toBeInTheDocument()
    unmount()

    const outside = renderAt('/demo/owner')
    expect(within(outside.bar).getByRole('button', { name: /^Finances/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  /**
   * Including the group the reader is standing in. That case was refused until
   * the owner drove it: the guard existed because a first implementation
   * refused the whole tap, so closing really did strand you — and once the fix
   * for that made a second tap reopen the group, the hazard was gone and the
   * guard was not. It never held the line anyway: opening another group and
   * closing that one reached the same state by a longer route.
   */
  it('closes and reopens from inside the group, like any other tab', async () => {
    const user = userEvent.setup()
    const { bar } = renderAt('/demo/owner/ledger')

    const finances = within(bar).getByRole('button', { name: /^Finances/ })
    expect(finances).toHaveAttribute('aria-expanded', 'true')

    await user.click(finances)
    expect(finances).toHaveAttribute('aria-expanded', 'false')
    expect(within(bar).queryByRole('link', { name: /^Billing/ })).toBeNull()
    // Still lit, because the reader has not moved: the bar says where you are.
    expect(finances.className).toContain('accent-text')

    await user.click(finances)
    expect(finances).toHaveAttribute('aria-expanded', 'true')
    expect(within(bar).getByRole('link', { name: /^Billing/ })).toBeInTheDocument()
  })

  it('lets a reader inside one group open another, and come back', async () => {
    const user = userEvent.setup()
    const { bar } = renderAt('/demo/owner/ledger')

    await user.click(within(bar).getByRole('button', { name: /^Setup/ }))
    expect(within(bar).getByRole('button', { name: /^Finances/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(within(bar).getByRole('link', { name: /^Menu/ })).toBeInTheDocument()

    // And back to their own siblings.
    await user.click(within(bar).getByRole('button', { name: /^Finances/ }))
    expect(within(bar).getByRole('link', { name: /^Ledger/ })).toBeInTheDocument()
  })

  /**
   * The card used to be re-seeded by comparing the *group* the address names
   * rather than the address itself, so a move between two entries that both sit
   * outside every group — Attendance to Overview, the pair a phone bar shows
   * side by side — changed nothing and left the card standing. Reported by the
   * owner on 2026-09-01: *"I clicked on Setup to open its subtabs, but next if I
   * click on Overview, it doesn't collapse the Setup children."*
   */
  it('collapses a hand-opened group on going somewhere else entirely', async () => {
    const user = userEvent.setup()
    const { bar } = renderAt('/demo/owner/attendance')

    await user.click(within(bar).getByRole('button', { name: /^Setup/ }))
    expect(within(bar).getByRole('link', { name: /^Menu/ })).toBeInTheDocument()

    await user.click(within(bar).getByRole('link', { name: /^Overview/ }))

    expect(within(bar).getByRole('button', { name: /^Setup/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(within(bar).queryByRole('link', { name: /^Menu/ })).toBeNull()
  })

  it('keeps a group open while the reader moves between its own entries', async () => {
    const user = userEvent.setup()
    const { bar } = renderAt('/demo/owner/ledger')

    // Finances opened by the address. Hopping to a sibling must not shut the
    // row the reader is hopping along: the address names Finances on both
    // sides of the move.
    await user.click(within(bar).getByRole('link', { name: /^Expenses/ }))

    expect(within(bar).getByRole('button', { name: /^Finances/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(within(bar).getByRole('link', { name: /^Ledger/ })).toBeInTheDocument()
  })

  it('says where the reader is, not what they last tapped', async () => {
    const user = userEvent.setup()
    const { bar } = renderAt('/demo/owner')

    await user.click(within(bar).getByRole('button', { name: /^Setup/ }))

    // Overview keeps the lit colour; Setup is merely expanded.
    expect(within(bar).getByRole('link', { name: /^Overview/ }).className).toContain('accent-text')
    expect(within(bar).getByRole('button', { name: /^Setup/ }).className).not.toContain(
      'accent-text',
    )
  })
})

describe('waiting work inside a folded group', () => {
  /**
   * The regression the whole group-sum rule exists to prevent. Delivery is the
   * only entry in Setup carrying live waiting work, so folding it behind a
   * heading with nothing on it would put decisions that are waiting right now
   * out of sight.
   */
  it('is readable from a shut Setup, without expanding it', async () => {
    const { bar } = renderAt('/demo/owner')

    const badge = await within(bar).findByTestId('nav-group-badge-setup')
    expect(Number(badge.textContent?.replace(/\D.*/, ''))).toBeGreaterThan(0)
    // And it is a sentence, not a bare number, for anybody not looking at it.
    expect(badge).toHaveTextContent(/Setup: .*needs? you/i)
  })

  it('becomes the parts when the group opens, and never both at once', async () => {
    const user = userEvent.setup()
    const { bar } = renderAt('/demo/owner')

    const sum = await within(bar).findByTestId('nav-group-badge-setup')
    const total = Number(sum.textContent?.replace(/\D.*/, ''))

    await user.click(within(bar).getByRole('button', { name: /^Setup/ }))

    await waitFor(() =>
      expect(within(bar).getByTestId('nav-badge-delivery-needs-you')).toHaveTextContent(
        String(total),
      ),
    )
    // Two numbers describing one queue would leave the reader to work out
    // whether they overlap.
    expect(within(bar).queryByTestId('nav-group-badge-setup')).toBeNull()
  })

  it('leaves a group with nothing waiting indistinguishable from an unbadged one', async () => {
    const { bar } = renderAt('/demo/owner')

    // No entry in Finances declares an attention source, so it renders exactly
    // as a group that was never badged does.
    await within(bar).findByTestId('nav-group-badge-setup')
    expect(within(bar).queryByTestId('nav-group-badge-finances')).toBeNull()
  })
})

describe('the wide-screen rail', () => {
  it('opens its sections by default, because there is room', () => {
    const { rail } = renderAt('/demo/owner')

    expect(within(rail).getByRole('button', { name: /^Setup/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(within(rail).getByRole('link', { name: /^Delivery/ })).toBeInTheDocument()
  })

  it('collapses a section to its sum, and drops its children from the page', async () => {
    const user = userEvent.setup()
    const { rail } = renderAt('/demo/owner')

    await within(rail).findByTestId('nav-badge-delivery-needs-you')
    await user.click(within(rail).getByRole('button', { name: /^Setup/ }))

    expect(within(rail).queryByRole('link', { name: /^Delivery/ })).toBeNull()
    expect(await within(rail).findByTestId('nav-group-badge-setup')).toBeInTheDocument()
  })
})
