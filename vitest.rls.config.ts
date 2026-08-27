import { defineConfig } from 'vitest/config'

/**
 * The REST-level isolation probes (`npm run test:rls`) live outside the
 * default `npm test` run because they need the local Supabase stack up
 * (`npm run db:start`, `npm run db:reset`). They sign in real seeded users
 * through GoTrue and hand-craft PostgREST requests — the roadmap gate for
 * data-model-and-tenancy stated literally.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/rest/**/*.test.ts'],
    // The billing race probe mutates immutable money history and therefore runs
    // in its own second phase after the seed-sensitive isolation files.
    exclude: [
      'supabase/tests/rest/counter-handshake.test.ts',
      'supabase/tests/rest/zz-billing-command-races.test.ts',
      // Makes real drawer writes and cleans up after itself with the
      // service-role key, so it runs in its own phase — see
      // vitest.drawer-writes.config.ts.
      'supabase/tests/rest/zz-cash-drawer-writes.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
