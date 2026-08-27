import { defineConfig } from 'vitest/config'

/**
 * Open question 3's measurement, in its own phase.
 *
 * It reads only — no writes, nothing to clean up — but it is slow by nature and
 * its output is a number rather than a pass, so it is kept out of the ordinary
 * RLS phase where a two-minute file would look like a hang.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/rest/zz-ledger-month-timing.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
})
