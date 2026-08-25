import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('statement parser mapping query', () => {
  it('uses the mapping state contract instead of querying a nonexistent enabled column', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'supabase/functions/parse-operator-statement/index.ts'),
      'utf8',
    )

    expect(source).toContain(".eq('state', 'enabled')")
    expect(source).not.toContain(".eq('enabled', true)")
  })
})
