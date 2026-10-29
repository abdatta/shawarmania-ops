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

/**
 * The change-gate probes turn a gate and write tablet health, then restore the
 * gate and delete the health rows with the service-role key
 * (a-release-can-be-switched-off, task 2.6).
 */
export default defineConfig({
  test: {
    env: { SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey() },
    environment: 'node',
    include: [
      'supabase/tests/rest/zz-change-gates.test.ts',
      // Turns auto-approve-at-the-shop on and a rule at Kalyani, then restores both.
      'supabase/tests/rest/zz-auto-approve-at-the-shop.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  // The attendance probe imports the real outlets adapter, which resolves `@/`.
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
})
