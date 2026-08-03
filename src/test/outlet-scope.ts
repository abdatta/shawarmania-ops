import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect } from 'vitest'

/**
 * Driving the outlet switcher from a test.
 *
 * It is a chip per outlet rather than a `<select>`, so choosing one is a click and
 * reading the choice is a pressed state. Both live here because six surfaces assert
 * the same two things, and a switcher that changes shape again should not be a
 * fifteen-file edit.
 */

/** The chip for one outlet, whichever mode the switcher is in. */
export function outletChip(outletId: string): HTMLElement {
  return screen.getByTestId(`surface-outlet-${outletId}`)
}

/** Choose an outlet, and wait until the surface agrees it is chosen. */
export async function chooseOutlet(outletId: string): Promise<void> {
  await userEvent.click(await screen.findByTestId(`surface-outlet-${outletId}`))
  await waitFor(() => {
    expectOutletChosen(outletId)
  })
}

/**
 * Assert which outlet is in scope.
 *
 * Both halves matter: the chip reports itself pressed, and it is disabled — the
 * current choice cannot be cleared, which is the rule that stops a surface ending
 * up scoped to nothing.
 */
export function expectOutletChosen(outletId: string): void {
  expect(outletChip(outletId)).toHaveAttribute('aria-pressed', 'true')
  expect(outletChip(outletId)).toBeDisabled()
}
