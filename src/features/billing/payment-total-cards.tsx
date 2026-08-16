import { Money } from '@/components/ui/money'
import { BILLING_PAYMENT_METHODS, type BillingMethodTotal } from '@/data-access/adapters'

function methodLabel(method: BillingMethodTotal['method']) {
  return method === 'upi' ? 'UPI' : method[0]!.toUpperCase() + method.slice(1)
}

/**
 * One money figure, named. The card is the presentation both scopes share, so
 * the tender split and anything shown beside it are the same object on screen.
 */
function TotalCard({ label, paise, testId }: { label: string; paise: number; testId: string }) {
  return (
    <div data-testid={testId} className="rounded-xl border border-border bg-surface p-3">
      <p className="text-sm font-black uppercase text-content-muted">{label}</p>
      <Money paise={paise} display className="mt-1 block" />
    </div>
  )
}

/**
 * Cash and UPI always use the same compact, glanceable cards wherever billing
 * payment totals are shown. The caller decides the scope of the supplied totals
 * (current shift or selected outlet day) and names its test boundary.
 *
 * A caller may add cards after the tender split — the manager's outlet-day view
 * adds the day's takings and its average bill. They are `further` cards rather
 * than a second component because they are the same reading of the same day at
 * the same glance, and a differently shaped card beside these two would say they
 * were something else. Their arithmetic is not this component's business: see
 * `day-totals.ts`, which owns it and is tested on its own.
 */
export function PaymentTotalCards({
  totals,
  testIdPrefix,
  further = [],
}: {
  totals: readonly BillingMethodTotal[]
  testIdPrefix: string
  further?: readonly { label: string; paise: number; testId: string }[]
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {BILLING_PAYMENT_METHODS.map((paymentMethod) => (
        <TotalCard
          key={paymentMethod}
          label={methodLabel(paymentMethod)}
          paise={totals.find((total) => total.method === paymentMethod)?.totalPaise ?? 0}
          testId={`${testIdPrefix}-${paymentMethod}`}
        />
      ))}
      {further.map((card) => (
        <TotalCard key={card.testId} label={card.label} paise={card.paise} testId={card.testId} />
      ))}
    </div>
  )
}
