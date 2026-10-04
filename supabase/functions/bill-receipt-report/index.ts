import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { Database } from '../../../src/data-access/database.types.ts'
import { parseReceiptReport, receiptSecretMatches } from '../_shared/receipt-delivery.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  if (
    !receiptSecretMatches(
      req.headers.get('x-receipt-webhook-secret'),
      Deno.env.get('RECEIPT_WEBHOOK_SECRET'),
    )
  )
    return new Response(null, { status: 401 })
  const raw = await req.text()
  if (raw.length > 2048) return new Response(null, { status: 413 })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response(null, { status: 400 })
  }
  const report = parseReceiptReport(body)
  if (!report) return new Response(null, { status: 400 })
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return new Response(null, { status: 503 })
  const service = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await service.rpc('bill_receipt_report', {
    p_bill: report.billId,
    p_request_id: report.requestId,
    p_state: report.state,
  })
  if (error) return new Response(null, { status: 503 })
  return Response.json({ accepted: data === true })
})
