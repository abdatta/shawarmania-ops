import { execSync } from 'node:child_process'

import { defineConfig } from 'vitest/config'

function serviceRoleKey(): string {
  const configured = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (configured) return configured

  const status = JSON.parse(
    execSync('npx supabase status -o json', {
      encoding: 'utf8',
    }),
  ) as Record<string, unknown>
  const discovered = status['SERVICE_ROLE_KEY']
  if (typeof discovered !== 'string' || discovered.length === 0) {
    throw new Error('The local Supabase service-role key could not be discovered')
  }
  return discovered
}

/**
 * The drawer's REST probes, in their own phase for the reason
 * `vitest.billing-races.config.ts` has one: they make **real writes**.
 *
 * Every other file in `supabase/tests/rest/` attempts only denied writes, which
 * is what lets that phase run repeatedly against one `db reset`. This one cannot
 * — its central claim is that a Super Admin holding no assignment anywhere
 * genuinely records a count, a collection, a spend and a verification over HTTP,
 * and a denied write would prove the opposite of the thing being asserted.
 *
 * So it commits, and then cleans up after itself with the service-role key,
 * which is why that key is handed in here and nowhere in the ordinary phase.
 * Without the cleanup the committed rows are visible to `test:db`'s pgTAP suite
 * on a later run, and Kanchrapara's anchor assertions start failing against an
 * outlet that already has an observation — which is exactly what happened before
 * this file existed.
 */
export default defineConfig({
  test: {
    env: {
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey(),
    },
    environment: 'node',
    include: ['supabase/tests/rest/zz-cash-drawer-writes.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  // The `effective_expenses` probe drives the REAL ledger adapter rather than
  // hand-rolling its select, because the defect it guards was the adapter
  // reading the wrong relation — and an assertion that queries the right one
  // itself would pass while the app stayed broken. That adapter resolves
  // `@/domain`, so this phase needs the alias, exactly as
  // `vitest.ledger-timing.config.ts` does for the same reason.
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
})
