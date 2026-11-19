import { useSession } from '@/session/context'

import { campaignGreetingName } from '../../../shared/campaign-message'

/**
 * The name the bubble previews a greeting with: **the first name of whoever is
 * signed in** [owner, 2026-11-18].
 *
 * It was an invented customer's name, which read as a real person in the real
 * app. The owner or their partner reads the preview as the message sent to
 * themselves, which is the question a preview answers, and every account has a
 * name. It is cleaned exactly as a customer's saved name is, so the preview
 * greets the way a send would.
 *
 * Null only for an account whose name leaves nothing to greet with; the bubble
 * then shows the message as a customer with no saved name gets it.
 */
export function usePreviewName(): string | null {
  const { displayName } = useSession()
  return campaignGreetingName(displayName.trim().split(/\s+/)[0])
}
