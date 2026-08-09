/**
 * Immutable billing-command vocabulary shared by the browser, adapters and
 * server-facing tooling. PostgreSQL mirrors the canonical JSON and SHA-256
 * rules in `billing_transaction_contract.sql`; changing either half requires
 * the cross-runtime vectors in `src/lib/billing-command.test.ts` to change too.
 */

export const BILLING_COMMAND_SCHEMA_VERSION = 1 as const

export type BillingCommandType =
  | 'create_order'
  | 'revise_order'
  | 'cancel_order'
  | 'pay_order'
  | 'pay_now'
  | 'void_bill'
  | 'manager_cancel_order'
  | 'confirm_end_of_day'

export type BillingPaymentMethod = 'cash' | 'upi' | 'card' | 'swiggy' | 'zomato' | 'other'
export type BillingPricingMode = 'no_tax'

export interface BillingLineSnapshot {
  readonly id: string
  readonly menuItemId: string | null
  readonly itemName: string
  readonly unitPricePaise: number
  readonly quantity: number
  readonly lineTotalPaise: number
}

export interface OrderContentPayload {
  readonly orderId: string
  readonly businessDate: string
  readonly customerId: string | null
  readonly customerName: string | null
  readonly customerPhone: string | null
  readonly subtotalPaise: number
  readonly discountPaise: number
  readonly taxPaise: number
  readonly totalPaise: number
  readonly pricingMode: BillingPricingMode
  readonly lines: readonly BillingLineSnapshot[]
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
  readonly paymentMethod: BillingPaymentMethod
  readonly paidAt: string
  readonly paymentBusinessDate: string
}

export interface PayNowPayload {
  readonly billId: string
  readonly businessDate: string
  readonly paymentBusinessDate: string
  readonly customerId: string | null
  readonly customerName: string | null
  readonly customerPhone: string | null
  readonly subtotalPaise: number
  readonly discountPaise: number
  readonly taxPaise: number
  readonly totalPaise: number
  readonly pricingMode: BillingPricingMode
  readonly paymentMethod: BillingPaymentMethod
  readonly lines: readonly BillingLineSnapshot[]
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

export interface BillingCommandPayloads {
  readonly create_order: CreateOrderPayload
  readonly revise_order: ReviseOrderPayload
  readonly cancel_order: CancelOrderPayload
  readonly pay_order: PayOrderPayload
  readonly pay_now: PayNowPayload
  readonly void_bill: VoidBillPayload
  readonly manager_cancel_order: CancelOrderPayload
  readonly confirm_end_of_day: ConfirmEndOfDayPayload
}

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
}): Promise<BillingCommandEnvelope<TType, BillingCommandPayloads[TType]>> {
  return {
    ...input,
    schemaVersion: BILLING_COMMAND_SCHEMA_VERSION,
    payloadHash: await billingPayloadHash(input.payload as unknown as JsonObject),
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
  void_bill: 'void_billing_bill',
  manager_cancel_order: 'manager_cancel_billing_order',
  confirm_end_of_day: 'confirm_billing_end_of_day',
}
