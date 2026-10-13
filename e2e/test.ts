import { test as base } from '@playwright/test'

import { seedDemoGates } from './support/change-gates'

export { expect } from '@playwright/test'

/**
 * Every demo spec's `test`: Playwright's, with this run's change-gate state
 * seeded into each context before its first page loads (design D10).
 * `eslint.config.js` refuses a spec that imports `test` from Playwright
 * directly, because that spec would run every gate on whatever the run says.
 */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await seedDemoGates(context)
    await provide(context)
  },
})
