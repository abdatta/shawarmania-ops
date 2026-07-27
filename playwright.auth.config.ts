import { defineConfig, devices } from '@playwright/test'

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
const PORT = 4174
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
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: process.env['VITE_SUPABASE_ANON_KEY'] ?? LOCAL_ANON_KEY,
    },
  },
})
