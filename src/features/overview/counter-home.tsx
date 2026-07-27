import { ReceiptText } from 'lucide-react'

import { EmptyState } from '@/components/layout/empty-state'

/**
 * The Biller home inside the fixed tablet chrome. The billing counter itself
 * — menu grid, current bill, settle — arrives with ui-billing-counter (#6).
 */
export function CounterHome() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={ReceiptText}
        title="The billing counter lands here next: whole menu on one screen, two taps from order to settle."
      />
    </div>
  )
}
