import { execSync } from 'node:child_process'

import { defineConfig } from 'vitest/config'

/** As `vitest.drawer-writes.config.ts`: the key cleans up, and does nothing else. */
function serviceRoleKey(): string {
  const configured = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (configured) return configured
  const status = JSON.parse(
    execSync('npx supabase status -o json', { encoding: 'utf8' }),
  ) as Record<string, unknown>
  const discovered = status['SERVICE_ROLE_KEY']
  if (typeof discovered !== 'string' || discovered.length === 0) {
    throw new Error('The local Supabase service-role key could not be discovered')
  }
  return discovered
}

/**
 * The ledger's round-trip measurement, in its own phase.
 *
 * It records a drawer anchor and a count per outlet so the measured day reads its
 * balances, and removes them afterwards with the service-role key — the same
 * shape as the drawer-writes phase, and for the same reason it cannot sit in the
 * ordinary RLS phase, which only ever attempts denied writes.
 */
export default defineConfig({
  test: {
    env: {
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey(),
    },
    environment: 'node',
    include: ['supabase/tests/rest/zz-ledger-month-timing.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
})
