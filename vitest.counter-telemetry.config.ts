import { execSync } from 'node:child_process'

import { defineConfig } from 'vitest/config'

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

/** The positive heartbeat probes write device telemetry, then restore the seed. */
export default defineConfig({
  test: {
    env: { SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey() },
    environment: 'node',
    include: ['supabase/tests/rest/zz-counter-telemetry.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
