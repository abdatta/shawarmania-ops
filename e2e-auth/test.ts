import { test as base, type Browser } from '@playwright/test'

import { seedDeviceGates } from '../e2e/support/change-gates'

export { expect } from '@playwright/test'

/**
 * Every auth spec's `test`: Playwright's, with this run's change-gate answers
 * saved in each context before its first page loads (design D10), so a tablet
 * boots running them instead of reloading into them mid-test. Contexts a spec
 * opens itself with `browser.newContext()` are seeded too. `eslint.config.js`
 * refuses a spec that imports `test` from Playwright directly.
 */
export const test = base.extend<object, { browser: Browser }>({
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
})
