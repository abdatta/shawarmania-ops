import { useState, type ComponentProps } from 'react'

import { Button } from '@/components/ui/button'
import { MemberMark } from '@/components/ui/member-mark'
import { Money } from '@/components/ui/money'
import { formatIndianPhone } from '../../../shared/phone'
import { CustomerDialog, type CustomerSelection } from './customer-dialog'
import { PaymentDialog } from './payment-dialog'
import { PointsDialog } from './points-dialog'

type CheckoutDialogProps = ComponentProps<typeof PaymentDialog> &
  Pick<ComponentProps<typeof CustomerDialog>, 'lookup' | 'suggest' | 'grantGold' | 'goldMonths'> & {
    customer: CustomerSelection | null
    collectCustomerDetails?: boolean
    onChooseCustomer: (customer: CustomerSelection) => void
    points: Omit<ComponentProps<typeof PointsDialog>, 'open' | 'onClose' | 'onConfirm'> & {
      shown: boolean
      used: number
      onUse: (points: number) => void
    }
  }

/** Number first, then membership and points, then the total and tender. */
export function CheckoutDialog(props: CheckoutDialogProps) {
  if (!props.open) return null
  return <OpenCheckoutDialog {...props} />
}

function OpenCheckoutDialog({
  customer,
  collectCustomerDetails = true,
  onChooseCustomer,
  lookup,
  suggest,
  grantGold,
  goldMonths,
  points,
  ...payment
}: CheckoutDialogProps) {
  const [step, setStep] = useState<'customer' | 'tender' | 'points'>(() =>
    !collectCustomerDetails || customer?.kind === 'identified' ? 'tender' : 'customer',
  )
  const [allocationsReset, setAllocationsReset] = useState(false)
  if (step === 'customer' && collectCustomerDetails) {
    return (
      <CustomerDialog
        open
        purpose="payment"
        selection={customer}
        lookup={lookup}
        suggest={suggest}
        grantGold={grantGold}
        {...(goldMonths !== undefined ? { goldMonths } : {})}
        onClose={payment.onClose}
        onChoose={(selection) => {
          setAllocationsReset(true)
          onChooseCustomer(selection)
          setStep('tender')
        }}
      />
    )
  }
  if (step === 'points') {
    return (
      <PointsDialog
        {...points}
        open
        onClose={() => setStep('tender')}
        onConfirm={(value) => {
          points.onUse(value)
          setStep('tender')
        }}
      />
    )
  }
  return (
    <PaymentDialog
      {...payment}
      initialPayments={allocationsReset ? [] : (payment.initialPayments ?? [])}
      // A changed total or customer invalidates any amount already allocated.
      key={`${payment.totalPaise}:${customer?.kind === 'identified' ? customer.phone : ''}:${points.used}`}
      beforeTender={
        collectCustomerDetails || customer?.kind === 'identified' ? (
          <div
            className="mt-3 space-y-2 rounded-xl bg-surface-raised p-3"
            data-testid="checkout-customer"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-sm text-content">
                {customer?.kind === 'identified' ? (
                  <>
                    <p className="flex items-center gap-2 font-bold">
                      {customer.name || 'Customer'} {customer.tier === 'gold' && <MemberMark />}
                    </p>
                    <p>{formatIndianPhone(customer.phone)}</p>
                    <p className="text-xs text-content-muted">Receipt SMS after payment syncs.</p>
                  </>
                ) : (
                  <p className="text-content-muted">No number · no receipt SMS</p>
                )}
              </div>
              {collectCustomerDetails && (
                <Button
                  variant="ghost"
                  size="phone"
                  disabled={payment.busy}
                  onClick={() => {
                    setAllocationsReset(true)
                    setStep('customer')
                  }}
                >
                  {customer?.kind === 'identified' ? 'Change' : 'Add number'}
                </Button>
              )}
            </div>
            {points.shown && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                <p className="text-sm text-content">
                  {customer?.kind === 'identified' && customer.pointsBalance != null
                    ? customer.pointsFresh
                      ? `${points.balance} points available`
                      : `${customer.pointsBalance} points · remembered balance`
                    : 'Points already on this order'}
                  {points.used > 0 && (
                    <span className="block font-bold">
                      <Money paise={points.used * 100} /> off with {points.used} points
                    </span>
                  )}
                </p>
                <Button
                  variant="secondary"
                  size="phone"
                  disabled={payment.busy || (points.max < 1 && points.used === 0)}
                  onClick={() => {
                    setAllocationsReset(true)
                    setStep('points')
                  }}
                >
                  {points.used > 0
                    ? 'Change points'
                    : points.max > 0
                      ? `Use ${points.max} points`
                      : 'Use points'}
                </Button>
              </div>
            )}
          </div>
        ) : null
      }
    />
  )
}
