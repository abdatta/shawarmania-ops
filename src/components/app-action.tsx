import { InstallAppButton } from '@/components/install-app-button'
import { UpdateAppButton } from '@/components/update-app-button'
import { useInstallPrompt } from '@/pwa/install-prompt-context'

/**
 * The one app-owned action in the header, and which of the two it is.
 *
 * Install wins. Somebody who has not installed the app yet gets more from
 * installing it than from taking a build a few minutes earlier, and the update
 * is not lost by waiting: it applies by itself the moment the page is free.
 *
 * The precedence lives here, in one branch, rather than in an update action
 * that checks whether the install action would have rendered. Two components
 * each deciding to stay quiet is a rule that drifts the first time one of them
 * is edited alone (design D9).
 */
export function AppAction() {
  const { mode } = useInstallPrompt()

  if (mode) return <InstallAppButton />

  return <UpdateAppButton />
}
