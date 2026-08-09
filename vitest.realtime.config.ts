import { defineConfig } from 'vitest/config'

/**
 * Realtime needs an isolated process: parallel REST clients can exhaust the
 * local channel's delivery window even though publication and payload are
 * correct. This phase keeps the signal deterministic without weakening it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/rest/counter-handshake.test.ts'],
    fileParallelism: false,
    // `db:reset` restarts Realtime after the REST API is already reachable.
    // One whole-file retry covers that startup window; the payload assertion
    // and delivery deadline remain unchanged on the authoritative attempt.
    retry: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
