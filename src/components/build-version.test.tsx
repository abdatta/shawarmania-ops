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
 * was built, as it always read; while any change gate is on, a button opening
 * the build code — the build and the gates it runs — with a Copy.
 */

afterEach(() => vi.unstubAllGlobals())

describe('the build stamp', () => {
  it('reads as it always has, and is not a button, while no gate is on', () => {
    render(<BuildVersion />)
    const stamp = screen.getByTestId('build-version')
    expect(stamp).toHaveTextContent(/^Build \S+ · \d/)
    expect(stamp.tagName).toBe('P')
  })

  it('reads the same while gates are on, and opens the build code to copy', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(
      <ChangeGatesContext.Provider value={{ ...ALL_OFF, probe: true, 'tablet-health': true }}>
        <BuildVersion />
      </ChangeGatesContext.Provider>,
    )
    const stamp = screen.getByTestId('build-version')
    expect(stamp).toHaveTextContent(/^Build \S+ · \d/)
    expect(stamp).not.toHaveTextContent('PB')
    expect(stamp.tagName).toBe('BUTTON')

    await user.click(stamp)
    expect(screen.getByTestId('build-code')).toHaveTextContent(`${BUILD_SHA}·PB-TH`)
    await user.click(screen.getByTestId('copy-build-code'))
    expect(writeText).toHaveBeenCalledWith(`${BUILD_SHA}·PB-TH`)
    await waitFor(() => expect(screen.getByTestId('copy-build-code')).toHaveTextContent('Copied'))
  })
})

describeChangeGate('probe', (on) => {
  it(on ? 'puts PB in the build code' : 'leaves the stamp plain text', async () => {
    const user = userEvent.setup()
    render(
      <ChangeGatesForTest on={{ probe: on }}>
        <BuildVersion />
      </ChangeGatesForTest>,
    )
    const stamp = screen.getByTestId('build-version')
    if (!on) {
      expect(stamp.tagName).toBe('P')
      return
    }
    await user.click(stamp)
    expect(screen.getByTestId('build-code')).toHaveTextContent(`${BUILD_SHA}·PB`)
  })
})
