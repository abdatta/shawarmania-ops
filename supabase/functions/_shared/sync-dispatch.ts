/**
 * The reader workflow and its inputs are a single contract. Keeping that
 * choice pure makes it possible to pin the two portal-specific dispatches
 * without booting an Edge Function or contacting GitHub.
 */
export type SyncDispatchChannel = 'zomato' | 'hyperpure' | 'swiggy'

export interface SyncWorkflowDispatch {
  workflowEnvName: string
  fallbackWorkflow: string
  inputs: Record<string, string>
}

export type SyncRequestMode = 'sync' | 'reconnect'

/**
 * The action a request names, or null for one this function does not offer.
 *
 * Absent means `sync`, which every existing caller relies on. Anything else is
 * refused rather than read as a sync: the Delivery page once sent `accept`, and
 * quietly running a read in its place hid for two months that accepting a
 * disputed week did nothing (an-accepted-week-is-written).
 */
export function readSyncMode(value: unknown): SyncRequestMode | null {
  if (value === undefined || value === null || value === 'sync') return 'sync'
  if (value === 'reconnect') return 'reconnect'
  return null
}

export function reconnectWorkflowDispatch(
  rung: 'capture_only' | 'full_login',
  swiggyReconnect: boolean,
  outletId: string,
  rehearse: boolean,
): SyncWorkflowDispatch {
  if (rung === 'capture_only') {
    return {
      workflowEnvName: 'AGGREGATOR_CAPTURE_WORKFLOW',
      fallbackWorkflow: 'capture-hyperpure.yml',
      inputs: {
        channel: 'hyperpure',
        outlet_id: outletId,
        mode: 'reconnect',
        rehearse: rehearse ? 'true' : 'false',
      },
    }
  }

  return {
    workflowEnvName: 'AGGREGATOR_RECONNECT_WORKFLOW',
    fallbackWorkflow: 'login.yml',
    inputs: {
      channel: swiggyReconnect ? 'swiggy' : 'zomato',
      outlet_id: outletId,
      mode: 'reconnect',
      rehearse: rehearse ? 'true' : 'false',
    },
  }
}

export function syncWorkflowDispatch(
  channel: SyncDispatchChannel,
  outletId: string,
  rehearse: boolean,
): SyncWorkflowDispatch {
  if (channel === 'swiggy') {
    return {
      workflowEnvName: 'AGGREGATOR_SWIGGY_SYNC_WORKFLOW',
      fallbackWorkflow: 'swiggy-daily.yml',
      inputs: {
        outlet_id: outletId,
        rehearse: rehearse ? 'true' : 'false',
        // Manual workflow dispatches are deliberately read-only by default.
        // A Read now request is production work, unless explicitly rehearsed.
        write: rehearse ? 'false' : 'true',
      },
    }
  }

  // Hyperpure's ordinary reader continues to run through the Zomato workflow;
  // its independent session only matters to the reconnect ladder.
  return {
    workflowEnvName: 'AGGREGATOR_SYNC_WORKFLOW',
    fallbackWorkflow: 'sync.yml',
    inputs: {
      channel: 'zomato',
      outlet_id: outletId,
      mode: 'sync',
      rehearse: rehearse ? 'true' : 'false',
    },
  }
}
