import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('restaurant mapping queries', () => {
  it('live only in the typed shared contract', () => {
    const functionRoot = resolve(process.cwd(), 'supabase/functions')
    const paths = edgeFunctionSources(functionRoot).filter((path) =>
      readFileSync(path, 'utf8').includes(".from('outlet_channel_restaurants')"),
    )

    expect(paths).toEqual([join(functionRoot, '_shared', 'restaurant-mappings.ts')])
    for (const path of paths) {
      const source = readFileSync(path, 'utf8')

      expect(source).toContain(".eq('state', 'enabled')")
      expect(source).not.toContain(".eq('enabled', true)")
    }
  })
})

function edgeFunctionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return edgeFunctionSources(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}
