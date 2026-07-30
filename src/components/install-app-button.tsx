import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useInstallPrompt } from '@/pwa/install-prompt-context'

const INSTALL_LABEL_DELAY_MS = 3_000
const INSTALL_LABEL_DURATION_MS = 5_000
const INSTALL_LABEL_SEEN_KEY = 'shawarmania-install-label-seen'
const IOS_INSTALL_HINT_ID = 'ios-install-hint'

function hasSeenInstallLabel() {
  try {
    return sessionStorage.getItem(INSTALL_LABEL_SEEN_KEY) === 'true'
  } catch {
    return false
  }
}

function rememberInstallLabel() {
  try {
    sessionStorage.setItem(INSTALL_LABEL_SEEN_KEY, 'true')
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches)

    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return prefersReducedMotion
}

export function InstallAppButton() {
  const { mode, requestNativeInstall } = useInstallPrompt()
  const prefersReducedMotion = usePrefersReducedMotion()
  const [isLabelExpanded, setIsLabelExpanded] = useState(false)
  const [isIosHintOpen, setIsIosHintOpen] = useState(false)

  useEffect(() => {
    if (!mode || prefersReducedMotion || hasSeenInstallLabel()) return

    const revealTimer = window.setTimeout(() => {
      rememberInstallLabel()
      setIsLabelExpanded(true)
    }, INSTALL_LABEL_DELAY_MS)
    const hideTimer = window.setTimeout(() => {
      setIsLabelExpanded(false)
    }, INSTALL_LABEL_DELAY_MS + INSTALL_LABEL_DURATION_MS)

    return () => {
      window.clearTimeout(revealTimer)
      window.clearTimeout(hideTimer)
    }
  }, [mode, prefersReducedMotion])

  if (!mode) return null

  const isExpanded = prefersReducedMotion || isLabelExpanded || (mode === 'ios' && isIosHintOpen)

  async function handleInstall() {
    if (mode === 'ios') {
      setIsIosHintOpen((isOpen) => !isOpen)
      setIsLabelExpanded(true)
      return
    }

    setIsIosHintOpen(false)
    setIsLabelExpanded(false)
    await requestNativeInstall()
  }

  return (
    <div className="relative">
      <Button
        aria-controls={mode === 'ios' ? IOS_INSTALL_HINT_ID : undefined}
        aria-expanded={mode === 'ios' ? isIosHintOpen : undefined}
        aria-label="Install Shawarmania Ops as an app"
        className={cn(
          'group min-h-[44px] min-w-[44px] overflow-hidden transition-[width,gap,padding,filter,background-color] duration-300 motion-reduce:transition-none',
          isExpanded
            ? 'w-[96px] gap-2 px-4'
            : 'w-[var(--size-control-phone)] gap-0 px-0 hover:w-[96px] hover:gap-2 hover:px-4 focus-visible:w-[96px] focus-visible:gap-2 focus-visible:px-4',
        )}
        onClick={() => void handleInstall()}
        title="Install Shawarmania Ops as an app"
        type="button"
      >
        <Download aria-hidden="true" className="size-[18px] shrink-0" />
        <span
          className={cn(
            'max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-300 motion-reduce:transition-none group-hover:max-w-14 group-hover:opacity-100 group-focus-visible:max-w-14 group-focus-visible:opacity-100',
            isExpanded && 'max-w-14 opacity-100',
          )}
        >
          Install
        </span>
      </Button>

      {mode === 'ios' && isIosHintOpen ? (
        <p
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-border bg-surface p-3 text-sm leading-snug text-content shadow-lg"
          id={IOS_INSTALL_HINT_ID}
          role="status"
        >
          In Safari, tap Share, then Add to Home Screen. Turn on Open as Web App, then tap Add.
        </p>
      ) : null}
    </div>
  )
}
