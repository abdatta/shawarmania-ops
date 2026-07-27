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
  })

  it('stands down outside the scope, whatever the environment holds', () => {
    // Deliberately does NOT assert a particular failure outside demo scope.
    // The original version asserted the missing-env error, which only held on
    // a machine with no .env — so setting one up to run the app locally turned
    // this suite red. The property under test is the tripwire, not the config:
    // outside the scope, demo mode is never the reason anything fails.
    enterDemoScope()
    exitDemoScope()

    let thrown: unknown
    try {
      getSupabaseClient()
    } catch (cause) {
      thrown = cause
    }

    if (thrown !== undefined) {
      // Configured badly or not at all: it may refuse, but never as "demo".
      expect(String(thrown)).not.toMatch(/Demo mode is active/)
      expect(String(thrown)).toMatch(/VITE_SUPABASE_URL/)
    }
  })
})
