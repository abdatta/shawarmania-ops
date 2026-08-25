import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('restaurant mapping queries', () => {
  it('uses the mapping state contract instead of querying a nonexistent enabled column', () => {
    const paths = [
      'supabase/functions/parse-operator-statement/index.ts',
      'supabase/functions/request-aggregator-sync/index.ts',
    ]

    for (const path of paths) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')

      expect(source).toContain(".eq('state', 'enabled')")
      expect(source).not.toContain(".eq('enabled', true)")
    }
  })
})
