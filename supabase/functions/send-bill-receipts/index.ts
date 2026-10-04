import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { Database } from '../../../src/data-access/database.types.ts'
import { receiptSecretMatches, submitReceipt } from '../_shared/receipt-delivery.ts'

// JWT sessions are not authority to send messages. Only the Vault worker secret.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  if (
    !receiptSecretMatches(
      req.headers.get('x-receipt-worker-secret'),
      Deno.env.get('RECEIPT_WORKER_SECRET'),
    )
  )
    return new Response(null, { status: 401 })
  const key = Deno.env.get('MSG91_AUTHKEY')
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!key || !url || !serviceKey) return new Response(null, { status: 503 })
  const service = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await service.rpc('bill_receipt_claim', { p_limit: 10 })
  if (error) return new Response(null, { status: 503 })
  const results = await Promise.all(
    (data ?? []).map(async (job) => {
      const outcome = await submitReceipt(job, key)
      const { error: finishError } = await service.rpc('bill_receipt_finish', {
        p_bill: job.bill_id,
        p_state: outcome.state,
        ...(outcome.requestId ? { p_request_id: outcome.requestId } : {}),
        ...(outcome.failureCode ? { p_failure_code: outcome.failureCode } : {}),
      })
      return !finishError // A lost finish is recovered as uncertain, never resent.
    }),
  )
  return Response.json(
    { processed: results.length },
    { status: results.every(Boolean) ? 200 : 503 },
  )
})
