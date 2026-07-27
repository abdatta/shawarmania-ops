import { afterEach, describe, expect, it } from 'vitest'

import { enterDemoScope, exitDemoScope, isDemoScopeActive } from './demo-scope'
import { getSupabaseClient } from './supabase'

describe('demo scope tripwire', () => {
  afterEach(() => {
    // Drain whatever a failing test left behind.
    while (isDemoScopeActive()) exitDemoScope()
  })

  it('marks and clears the scope, balanced under nesting', () => {
    expect(isDemoScopeActive()).toBe(false)
    enterDemoScope()
    expect(isDemoScopeActive()).toBe(true)
    enterDemoScope()
    exitDemoScope()
    // Still active: two enters need two exits (StrictMode overlap).
    expect(isDemoScopeActive()).toBe(true)
    exitDemoScope()
    expect(isDemoScopeActive()).toBe(false)
  })

  it('does not go negative on an unbalanced exit', () => {
    exitDemoScope()
    expect(isDemoScopeActive()).toBe(false)
    enterDemoScope()
    expect(isDemoScopeActive()).toBe(true)
    exitDemoScope()
  })

  it('getSupabaseClient throws loudly while the scope is active', () => {
    enterDemoScope()
    expect(() => getSupabaseClient()).toThrow(/Demo mode is active/)
    exitDemoScope()
    // Outside the scope the tripwire stands down — with no env configured in
    // tests the client still refuses, but for the ordinary reason.
    expect(() => getSupabaseClient()).toThrow(/VITE_SUPABASE_URL/)
  })
})
