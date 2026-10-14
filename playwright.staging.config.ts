import { defineConfig, devices } from '@playwright/test'

/**
 * The staging smoke suite (a-release-can-be-switched-off, D19), against a
 * published staging build — never a local server, so there is no `webServer`.
 *
 *   STAGING_TEST_PASSWORD=… \
 *     npm run test:e2e:staging
 *
 * `STAGING_BASE_URL` points it somewhere else, such as a staging build served
 * locally against the local stack seeded with `scripts/seed-staging.mjs --local`.
 */
const BASE_URL = process.env['STAGING_BASE_URL'] ?? 'https://stage-ops.shawarmania.in/'

// The report of a failed run is public, because the repository is, so nothing
// in it may carry the test password. A failure's own page snapshot would show
// it typed on the sign-in screen (the smoke spec leaves that screen before it
// fails); this turns off the snapshot Playwright adds for any other failure.
process.env['PLAYWRIGHT_NO_COPY_PROMPT'] = '1'

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
    // No trace: it records the sign-in request, whose body is the password, and
    // the session tokens that come back. A failure keeps a screenshot instead.
    trace: 'off',
    screenshot: 'only-on-failure',
    // A remote build answers slower than a local one; a stuck step still fails
    // at the step, not at the test's timeout.
    actionTimeout: 30_000,
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
})
