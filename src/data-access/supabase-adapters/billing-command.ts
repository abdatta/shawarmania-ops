import type { SupabaseClient } from '@supabase/supabase-js'

import {
  BILLING_COMMAND_RPC,
  billingCommandRpcArguments,
  type BillingCommand,
} from '../../../shared/billing-command'
import type { BillingCommandAdapter } from '../adapters'
import type { Database, Json } from '../database.types'
import type { BillingCommandResult } from '@/domain'

const RESULT_STATUSES = new Set<BillingCommandResult['status']>([
  'accepted',
  'replay',
  'order_not_open',
  'retryable_failure',
  'authorization_refused',
  'removed_tablet',
  'unsupported_schema',
  'malformed_payload',
  'arithmetic_invalid',
  'unresolved_operations',
  'identity_conflict',
])

/** Refuse a response whose shape is not the immutable server contract. */
export function parseBillingCommandResult(value: Json): BillingCommandResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('The billing command returned no structured result.')
  }
  const status = value.status
  if (
    typeof status !== 'string' ||
    !RESULT_STATUSES.has(status as BillingCommandResult['status'])
  ) {
    throw new TypeError('The billing command returned an unknown result.')
  }
  return value as unknown as BillingCommandResult
}

/** The one network seam used by both the foreground and the durable drain. */
export function createSupabaseBillingCommandAdapter(
  client: SupabaseClient<Database>,
): BillingCommandAdapter {
  return {
    async execute(command: BillingCommand): Promise<BillingCommandResult> {
      const rpc = BILLING_COMMAND_RPC[command.type]
      const args = billingCommandRpcArguments(command)
      // All eight command functions deliberately share one envelope signature.
      // The generated client cannot express a dynamic key preserving that fact,
      // so the cast is confined to this call and the response is parsed above.
      const invoke = client.rpc.bind(client) as unknown as (
        name: string,
        values: typeof args,
      ) => Promise<{ data: Json; error: Error | null; status?: number }>
      const { data, error, status } = await invoke(rpc, args)
      if (error) {
        // An HTTP response is positive reachability evidence. Turn the gateway
        // categories into the same explicit vocabulary as SQL, so a received
        // refusal never becomes an offline retry merely because Supabase put it
        // in `error` rather than `data`.
        if (status === 401 || status === 403) {
          return { status: 'authorization_refused', commandId: command.commandId }
        }
        if (status === 404) {
          return { status: 'unsupported_schema', commandId: command.commandId }
        }
        if (status === 400 || status === 422) {
          return { status: 'malformed_payload', commandId: command.commandId }
        }
        if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
          return { status: 'retryable_failure', commandId: command.commandId }
        }
        // Status 0 (and the equivalent missing status) carries no response
        // evidence. Let the drain classify that as unreachable transport.
        throw error
      }
      return parseBillingCommandResult(data)
    },

    async readiness(outletId, businessDate) {
      const { data, error } = await client.rpc('billing_day_readiness', {
        p_outlet_id: outletId,
        p_business_date: businessDate,
      })
      if (error) throw error
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new TypeError('Billing readiness returned no structured result.')
      }
      return data as unknown as Awaited<ReturnType<BillingCommandAdapter['readiness']>>
    },
  }
}
