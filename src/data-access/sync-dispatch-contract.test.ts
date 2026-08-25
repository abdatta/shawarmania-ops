import { describe, expect, it } from 'vitest'

import {
  reconnectWorkflowDispatch,
  syncWorkflowDispatch,
} from '../../supabase/functions/_shared/sync-dispatch'

describe('the owner reader-dispatch contract', () => {
  it('sends Swiggy Read now to its dedicated writer, scoped to the requested outlet', () => {
    expect(syncWorkflowDispatch('swiggy', 'outlet-swiggy', false)).toEqual({
      workflowEnvName: 'AGGREGATOR_SWIGGY_SYNC_WORKFLOW',
      fallbackWorkflow: 'swiggy-daily.yml',
      inputs: {
        outlet_id: 'outlet-swiggy',
        rehearse: 'false',
        write: 'true',
      },
    })
  })

  it('keeps a Swiggy rehearsal read-only', () => {
    expect(syncWorkflowDispatch('swiggy', 'outlet-swiggy', true).inputs).toEqual({
      outlet_id: 'outlet-swiggy',
      rehearse: 'true',
      write: 'false',
    })
  })

  it('preserves Zomato’s existing generic workflow and channel input', () => {
    expect(syncWorkflowDispatch('zomato', 'outlet-zomato', false)).toEqual({
      workflowEnvName: 'AGGREGATOR_SYNC_WORKFLOW',
      fallbackWorkflow: 'sync.yml',
      inputs: {
        channel: 'zomato',
        outlet_id: 'outlet-zomato',
        mode: 'sync',
        rehearse: 'false',
      },
    })
  })

  it('repairs a missing Swiggy session through only its login workflow', () => {
    expect(reconnectWorkflowDispatch('full_login', true, 'outlet-swiggy', false)).toEqual({
      workflowEnvName: 'AGGREGATOR_RECONNECT_WORKFLOW',
      fallbackWorkflow: 'login.yml',
      inputs: {
        channel: 'swiggy',
        outlet_id: 'outlet-swiggy',
        mode: 'reconnect',
        rehearse: 'false',
      },
    })
  })
})
