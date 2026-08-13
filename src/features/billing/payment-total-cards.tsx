import { Money } from '@/components/ui/money'
import { BILLING_PAYMENT_METHODS, type BillingMethodTotal } from '@/data-access/adapters'

function methodLabel(method: BillingMethodTotal['method']) {
  return method === 'upi' ? 'UPI' : method[0]!.toUpperCase() + method.slice(1)
}

/**
 * Cash and UPI always use the same compact, glanceable cards wherever billing
 * payment totals are shown. The caller decides the scope of the supplied totals
 * (current shift or selected outlet day) and names its test boundary.
 */
export function PaymentTotalCards({
  totals,
  testIdPrefix,
}: {
  totals: readonly BillingMethodTotal[]
  testIdPrefix: string
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {BILLING_PAYMENT_METHODS.map((paymentMethod) => (
        <div
          key={paymentMethod}
          data-testid={`${testIdPrefix}-${paymentMethod}`}
          className="rounded-xl border border-border bg-surface p-3"
        >
          <p className="text-sm font-black uppercase text-content-muted">
            {methodLabel(paymentMethod)}
          </p>
          <Money
            paise={totals.find((total) => total.method === paymentMethod)?.totalPaise ?? 0}
            display
            className="mt-1 block"
          />
        </div>
      ))}
    </div>
  )
}
