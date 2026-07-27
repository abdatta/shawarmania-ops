import { createContext, useContext } from 'react'

import type { Session } from './session'

/**
 * Provided by the demo session provider today and by the real session
 * provider when auth-and-roles (#4) lands. Features never construct a
 * session; they read this context.
 */
export const SessionContext = createContext<Session | undefined>(undefined)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) {
    throw new Error('useSession called outside a session provider — wrap the tree in one.')
  }
  return session
}
