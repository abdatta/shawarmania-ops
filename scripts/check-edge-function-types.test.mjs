import { describe, expect, it } from 'vitest'

import { edgeFunctionTypeEntrypoints } from './check-edge-function-types.mjs'

describe('Edge Function typechecking', () => {
  it('covers the shared modules nothing else typechecks', () => {
    const names = edgeFunctionTypeEntrypoints().map((entry) =>
      entry.replace(/.*[/\\]functions[/\\]/, '').replaceAll('\\', '/'),
    )

    expect(names).toEqual([
      '_shared/restaurant-mappings.ts',
      '_shared/run-outcome.ts',
      'send-bill-receipts/index.ts',
      'bill-receipt-report/index.ts',
    ])
  })
})
