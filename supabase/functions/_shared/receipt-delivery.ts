/** Fixed provider contract. Never log jobs, responses, tokens or phones. */
export const MSG91_RECEIPT_TEMPLATE = '6ac1321521ce1c2d3f08a382'
export const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow'
export interface ReceiptJob {
  bill_id: string
  mobile: string
  earned: number
  balance: number
  token: string
}
export type ReceiptOutcome =
  | { state: 'submitted'; requestId: string; failureCode: null }
  | { state: 'failed'; requestId: null; failureCode: 'provider_rejected' | 'invalid_points' }
  | { state: 'unknown'; requestId: null; failureCode: 'submission_unknown' }
const REQUEST_ID = /^[A-Za-z0-9_-]{10,100}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function receiptPayload(job: ReceiptJob) {
  if (
    !UUID.test(job.bill_id) ||
    !/^91[6-9][0-9]{9}$/.test(job.mobile) ||
    !/^[A-Za-z0-9_-]{10,100}$/.test(job.token) ||
    !Number.isSafeInteger(job.earned) ||
    job.earned < 0 ||
    !Number.isSafeInteger(job.balance) ||
    job.balance < 0
  )
    return null
  return {
    template_id: MSG91_RECEIPT_TEMPLATE,
    short_url: '0',
    recipients: [
      {
        mobiles: job.mobile,
        earned: String(job.earned),
        balance: String(job.balance),
        url: `https://shawarmania.in/bill?t=${job.token}`,
        UUID: job.bill_id,
        CRQID: job.bill_id,
      },
    ],
  }
}
export async function submitReceipt(
  job: ReceiptJob,
  authkey: string,
  transport: typeof fetch = fetch,
): Promise<ReceiptOutcome> {
  const payload = receiptPayload(job)
  if (!payload) return { state: 'failed', requestId: null, failureCode: 'invalid_points' }
  try {
    const response = await transport(MSG91_FLOW_URL, {
      method: 'POST',
      headers: { authkey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    const result: unknown = await response.json()
    if (result && typeof result === 'object') {
      const value = result as { type?: unknown; message?: unknown }
      if (
        response.ok &&
        value.type === 'success' &&
        typeof value.message === 'string' &&
        REQUEST_ID.test(value.message)
      )
        return { state: 'submitted', requestId: value.message, failureCode: null }
      if (value.type === 'error')
        return { state: 'failed', requestId: null, failureCode: 'provider_rejected' }
    }
  } catch {
    /* Acceptance is unknowable; repeating this request could send twice. */
  }
  return { state: 'unknown', requestId: null, failureCode: 'submission_unknown' }
}
export function parseReceiptReport(
  body: unknown,
): { billId: string; requestId: string; state: 'delivered' | 'failed' } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = body as Record<string, unknown>
  if (
    typeof value.billId !== 'string' ||
    !UUID.test(value.billId) ||
    typeof value.requestId !== 'string' ||
    !REQUEST_ID.test(value.requestId)
  )
    return null
  const status = String(value.status)
  const state =
    status === '1' ? 'delivered' : ['2', '16', '25', '17', '20'].includes(status) ? 'failed' : null
  return state ? { billId: value.billId, requestId: value.requestId, state } : null
}
export function receiptSecretMatches(
  provided: string | null,
  expected: string | undefined,
): boolean {
  if (!provided || !expected || expected.length < 32) return false
  let difference = provided.length ^ expected.length
  for (let i = 0; i < expected.length; i++)
    difference |= expected.charCodeAt(i) ^ (provided.charCodeAt(i) || 0)
  return difference === 0
}
