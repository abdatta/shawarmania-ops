import { defineConfig, devices } from '@playwright/test'

import { PORTS } from './ports'

/**
 * The auth suite, kept apart from the rest of the end-to-end tests for one
 * reason: it is the only suite that needs a **real backend**. Everything else
 * in e2e/ runs against a build wired to a deliberately unreachable Supabase,
 * which is what lets `npm run test:e2e` work on a laptop with no Docker.
 *
 *   npm run db:start && npm run db:reset && npm run test:e2e:auth
 *
 * Its own port, too, so a preview server left running by the other suite —
 * built with the dummy configuration — can never be reused for these tests
 * and fail them mysteriously.
 */
const PORT = PORTS.e2eAuth
const BASE_PATH = process.env['BASE_PATH'] ?? '/shawarmania-ops/'
const BASE_URL = `http://127.0.0.1:${PORT}${BASE_PATH}`

// The Supabase CLI's well-known local demo anon key — public by design,
// identical in every local stack, useless anywhere else.
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

export default defineConfig({
  testDir: './e2e-auth',
  timeout: 90_000,
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE_URL,
    /**
     * Never reused, even locally, because the separate port above does not
     * isolate as much as it looks like it does.
     *
     * `vite preview` reads `dist/` from disk per request, and BOTH suites build
     * into it — the demo config deliberately building against an unreachable
     * Supabase host so nothing in it can call a backend. Reusing a still-alive
     * server here skips the rebuild, so this suite would run against whichever
     * build happened to be on disk. After a demo run that is a build pointed at
     * a host that does not exist, and every provisioning step fails with the
     * generic "that did not work" — which reads as a product bug and is not one.
     *
     * The cost is one rebuild per run; the alternative is a suite whose result
     * depends on what ran before it.
     */
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: process.env['VITE_SUPABASE_ANON_KEY'] ?? LOCAL_ANON_KEY,
    },
  },
})
