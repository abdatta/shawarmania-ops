import type { BillingBill } from '@/data-access/adapters'

const LABELS = {
  queued: 'SMS queued',
  sending: 'Submitting SMS',
  submitted: 'SMS submitted',
  delivered: 'SMS delivered',
  failed: 'SMS failed',
  unknown: 'SMS delivery uncertain',
  skipped: 'SMS not sent',
} as const
const FAILURES: Record<string, string> = {
  provider_rejected: 'MSG91 refused the message. Check the sender configuration or wallet.',
  provider_failed: 'The operator could not deliver the message.',
  submission_unknown: 'The send could not be confirmed. It will not be sent again automatically.',
  bill_unavailable: 'The bill was cancelled or its receipt link was revoked before sending.',
  invalid_points: 'The points could not be included in the approved SMS template.',
}

export function ReceiptDeliveryStatus({ delivery }: { delivery: BillingBill['receiptDelivery'] }) {
  if (!delivery) return null
  const issue = delivery.state === 'failed' || delivery.state === 'unknown'
  return (
    <div data-testid="receipt-delivery-status">
      <p className={issue ? 'font-semibold text-danger' : 'font-semibold text-content'}>
        {LABELS[delivery.state]}
      </p>
      {delivery.failureCode && (
        <p className="mt-1 text-xs text-content-muted">
          {FAILURES[delivery.failureCode] ?? 'The message could not be delivered.'}
          {issue && ' Use Send receipt to share it on WhatsApp.'}
        </p>
      )}
    </div>
  )
}
