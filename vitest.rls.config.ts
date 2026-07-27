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
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
