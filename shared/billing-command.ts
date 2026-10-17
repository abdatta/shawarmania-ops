/**
 * Immutable billing-command vocabulary shared by the browser, adapters and
 * server-facing tooling. PostgreSQL mirrors the canonical JSON and SHA-256
 * rules in `billing_transaction_contract.sql`; changing either half requires
 * the cross-runtime vectors in `src/lib/billing-command.test.ts` to change too.
 */

/**
 * The payload shape this build writes.
 *
 * Version 2 added the discount records and the rounding line; version 3 (#60)
 * added how the order was served — its type, its table, and each line's kind;
 * version 4 (#62) adds where each bill-level discount came from, the biller or
 * the customer's points.
 * **The database still accepts versions 1 to 3**, and must: a till that went
 * offline before a release and reconnects after it is holding envelopes written
 * under the old shape, with hashes already computed over it, and refusing those
 * would lose a trading day to a deployment. A version-1 payload means no
 * discounts and no rounding, and versions 1 and 2 mean neither type, no table
 * and every line an item, and versions 1 to 3 mean every discount the
 * biller's — exactly what they meant when they were written.
 */
export const BILLING_COMMAND_SCHEMA_VERSION = 4 as const

/** Every payload shape the boundary accepts, newest first. */
export const BILLING_COMMAND_SCHEMA_VERSIONS = [4, 3, 2, 1] as const

/** Who a bill-level discount came from (#62): the biller, or the customer's points. */
export type BillingDiscountSource = 'biller' | 'points'

export type BillingCommandType =
  | 'create_order'
  | 'revise_order'
  | 'cancel_order'
  | 'pay_order'
  | 'pay_now'
  | 'correct_bill_payment'
  | 'void_bill'
  | 'manager_cancel_order'
  | 'confirm_end_of_day'
  | 'set_order_preparation'
  | 'prepare_order_lines'
  | 'void_order_payment'
  | 'cancel_paid_order'

export type BillingPaymentMethod = 'cash' | 'upi'
export type BillingPricingMode = 'no_tax'
/** How an order was served. Null on a payload is neither. */
export type BillingServiceType = 'dine_in' | 'takeaway'
/** An item from the menu, or the packaging (#60). */
export type BillingLineKind = 'item' | 'packaging'

export interface BillingPaymentAllocation {
  readonly method: BillingPaymentMethod
  readonly amountPaise: number
}

/**
 * One line as it was sold.
 *
 * `unitPricePaise` is the **list** price and `lineTotalPaise` is gross, so the
 * subtotal still sums the lines. What a menu discount took off sits beside them
 * in `discountPaise`, with `discountPercentBp` recording the percentage that
 * produced it — or null where the discount was given in rupees, in which case
 * the per-unit amount is `discountPaise / quantity`. `categoryName` is
 * snapshotted for the same reason `itemName` is.
 */
export interface BillingLineSnapshot {
  readonly note?: string | null
  readonly id: string
  readonly menuItemId: string | null
  readonly itemName: string
  readonly unitPricePaise: number
  readonly quantity: number
  readonly lineTotalPaise: number
  readonly discountPaise: number
  readonly discountPercentBp: number | null
  readonly categoryName: string | null
  /**
   * A packaging line has no menu item and no category, and its discount is
   * nothing or its whole total at 100% — the gold waiver, and nothing else.
   */
  readonly kind: BillingLineKind
}

/**
 * How the order was served, snapshotted like everything else on it. The
 * boundary checks these for shape only, never against what the outlet
 * currently offers: an offline tablet may have rung the order before a setting
 * changed.
 */
export interface BillingServiceFacts {
  readonly serviceType: BillingServiceType | null
  /** 1 to 999, and only on a dine-in order. */
  readonly tableNumber: number | null
}

/** One discount applied to the whole bill rather than to any single line. */
export interface BillingDiscountSnapshot {
  /**
   * Written on every version-4 entry. Absent on an entry queued under an
   * earlier version, which the boundary reads as the biller's. A points entry
   * is an amount in whole rupees, at most one per order, and only with a
   * customer's phone — the boundary checks that shape, and never the balance.
   */
  readonly source?: BillingDiscountSource
  readonly basis: 'percent' | 'amount'
  /** Basis points when the basis is a percentage, else null. */
  readonly valueBp: number | null
  /** Paise when the basis is an amount, else null. */
  readonly valuePaise: number | null
  readonly amountPaise: number
}

