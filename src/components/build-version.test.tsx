import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChangeGatesContext } from '@/change-gates/context'
import { ALL_OFF } from '@/change-gates/snapshot'
import { BUILD_SHA } from '@/pwa/build-info'
import { ChangeGatesForTest, describeChangeGate } from '@/test/change-gates'

import { BuildVersion } from './build-version'

/**
 * The build stamp (a-release-can-be-switched-off, D16): the build and when it
 * was built, as it always read, and one tap copies that line with the change
 * gates it runs added to the build.
 */

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

afterEach(() => {
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined })
  vi.unstubAllGlobals()
})

describe('the build stamp', () => {
  it('reads as it always has, and a tap copies the line', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    render(<BuildVersion />)
    const stamp = screen.getByTestId('build-version')
    expect(stamp.tagName).toBe('BUTTON')
    expect(stamp).toHaveTextContent(/^Build \S+ · \d/)
    const line = stamp.textContent

    await user.click(stamp)
    expect(writeText).toHaveBeenCalledWith(line)
    await waitFor(() => expect(stamp).toHaveTextContent('Copied'))
  })

  it('reads the same while gates are on, and copies them with the build', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    render(
      <ChangeGatesContext.Provider value={{ ...ALL_OFF, probe: true, 'pro-rata-pnl': true }}>
        <BuildVersion />
      </ChangeGatesContext.Provider>,
    )
    const stamp = screen.getByTestId('build-version')
    expect(stamp).toHaveTextContent(/^Build \S+ · \d/)
    expect(stamp).not.toHaveTextContent('PB')
    expect(stamp).toHaveAttribute('data-build-code', `${BUILD_SHA}·PB-PR`)
    const builtAt = (stamp.textContent ?? '').split(' · ')[1]

    await user.click(stamp)
    expect(writeText).toHaveBeenCalledWith(`Build ${BUILD_SHA}·PB-PR · ${builtAt}`)
  })

  it('shows and selects the whole line where the clipboard is refused, claiming no copy', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn().mockRejectedValue(new Error('not allowed')))
    render(
      <ChangeGatesContext.Provider value={{ ...ALL_OFF, probe: true }}>
        <BuildVersion />
      </ChangeGatesContext.Provider>,
    )
    const stamp = screen.getByTestId('build-version')
    await user.click(stamp)
    await waitFor(() => expect(stamp).toHaveTextContent(`Build ${BUILD_SHA}·PB · `))
    expect(stamp).not.toHaveTextContent('Copied')
    expect(window.getSelection()?.toString()).toContain(`${BUILD_SHA}·PB`)
  })
})

describeChangeGate('probe', (on) => {
  it(on ? 'puts PB in the copied build' : 'copies the build alone', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    render(
      <ChangeGatesForTest on={{ probe: on }}>
        <BuildVersion />
      </ChangeGatesForTest>,
    )
    await user.click(screen.getByTestId('build-version'))
    const copied = String(writeText.mock.calls[0]?.[0])
    if (on) expect(copied).toMatch(new RegExp(`^Build ${BUILD_SHA}·(\\w\\w-)*PB(-\\w\\w)* · `))
    else expect(copied).not.toContain('PB')
  })
})
