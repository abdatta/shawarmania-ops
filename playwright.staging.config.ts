import { defineConfig, devices } from '@playwright/test'

/**
 * The staging smoke suite (a-release-can-be-switched-off, D19), against a
 * published staging build — never a local server, so there is no `webServer`.
 *
 *   STAGING_SUPABASE_URL=… STAGING_SUPABASE_ANON_KEY=… STAGING_TEST_PASSWORD=… \
 *     npm run test:e2e:staging
 *
 * `STAGING_BASE_URL` points it somewhere else, such as a staging build served
 * locally against the local stack seeded with `scripts/seed-staging.mjs --local`.
 */
const BASE_URL = process.env['STAGING_BASE_URL'] ?? 'https://stage-ops.shawarmania.in/'

export default defineConfig({
  testDir: './e2e-staging',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // A remote build answers slower than a local one; a stuck step still fails
    // at the step, not at the test's timeout.
    actionTimeout: 30_000,
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
})