export interface OrderContentPayload extends BillingServiceFacts {
  readonly label?: string | null
  readonly orderId: string
  readonly businessDate: string
  readonly customerId: string | null
  readonly customerName: string | null
  readonly customerPhone: string | null
  readonly subtotalPaise: number
  readonly discountPaise: number
  readonly taxPaise: number
  readonly roundingPaise: number
  readonly totalPaise: number
  readonly pricingMode: BillingPricingMode
  readonly lines: readonly BillingLineSnapshot[]
  readonly discounts: readonly BillingDiscountSnapshot[]
}

export type CreateOrderPayload = OrderContentPayload
export type ReviseOrderPayload = OrderContentPayload

export interface CancelOrderPayload {
  readonly orderId: string
  readonly reason: string
}

export interface PayOrderPayload {
  readonly billId: string
  readonly orderId: string
  readonly payments: readonly BillingPaymentAllocation[]
  readonly paidAt: string
  readonly paymentBusinessDate: string
}

export interface PayNowPayload extends BillingServiceFacts {
  readonly billId: string
  readonly businessDate: string
  readonly paymentBusinessDate: string
  readonly customerId: string | null
  readonly customerName: string | null
  readonly customerPhone: string | null
  readonly subtotalPaise: number
  readonly discountPaise: number
  readonly taxPaise: number
  readonly roundingPaise: number
  readonly totalPaise: number
  readonly pricingMode: BillingPricingMode
  readonly payments: readonly BillingPaymentAllocation[]
  readonly lines: readonly BillingLineSnapshot[]
  readonly discounts: readonly BillingDiscountSnapshot[]
}

export interface CorrectBillPaymentPayload {
  readonly billId: string
  readonly expectedRevision: number
  readonly payments: readonly BillingPaymentAllocation[]
}

export interface VoidBillPayload {
  readonly billId: string
  readonly reason: string
}

export interface ConfirmEndOfDayPayload {
  readonly outletId: string
  readonly businessDate: string
  readonly unsentCount: number
  readonly needsAttentionCount: number
}

/** Marking prepared or repreparing an order, by the tablet that took it. */
export interface SetOrderPreparationPayload {
  readonly orderId: string
  readonly prepared: boolean
}

export interface PrepareOrderLinesPayload {
  readonly orderId: string
  readonly lines: readonly { readonly id: string; readonly prepared: boolean }[]
}

/** One reasoned unwind of a counter payment, by the tablet that took it. */
export interface UnwindOrderPaymentPayload {
  readonly orderId: string
  readonly billId: string
  readonly reason: string
}

export interface BillingCommandPayloads {
  readonly create_order: CreateOrderPayload
  readonly revise_order: ReviseOrderPayload
  readonly cancel_order: CancelOrderPayload
  readonly pay_order: PayOrderPayload
  readonly pay_now: PayNowPayload
  readonly correct_bill_payment: CorrectBillPaymentPayload
  readonly void_bill: VoidBillPayload
  readonly manager_cancel_order: CancelOrderPayload
  readonly confirm_end_of_day: ConfirmEndOfDayPayload
  readonly set_order_preparation: SetOrderPreparationPayload
  readonly prepare_order_lines: PrepareOrderLinesPayload
  readonly void_order_payment: UnwindOrderPaymentPayload
  readonly cancel_paid_order: UnwindOrderPaymentPayload
}

/**
 * Which family of server functions a command was written for
 * (each-dish-is-ticked-off, design R3).
 *
 * A change gate cannot reach the outbox (a-release-can-be-switched-off, D7), and
 * a command's type cannot change meaning, so a path that needs new server
 * functions says so on the command itself when it queues it. The command keeps
 * it for its whole life, so it reaches the functions it was written for however
 * long it waits. Absent on a command a build from before #74 queued, and on a
 * direct payment, which therefore stay byte-for-byte what they were; those go to
 * the functions their type names, which stay published until the contract
 * migration of `retire-dish-ticks`. Envelope metadata, never part of the payload
 * or its hash.
 *
 * - `dishes` — the dish ticks' `_v2` functions (each-dish-is-ticked-off).
 */
