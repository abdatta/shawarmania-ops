import { describe, expect, it, vi } from 'vitest'
import {
  MSG91_FLOW_URL,
  MSG91_RECEIPT_TEMPLATE,
  parseReceiptReport,
  receiptPayload,
  receiptSecretMatches,
  submitReceipt,
} from '../supabase/functions/_shared/receipt-delivery.ts'

const job = {
  bill_id: 'b5900000-0000-4000-a000-000000000001',
  mobile: '919000000101',
  earned: 20,
  balance: 1250,
  token: 'Ab3-_x9QzT',
}

describe('automatic receipt provider boundary', () => {
  it('uses the approved template, ungrouped numbers, registered URL and bill correlation', () => {
    expect(receiptPayload(job)).toEqual({
      template_id: MSG91_RECEIPT_TEMPLATE,
      short_url: '0',
      recipients: [
        {
          mobiles: job.mobile,
          earned: '20',
          balance: '1250',
          url: 'https://shawarmania.in/bill?t=Ab3-_x9QzT',
          UUID: job.bill_id,
          CRQID: job.bill_id,
        },
      ],
    })
  })
  it('keeps zero earnings and the existing balance', () => {
    expect(receiptPayload({ ...job, earned: 0 }).recipients[0]).toMatchObject({
      earned: '0',
      balance: '1250',
    })
  })
  it.each([{ token: 'demo~12' }, { balance: -1 }, { earned: 0.1 }, { mobile: '+919000000101' }])(
    'refuses malformed provider data without a request: %s',
    async (bad) => {
      const transport = vi.fn()
      expect(await submitReceipt({ ...job, ...bad }, 'test-key', transport)).toMatchObject({
        state: 'failed',
      })
      expect(transport).not.toHaveBeenCalled()
    },
  )
  it('records acceptance separately from delivery and uses the auth header', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(Response.json({ type: 'success', message: '6ac1321521ce1c2d3f08a382' }))
    expect(await submitReceipt(job, 'test-key', transport)).toMatchObject({ state: 'submitted' })
    expect(transport).toHaveBeenCalledWith(
      MSG91_FLOW_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authkey: 'test-key' }),
      }),
    )
  })
  it('keeps provider rejection text out of the stored result', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(Response.json({ type: 'error', message: 'private phone and token' }))
    expect(await submitReceipt(job, 'bad-key', transport)).toEqual({
      state: 'failed',
      requestId: null,
      failureCode: 'provider_rejected',
    })
  })
  it.each(['timeout', 'bad-json', 'unknown-shape', 'http-error'])(
    'never retries uncertain %s',
    async (kind) => {
      const transport = vi.fn()
      if (kind === 'timeout') transport.mockRejectedValue(new Error('lost response'))
      else if (kind === 'bad-json') transport.mockResolvedValue(new Response('not json'))
      else if (kind === 'http-error')
        transport.mockResolvedValue(new Response('gateway', { status: 502 }))
      else transport.mockResolvedValue(Response.json({ type: 'success', message: 'no' }))
      expect(await submitReceipt(job, 'test-key', transport)).toEqual({
        state: 'unknown',
        requestId: null,
        failureCode: 'submission_unknown',
      })
      expect(transport).toHaveBeenCalledTimes(1)
    },
  )
  it('reads only the minimal authenticated report fields and ignores pending', () => {
    const report = { billId: job.bill_id, requestId: '6ac1321521ce1c2d3f08a382', status: '1' }
    expect(parseReceiptReport(report)).toEqual({
      billId: job.bill_id,
      requestId: report.requestId,
      state: 'delivered',
    })
    expect(parseReceiptReport({ ...report, status: '2' }).state).toBe('failed')
    expect(parseReceiptReport({ ...report, status: '0' })).toBeNull()
    expect(parseReceiptReport({ ...report, billId: 'not-a-bill' })).toBeNull()
  })
  it('requires the complete configured secret', () => {
    const secret = 'a'.repeat(64)
    expect(receiptSecretMatches(secret, secret)).toBe(true)
    expect(receiptSecretMatches(`${secret}b`, secret)).toBe(false)
    expect(receiptSecretMatches(secret.slice(1), secret)).toBe(false)
    expect(receiptSecretMatches(null, secret)).toBe(false)
    expect(receiptSecretMatches(secret, undefined)).toBe(false)
  })
})
