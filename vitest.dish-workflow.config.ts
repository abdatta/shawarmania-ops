import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Dedicated devices and append-only Ready history must follow seed probes. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['supabase/tests/rest/dish-workflow.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