export type BillingCommandVariant = 'dishes'

export interface BillingCommandEnvelope<
  TType extends BillingCommandType = BillingCommandType,
  TPayload extends BillingCommandPayloads[TType] = BillingCommandPayloads[TType],
> {
  readonly commandId: string
  readonly schemaVersion: typeof BILLING_COMMAND_SCHEMA_VERSION
  readonly tabletId: string | null
  readonly shiftId: string | null
  readonly type: TType
  readonly createdAt: string
  readonly payload: TPayload
  readonly payloadHash: string
  readonly variant?: BillingCommandVariant
}

export type BillingCommand = {
  [TType in BillingCommandType]: BillingCommandEnvelope<TType, BillingCommandPayloads[TType]>
}[BillingCommandType]

type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject
interface JsonObject {
  readonly [key: string]: JsonValue
}

/** Canonical JSON: sorted object keys, stable arrays, no insignificant spaces. */
export function canonicalBillingJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalBillingJson).join(',')}]`

  const object = value as JsonObject
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalBillingJson(object[key]!)}`)
    .join(',')}}`
}

/** Lower-case SHA-256 of the canonical UTF-8 payload, matching PostgreSQL. */
export async function billingPayloadHash(payload: JsonObject): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalBillingJson(payload))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createBillingCommand<TType extends BillingCommandType>(input: {
  readonly commandId: string
  readonly tabletId: string | null
  readonly shiftId: string | null
  readonly type: TType
  readonly createdAt: string
  readonly payload: BillingCommandPayloads[TType]
  /** Only a path that needs other functions says so; the field is otherwise absent. */
  readonly variant?: BillingCommandVariant
}): Promise<BillingCommandEnvelope<TType, BillingCommandPayloads[TType]>> {
  const { variant, ...rest } = input
  return {
    ...rest,
    schemaVersion: BILLING_COMMAND_SCHEMA_VERSION,
    payloadHash: await billingPayloadHash(input.payload as unknown as JsonObject),
    ...(variant ? { variant } : {}),
  }
}

/** Every RPC key is present; unknown values travel as explicit nulls. */
export function billingCommandRpcArguments(command: BillingCommand) {
  return {
    p_command_id: command.commandId,
    p_schema_version: command.schemaVersion,
    p_payload_hash: command.payloadHash,
    p_created_at: command.createdAt,
    p_shift_id: command.shiftId,
    p_payload: command.payload,
  } as const
}

export const BILLING_COMMAND_RPC: Readonly<Record<BillingCommandType, string>> = {
  create_order: 'create_billing_order',
  revise_order: 'revise_billing_order',
  cancel_order: 'cancel_billing_order',
  pay_order: 'pay_billing_order',
  pay_now: 'pay_billing_now',
  correct_bill_payment: 'correct_bill_payment',
  void_bill: 'void_billing_bill',
  manager_cancel_order: 'manager_cancel_billing_order',
  confirm_end_of_day: 'confirm_billing_end_of_day',
  set_order_preparation: 'prepare_billing_order',
  prepare_order_lines: 'prepare_order_lines',
  void_order_payment: 'unpay_billing_order',
  cancel_paid_order: 'cancel_paid_billing_order',
}

/** The functions a variant replaces; every type it does not name goes where it always has. */
export const BILLING_COMMAND_VARIANT_RPC: Readonly<
  Record<BillingCommandVariant, Partial<Record<BillingCommandType, string>>>
> = {
  dishes: {
    create_order: 'create_billing_order_v2',
    revise_order: 'revise_billing_order_v2',
    prepare_order_lines: 'prepare_order_lines_v2',
  },
}

/** The RPC a command is delivered to: its variant's, else its type's. Reads no gate. */
export function billingCommandRpc(command: Pick<BillingCommand, 'type' | 'variant'>): string {
  return (
    (command.variant ? BILLING_COMMAND_VARIANT_RPC[command.variant][command.type] : undefined) ??
    BILLING_COMMAND_RPC[command.type]
  )
}
