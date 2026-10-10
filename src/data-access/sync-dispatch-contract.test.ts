import { describe, expect, it } from 'vitest'

import {
  readSyncMode,
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

describe('the actions a sync request may name', () => {
  it('reads an absent mode as a sync, as every existing caller relies on', () => {
    expect(readSyncMode(undefined)).toBe('sync')
    expect(readSyncMode('sync')).toBe('sync')
    expect(readSyncMode('reconnect')).toBe('reconnect')
  })

  it('refuses anything else rather than running a read in its place', () => {
    // `accept` is what the Delivery page used to send; reading it as a sync is
    // how a dead Accept button went unnoticed.
    expect(readSyncMode('accept')).toBeNull()
    expect(readSyncMode('SYNC')).toBeNull()
    expect(readSyncMode(1)).toBeNull()
  })
})
