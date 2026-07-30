import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { InstallPromptContext, type InstallMode } from './install-prompt-context'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isRunningAsInstalledApp() {
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean
  }

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    navigatorWithStandalone.standalone === true
  )
}

function isIosSafari() {
  const userAgent = navigator.userAgent
  const isIos =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isSafari = /Safari/.test(userAgent)
  const isAnotherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)

  return isIos && isSafari && !isAnotherIosBrowser
}

export function InstallPromptProvider({ children }: { children: ReactNode }) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(isRunningAsInstalledApp)

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }

    function handleAppInstalled() {
      setIsInstalled(true)
      setInstallPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const requestNativeInstall = useCallback(async () => {
    const capturedPrompt = installPrompt
    if (!capturedPrompt) return

    try {
      await capturedPrompt.prompt()
      await capturedPrompt.userChoice
    } catch {
      // Browsers own this prompt; a rejected request should simply consume it.
    } finally {
      setInstallPrompt((currentPrompt) => (currentPrompt === capturedPrompt ? null : currentPrompt))
    }
  }, [installPrompt])

  const mode: InstallMode = isInstalled
    ? null
    : installPrompt
      ? 'native'
      : isIosSafari()
        ? 'ios'
        : null

  const value = useMemo(() => ({ mode, requestNativeInstall }), [mode, requestNativeInstall])

  return <InstallPromptContext.Provider value={value}>{children}</InstallPromptContext.Provider>
}
