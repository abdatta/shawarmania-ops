import { test as base, type Browser } from '@playwright/test'

import { GATE_STATE, seedDeviceGates } from '../e2e/support/change-gates'

import { gatesNotAt } from './change-gates.setup'

export { expect } from '@playwright/test'

/**
 * Every auth spec's `test`: Playwright's, with this run's change-gate answers
 * saved in each context before its first page loads (design D10), so a tablet
 * boots running them instead of reloading into them mid-test. Contexts a spec
 * opens itself with `browser.newContext()` are seeded too. `eslint.config.js`
 * refuses a spec that imports `test` from Playwright directly.
 *
 * Before each test the local database's gates are checked against the run's
 * state. A spec that turns a gate and leaves it turned would otherwise have the
 * next spec's tablets read a different answer than they booted with and reload
 * mid-test, failing at whichever step the reload lands on (instant-saves on
 * Staging, 2026-10-16). Here it fails at once and names the gate.
 */
export const test = base.extend<{ gatesAtRunState: void }, { browser: Browser }>({
  browser: [
    async ({ browser }, provide) => {
      const newContext = browser.newContext.bind(browser)
      browser.newContext = async (options) => {
        const context = await newContext(options)
        await seedDeviceGates(context)
        return context
      }
      await provide(browser)
    },
    { scope: 'worker' },
  ],
  context: async ({ context }, provide) => {
    await seedDeviceGates(context)
    await provide(context)
  },
  gatesAtRunState: [
    // Playwright reads a fixture's dependencies from this pattern; it has none.
    // eslint-disable-next-line no-empty-pattern
    async ({}, provide) => {
      const turned = await gatesNotAt(GATE_STATE)
      if (turned.length > 0) {
        throw new Error(
          `This run has every gate ${GATE_STATE}, but the local database has ${turned.join(', ')} ` +
            `turned ${GATE_STATE === 'on' ? 'off' : 'on'}: a previous spec left ` +
            `${turned.length === 1 ? 'it' : 'them'} turned. ` +
            `A spec that turns a gate must put every gate back (turnEveryGate in change-gates.setup.ts).`,
        )
      }
      await provide()
    },
    { auto: true },
  ],
})
