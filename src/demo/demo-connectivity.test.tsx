import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { appRoutes } from '@/routes'

/**
 * The demo's connectivity control, which replaced a second dark strip beneath
 * the banner.
 *
 * These tests hold it to the two things that made it worth moving: it is the
 * banner's, so the demo adds exactly one row of chrome and the till is not
 * pushed down by it; and it exists exactly where a counter does, because the
 * three phone shells hold no local queue and no resume record and a control
 * implying otherwise would describe an application we do not have.
 */

function renderDemo(path: string) {
  return render(
    <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />,
  )
}

const ONLINE = 'Online'
const DROPPED = 'Offline: network dropped'
const REOPENED = 'Offline: closed and reopened'

function control() {
  return screen.getByLabelText('Demo connectivity')
}

describe('demo connectivity', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => sessionStorage.clear())

  it('is one control in the banner, and the demo adds no second strip', async () => {
    renderDemo('/demo/biller')
    await screen.findByRole('heading', { name: 'Counter tablet' })

    const banner = screen.getByTestId('demo-banner')
    expect(banner).toContainElement(screen.getByTestId('demo-connectivity'))

    // The strip this replaced. Named literally, because the failure being
    // guarded against is somebody reintroducing demo chrome outside the one
    // container that marks chrome as chrome.
    expect(screen.queryByText('Extended-outage walkthrough')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Close and resume offline' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reconnect and drain' })).not.toBeInTheDocument()
  })

  /**
   * The control appears and disappears as a walkthrough switches role, so where
   * it sits decides whether the controls beside it hold still.
   *
   * It used to sit *after* the role switcher, with `ml-auto` on the switcher
   * itself — so arriving at the counter widened everything to the switcher's
   * right and slid all four role tabs sideways under the cursor of somebody
   * mid-click. Asserted structurally rather than by measuring: jsdom lays
   * nothing out, and the property that actually matters is that one
   * right-aligned cluster holds every control, with the conditional one first
   * so the cluster's left edge absorbs its appearance.
   */
  it('sits before the role switcher inside one cluster, so the tabs hold still', async () => {
    renderDemo('/demo/biller')
    await screen.findByRole('heading', { name: 'Counter tablet' })

    const connectivity = screen.getByTestId('demo-connectivity')
    const switcher = screen.getByRole('navigation', { name: 'Demo role switcher' })
    const reset = screen.getByTestId('demo-reset')
    const exit = screen.getByTestId('demo-exit')

    const cluster = connectivity.parentElement!
    expect(cluster).toContainElement(switcher)
    expect(cluster).toContainElement(reset)
    expect(cluster).toContainElement(exit)

    // Before the switcher, and it is the cluster rather than the switcher that
    // is anchored to the right.
    expect(connectivity.compareDocumentPosition(switcher)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(cluster.className).toContain('ml-auto')
    expect(switcher.className).not.toContain('ml-auto')
  })

  it('starts online and offers both offline states by the state they enter', async () => {
    renderDemo('/demo/biller')
    await screen.findByRole('heading', { name: 'Counter tablet' })

    expect(control()).toHaveValue('online')
    const options = [...control().querySelectorAll('option')].map((option) => option.textContent)
    expect(options).toEqual([ONLINE, DROPPED, REOPENED])
  })

  it('reaches the resumed counter, and returns from it', async () => {
    const user = userEvent.setup()
    renderDemo('/demo/biller')
    await screen.findByRole('heading', { name: 'Counter tablet' })

    await user.selectOptions(control(), 'closed-and-reopened')

    // The resumed tablet labels its reads as of the last time they were true,
    // which is the whole visible difference between this scene and the other.
    await waitFor(() => expect(screen.getByTestId('offline-resume-status')).toBeInTheDocument())

    await user.selectOptions(control(), 'online')
    await waitFor(() =>
      expect(screen.queryByTestId('offline-resume-status')).not.toBeInTheDocument(),
    )
    expect(control()).toHaveValue('online')
  })

  it('holds the dropped network without resuming from a record', async () => {
    const user = userEvent.setup()
    renderDemo('/demo/biller')
    await screen.findByRole('heading', { name: 'Counter tablet' })

    await user.selectOptions(control(), 'network-dropped')
    expect(control()).toHaveValue('network-dropped')

    // The distinction that makes these two states rather than one: the app is
    // still open, so nothing is being read from a stored record.
    expect(screen.queryByTestId('offline-resume-status')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Counter tablet' })).toBeInTheDocument()
  })

  it('survives a step onto a phone and back', async () => {
    const user = userEvent.setup()
    renderDemo('/demo/biller')
    await screen.findByRole('heading', { name: 'Counter tablet' })

    await user.selectOptions(control(), 'network-dropped')

    // The scene this exists for: the counter goes offline, the demonstrator
    // steps onto a phone to show what a manager can and cannot see, and comes
    // back. A flag held beside the counter host rather than on the store would
    // have reconnected the till in between.
    await user.click(screen.getByRole('link', { name: 'Owner' }))
    await screen.findByTestId('demo-banner')
    expect(screen.queryByTestId('demo-connectivity')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Biller' }))
    await screen.findByRole('heading', { name: 'Counter tablet' })
    expect(control()).toHaveValue('network-dropped')
  })

  it('returns to online when the demo is reset', async () => {
    const user = userEvent.setup()
    renderDemo('/demo/biller')
    await screen.findByRole('heading', { name: 'Counter tablet' })

    await user.selectOptions(control(), 'network-dropped')
    expect(control()).toHaveValue('network-dropped')

    await user.click(screen.getByTestId('demo-reset'))
    await user.click(await screen.findByRole('button', { name: 'Discard and start again' }))

    await screen.findByRole('heading', { name: 'Counter tablet' })
    await waitFor(() => expect(control()).toHaveValue('online'))
  })

  describe('is absent where the application has no offline capability', () => {
    it.each([
      ['owner', 'Super Admin'],
      ['admin', 'Franchise Admin'],
      ['staff', 'Employee'],
    ])('the %s walkthrough offers none', async (segment) => {
      renderDemo(`/demo/${segment}`)
      await screen.findByTestId('demo-banner')

      expect(screen.queryByTestId('demo-connectivity')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Demo connectivity')).not.toBeInTheDocument()
    })

    it('a Biller URL that resolves to no tablet offers none', async () => {
      renderDemo('/demo/biller/people')
      await screen.findByTestId('demo-banner')

      // The banner renders beside the not-found page rather than inside the
      // tablet, so the context is null and the control is simply not there.
      // Absence follows from what is rendered, which is why it cannot drift out
      // of step with the role router.
      expect(screen.queryByTestId('demo-connectivity')).not.toBeInTheDocument()
    })
  })
})
