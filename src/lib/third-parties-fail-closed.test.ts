import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { receiptSecretMatches } from '../../supabase/functions/_shared/receipt-delivery.ts'

/**
 * Staging reaches no third party (a-release-can-be-switched-off, D19).
 *
 * Staging's Edge Functions are deployed without the receipt sender's secrets,
 * the aggregator sync secret or the GitHub dispatch token. Each function that
 * could reach outside the project must therefore refuse, before it does
 * anything, when its secret is absent: no bill rung on staging may text a real
 * phone, and no sync may reach a real restaurant account. The handlers are
 * `Deno.serve` callbacks that cannot be imported here, so this reads each one
 * and asserts its refusal comes before its first call outward — the same way
 * `sync-dispatch-contract.test.ts` holds the dispatch shape. The database side,
 * the receipt wake-up's Vault entries, is `supabase/tests/87_…sql`.
 */

const source = (name: string) =>
  readFileSync(resolve(process.cwd(), 'supabase/functions', name, 'index.ts'), 'utf8')

/** The handler, from `Deno.serve(` on, so helpers above it do not count. */
const handler = (name: string) => {
  const text = source(name)
  const start = text.indexOf('Deno.serve(')
  expect(start, `${name} has no Deno.serve handler`).toBeGreaterThan(-1)
  return text.slice(start)
}

/** Where the handler first does something that could leave the function. */
const firstCallOut = (body: string) =>
  Math.min(
    ...[
      /createClient\(/,
      /serviceClient\(/,
      /\bfetch\(/,
      /submitReceipt\(/,
      /\.rpc\(/,
      /readJson\(/,
    ]
      .map((pattern) => body.search(pattern))
      .filter((index) => index > -1),
  )

const CASES = [
  {
    fn: 'send-bill-receipts',
    secret: 'RECEIPT_WORKER_SECRET',
    refusal:
      /receiptSecretMatches\([\s\S]*?Deno\.env\.get\('RECEIPT_WORKER_SECRET'\),?\s*\)\s*\)\s*return new Response\(null, \{ status: 401 \}\)/,
  },
  {
    fn: 'send-bill-receipts',
    secret: 'MSG91_AUTHKEY',
    refusal:
      /if \(!key \|\| !url \|\| !serviceKey\) return new Response\(null, \{ status: 503 \}\)/,
  },
  {
    fn: 'bill-receipt-report',
    secret: 'RECEIPT_WEBHOOK_SECRET',
    refusal:
      /receiptSecretMatches\([\s\S]*?Deno\.env\.get\('RECEIPT_WEBHOOK_SECRET'\),?\s*\)\s*\)\s*return new Response\(null, \{ status: 401 \}\)/,
  },
  {
    fn: 'aggregator-reader',
    secret: 'AGGREGATOR_SYNC_SECRET',
    refusal: /if \(!expected\) \{[\s\S]*?return json\(\{ error: 'not_configured' \}, 503\)/,
  },
  {
    fn: 'ingest-aggregator-cycle',
    secret: 'AGGREGATOR_SYNC_SECRET',
    refusal: /if \(!expected\) \{[\s\S]*?return json\(\{ error: 'not_configured' \}, 503\)/,
  },
  {
    fn: 'request-aggregator-sync',
    secret: 'GITHUB_DISPATCH_TOKEN',
    refusal: /if \(!token\) \{[\s\S]*?return json\(\{ error: 'not_configured' \}, 503\)/,
  },
] as const

describe('every function that reaches outside refuses when its secret is absent', () => {
  it.each(CASES)(
    '$fn without $secret refuses before calling anything',
    ({ fn, secret, refusal }) => {
      const body = handler(fn)
      expect(body).toContain(`Deno.env.get('${secret}')`)
      const at = body.search(refusal)
      expect(at, `${fn} has no refusal for a missing ${secret}`).toBeGreaterThan(-1)
      expect(at, `${fn} calls out before refusing a missing ${secret}`).toBeLessThan(
        firstCallOut(body),
      )
    },
  )

  it('treats an absent receipt secret as matching nothing, not as anything goes', () => {
    expect(receiptSecretMatches('a'.repeat(64), undefined)).toBe(false)
    expect(receiptSecretMatches('', undefined)).toBe(false)
    expect(receiptSecretMatches(null, undefined)).toBe(false)
  })
})
