import { useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router'

import { AdaptersContext } from '@/data-access/adapters-context'
import { enterDemoScope, exitDemoScope } from '@/data-access/demo-scope'
import { createMockAdapters, personaFixtures } from '@/data-access/mock'
import { NotFound } from '@/routes/not-found'
import { CounterShell } from '@/shell/counter-shell'
import { PhoneShell } from '@/shell/phone-shell'
import { SessionContext } from '@/session/context'
import { roleFromSegment, type Session } from '@/session/session'

import { DemoBanner } from './demo-banner'

/**
 * The demo branch's provider stack (design D1/D8). The role comes from the
 * URL — /demo/:roleSegment/* — so a deep link or a reload reconstructs the
 * whole session with no stored state. Only mock adapters are constructed
 * here; this module must never import the Supabase client or the real
 * adapters (eslint enforces it).
 */
export function DemoRoot() {
  const { roleSegment } = useParams()
  const role = roleFromSegment(roleSegment)

  // Mark the demo scope during render, not in an effect: children render
  // (and run their effects) before a parent's effect, and the tripwire must
  // already be armed when they do. The lazy ref-init pattern keeps enter/exit
  // balanced under StrictMode's double-invoked renders; the effect re-enters
  // after StrictMode's simulated unmount so the pairing stays exact.
  const scoped = useRef<boolean | null>(null)
  if (scoped.current == null) {
    enterDemoScope()
    scoped.current = true
  }
  useEffect(() => {
    const wasScoped = scoped.current === true
    if (!wasScoped) {
      enterDemoScope()
      scoped.current = true
    }
    return () => {
      exitDemoScope()
      scoped.current = false
    }
  }, [])

  const session = useMemo<Session | undefined>(() => {
    if (!role) return undefined
    const persona = personaFixtures[role]
    return {
      mode: 'demo',
      userId: persona.profile.id,
      role,
      outletId: persona.profile.outlet_id,
      displayName: persona.profile.full_name,
      persona,
    }
  }, [role])

  const adapters = useMemo(() => createMockAdapters(), [])

  if (!session) return <NotFound />

  const Shell = session.role === 'biller' ? CounterShell : PhoneShell

  return (
    <SessionContext.Provider value={session}>
      <AdaptersContext.Provider value={adapters}>
        <Shell banner={<DemoBanner />} />
      </AdaptersContext.Provider>
    </SessionContext.Provider>
  )
}
