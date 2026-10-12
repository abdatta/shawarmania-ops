import { useEffect, useState, useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'

import { useAdapters } from '@/data-access'
import type {
  BillingOrder,
  BillingAdapter,
  BillDiscountDraft,
  PaymentAllocation,
  OutletMenu,
} from '@/data-access/adapters'
import {
  ALL_OFF_LOYALTY_SETTINGS,
  ALL_OFF_SERVICE_SETTINGS,
  billTotals,
  isPackagingLine,
  lineTotalPaise,
  packagingLine,
  packagingWaived,
  pointsUsableMax,
  POINT_VALUE_PAISE,
} from '@/domain'
import { getPartState, isRenderable } from '@/gates/registry'
import { normalizeIndianPhone } from '../../../shared/phone'
import { CheckoutDialog } from './checkout-dialog'
import type { CustomerSelection } from './customer-dialog'

export type CheckoutOrderRevision = Parameters<BillingAdapter['reviseOrder']>[1]

export function OrderCheckoutDialog({
  order,
  mode,
  busy,
  error,
  onClose,
  onConfirm,
  initialSettings,
}: {
  order: BillingOrder
  mode: 'demo' | 'real'
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (payments: PaymentAllocation[], revision: CheckoutOrderRevision | null) => void
  initialSettings?: Pick<OutletMenu, 'service' | 'loyalty'>
}) {
  const { customers, menu } = useAdapters()
  const [phone] = useState(() => normalizeIndianPhone(order.customerPhone))
  const [customer, setCustomer] = useState<CustomerSelection>(() =>
    phone
      ? {
          kind: 'identified',
          phone,
          name: order.customerName ?? '',
          tier: order.customerTier ?? null,
        }
      : { kind: 'skipped', name: order.customerName ?? '' },
  )
  const originalHeld = order.discounts
    .filter((row) => row.source === 'points')
    .reduce((sum, row) => sum + row.amountPaise / POINT_VALUE_PAISE, 0)
  const [held, setHeld] = useState(originalHeld)
  const [requested, setRequested] = useState(originalHeld)
  const [settings, setSettings] = useState<Pick<OutletMenu, 'service' | 'loyalty'> | null>(
    initialSettings ?? null,
  )
  const [settingsReady, setSettingsReady] = useState(initialSettings !== undefined)
  const lookup = useCallback((value: string) => customers.lookupByPhone(value), [customers])
  const suggest = useCallback(
    (value: string) => customers.suggestByPartialPhone(value),
    [customers],
  )
  const grantGold = useCallback((id: string) => customers.grantGoldAtCounter(id), [customers])
  useEffect(() => {
    // The counter already owns an authorised, cached menu snapshot. Paying a
    // saved ticket must never wait for an extra network read.
    if (initialSettings) return
    let active = true
    void menu
      .readOutletMenu(order.outletId)
      .then((value) => {
        if (active) setSettings(value)
      })
      .catch(() => {
        /* Existing captured prices and held points still permit payment offline. */
      })
      .finally(() => {
        if (active) setSettingsReady(true)
      })
    return () => {
      active = false
    }
  }, [menu, order.outletId, initialSettings])
  useEffect(() => {
    if (!phone) return
    let active = true
    void lookup(phone)
      .then((identity) => {
        if (!active || !identity) return
        setCustomer((current) =>
          current.kind === 'identified' && current.phone === phone
            ? {
                ...current,
                customerId: identity.id,
                tier: identity.tier === undefined ? (current.tier ?? null) : identity.tier,
                pointsBalance: identity.pointsBalance ?? null,
                pointsFresh: identity.remembered !== true,
              }
            : current,
        )
      })
      .catch(() => {
        /* An unavailable directory never stops a sale. */
      })
    return () => {
      active = false
    }
  }, [lookup, phone])
  const loyalty = settings?.loyalty ?? ALL_OFF_LOYALTY_SETTINGS
  const service = settings?.service ?? ALL_OFF_SERVICE_SETTINGS
  const gold = customer.kind === 'identified' && customer.tier === 'gold'
  const lines = order.lines.map((line) =>
    settings && isPackagingLine(line)
      ? packagingLine(
          {
            unitPricePaise: line.unitPricePaise,
            quantity: line.quantity,
            ...(line.orderLineId ? { orderLineId: line.orderLineId } : {}),
          },
          packagingWaived(service, gold ? 'gold' : null),
        )
      : line,
  )
  const billerDiscounts = order.discounts.filter((row) => row.source !== 'points')
  const netPaise =
    lines.reduce(
      (sum, line) =>
        sum + lineTotalPaise(line.unitPricePaise, line.quantity) - (line.discountPaise ?? 0),
      0,
    ) - billerDiscounts.reduce((sum, row) => sum + row.amountPaise, 0)
  const balance =
    (customer.kind === 'identified' && customer.pointsFresh ? (customer.pointsBalance ?? 0) : 0) +
    held
  const shown =
    isRenderable(getPartState('outlet-points'), mode) &&
    loyalty.pointsEnabled &&
    customer.kind === 'identified' &&
    (customer.pointsBalance != null || held > 0)
  const max =
    settings && loyalty.pointsEnabled
      ? pointsUsableMax({ settings: loyalty, balance, gold, netPaise })
      : held
  const used = Math.min(requested, max)
  const discounts: BillDiscountDraft[] =
    used > 0
      ? [
          ...billerDiscounts,
          {
            source: 'points',
            basis: 'amount',
            valueBp: null,
            valuePaise: used * POINT_VALUE_PAISE,
            amountPaise: used * POINT_VALUE_PAISE,
          },
        ]
      : billerDiscounts
  const revision: CheckoutOrderRevision = {
    lines,
    discounts,
    customerId: null,
    customerName: customer.name,
    customerPhone: customer.kind === 'identified' ? customer.phone : '',
    customerTier: customer.kind === 'identified' ? (customer.tier ?? null) : null,
    serviceType: order.serviceType ?? null,
    tableNumber: order.tableNumber ?? null,
  }
  const lineKeys = [
    'orderLineId',
    'menuItemId',
    'itemName',
    'unitPricePaise',
    'quantity',
    'discountPaise',
    'discountPercentBp',
    'categoryName',
    'kind',
  ] as const
  const discountKeys = ['source', 'basis', 'valueBp', 'valuePaise', 'amountPaise'] as const
  const sameLines =
    lines.length === order.lines.length &&
    lines.every((line, index) =>
      lineKeys.every((key) => (line[key] ?? null) === (order.lines[index]![key] ?? null)),
    )
  const sameDiscounts =
    discounts.length === order.discounts.length &&
    discounts.every((row, index) =>
      discountKeys.every((key) => (row[key] ?? null) === (order.discounts[index]![key] ?? null)),
    )
  const changed =
    !sameLines ||
    !sameDiscounts ||
    (revision.customerName || null) !== (order.customerName || null) ||
    (revision.customerPhone || null) !== (order.customerPhone || null) ||
    revision.customerTier !== (order.customerTier ?? null)
  const total = billTotals(lines, {
    discountPaise:
      lines.reduce((sum, line) => sum + (line.discountPaise ?? 0), 0) +
      discounts.reduce((sum, row) => sum + row.amountPaise, 0),
  }).totalPaise
  // Read the outlet choice before deciding whether to ask; do not flash a
  // number prompt at an outlet that has explicitly switched collection off.
  if (!settingsReady) {
    return (
      <Modal
        open
        onClose={onClose}
        aria-label="Loading payment"
        className="w-[min(26rem,calc(100%-2rem))] rounded-xl p-4"
      >
        <LoadingRegion label="payment settings" className="space-y-3">
          <Shimmer className="h-6 w-40" />
          <Shimmer className="h-24" />
          <Shimmer className="h-44" />
        </LoadingRegion>
        <Button className="mt-3 w-full" variant="secondary" onClick={onClose}>
          Back
        </Button>
      </Modal>
    )
  }
  return (
    <CheckoutDialog
      open
      collectCustomerDetails={service.collectCustomerDetails ?? true}
      customer={customer}
      lookup={lookup}
      suggest={suggest}
      grantGold={
        isRenderable(getPartState('counter-gold'), mode) && loyalty.goldCounterGrant
          ? grantGold
          : undefined
      }
      goldMonths={loyalty.goldDurationMonths}
      onChooseCustomer={(next) => {
        if (
          customer.kind !== 'identified' ||
          next.kind !== 'identified' ||
          customer.phone !== next.phone
        ) {
          setRequested(0)
          setHeld(0)
        }
        setCustomer(next)
      }}
      points={{
        shown,
        netPaise,
        capPercent:
          ((gold && loyalty.goldEnabled ? loyalty.goldUseCapBp : loyalty.useCapBp) ?? 0) / 100,
        balance,
        max,
        current: used > 0 ? used : null,
        used,
        busy,
        onUse: setRequested,
      }}
      totalPaise={changed ? total : order.totalPaise}
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={(payments) => onConfirm(payments, changed ? revision : null)}
    />
  )
}
