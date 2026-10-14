import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * The dish records' isolation probe (each-dish-is-ticked-off, tasks 3.9) makes
 * dedicated devices and append-only Ready history, so it runs in its own phase
 * after the seed-sensitive isolation files.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['supabase/tests/rest/dish-ticks-isolation.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
