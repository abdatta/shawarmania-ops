import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const ORIGIN = `http://127.0.0.1:${PORT}`

/**
 * Must match `base` in vite.config.ts. The suite runs under the same sub-path
 * production does, so a base-path mistake — a stale absolute asset URL, a
 * router basename left at the root — fails here rather than on a tablet.
 *
 * Because baseURL carries a path, specs navigate with RELATIVE URLs
 * (`page.goto('.')`, `page.goto('some/route')`). A leading slash would resolve
 * against the origin and skip the base entirely.
 */
const BASE_PATH = process.env['BASE_PATH'] ?? '/shawarmania-ops/'
const BASE_URL = `${ORIGIN}${BASE_PATH}`

/**
 * E2E runs against a production build, never the dev server: the service
 * worker only exists in a real build, and the offline gate is the whole point
 * of this suite.
 */
export default defineConfig({
  testDir: './e2e',
  // Above Playwright's 30s default: the offline specs install a service worker
  // and prime its precache before they can assert anything.
  timeout: 90_000,
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  // Serial in CI: the offline specs share a service worker registration.
  ...(process.env['CI'] ? { workers: 1 } : {}),
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [
    // The counter tablet is the device that matters most for the offline path.
    { name: 'tablet', use: { ...devices['Galaxy Tab S4 landscape'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    // --host is explicit: `vite preview` otherwise binds only to `localhost`,
    // which resolves to ::1 on Windows and leaves 127.0.0.1 unanswered.
    command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    // Poll the base path, not the origin: under a sub-path the origin 404s.
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    env: {
      ...process.env,
      // Dummy Supabase config, so the demo-entry guard has a constructable
      // client to read its (seeded, fake) session through. Nothing in the
      // suite may actually reach this host — the origin tripwire in
      // e2e/demo.spec.ts fails the run if anything tries.
      VITE_SUPABASE_URL: process.env['VITE_SUPABASE_URL'] ?? 'https://demo-only.supabase.co',
      VITE_SUPABASE_ANON_KEY: process.env['VITE_SUPABASE_ANON_KEY'] ?? 'demo-only-anon-key',
    },
  },
})
