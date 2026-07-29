import { personaFixtures } from '@/data-access/mock/fixtures/personas'
import { deriveSessionScope, type Role, type Session } from '@/session/session'

/**
 * A demo session for one persona, built the way `DemoRoot` builds it.
 *
 * One helper rather than the copy in every component test it used to be:
 * since multi-outlet-people a session's authority is its assignments plus two
 * values derived from them, and fourteen hand-rolled copies of that derivation
 * are fourteen chances for a test to assert against a session shape the app
 * never produces.
 */
export function demoSessionFor(role: Role): Session {
  const persona = personaFixtures[role]
  return {
    mode: 'demo',
    userId: persona.profile.id,
    assignments: persona.assignments,
    ...deriveSessionScope(persona.assignments),
    displayName: persona.profile.full_name,
    persona,
  }
}
