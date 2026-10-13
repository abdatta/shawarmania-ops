import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useChangeGateSnapshot } from '@/change-gates/context'
import { activeCodes, buildCode } from '@/change-gates/snapshot'
import { formatDateTime } from '@/domain'
import { cn } from '@/lib/cn'
import { BUILD_SHA, BUILD_TIME } from '@/pwa/build-info'

/**
 * The running build, visible on the device (a-release-can-be-switched-off, D16).
 *
 * **Where it shows** (owner, 2026-10-12): in the account menu, and at the foot of
 * every screen that has no account menu — the signed-out screens, the counter
 * and its setup and shift-start screens, the kitchen — and of the Change gates
 * pages, which are where a reader wants to see it.
 *
 * **It reads as it always has, and a tap copies it** (owner, 2026-10-13): the
 * build, then when it was built. Tapping it copies that line with the change
 * gates it runs added to the build — `Build c1f19c32·DT-KR · 13 Oct 2026, 9:05 pm`
 * — so whoever reports a problem hands over the build, its gates and its age in
 * one paste. A pop-up showing the code first was built and dropped the same day:
 * one tap is the whole job. Where the clipboard is refused (plain http on a
 * phone) the full line is shown and selected instead, and nothing claims a copy.
 */
export function BuildVersion({
  className,
  testId = 'build-version',
}: {
  className?: string
  /** The account menu's copy has its own, so a page holds one `build-version`. */
  testId?: string
}) {
  const code = buildCode(BUILD_SHA, activeCodes(useChangeGateSnapshot()))
  const [shown, setShown] = useState<'words' | 'copied' | 'selected'>('words')
  const line = useRef<HTMLSpanElement>(null)
  let builtAt = BUILD_TIME
  try {
    builtAt = formatDateTime(BUILD_TIME)
  } catch {
    // A malformed injected timestamp must never break the shell.
  }
  const text = `Build ${code} · ${builtAt}`

  useEffect(() => {
    if (shown === 'words') return
    if (shown === 'selected') {
      const selection = window.getSelection()
      if (line.current && selection) selection.selectAllChildren(line.current)
    }
    const back = window.setTimeout(() => setShown('words'), shown === 'copied' ? 2000 : 8000)
    return () => window.clearTimeout(back)
  }, [shown])

  async function copy() {
    const clipboard = window.navigator.clipboard as Clipboard | undefined
    if (clipboard) {
      try {
        await clipboard.writeText(text)
        setShown('copied')
        return
      } catch {
        // Falls through to selecting it.
      }
    }
    setShown('selected')
  }

  return (
    <div className={cn('text-xs text-content-muted whitespace-nowrap', className)}>
      <button
        type="button"
        onClick={() => void copy()}
        data-testid={testId}
        data-build-code={code}
        title={`Copy: ${text}`}
        aria-label={`Copy the build: ${text}`}
        className="rounded underline decoration-dotted decoration-border underline-offset-4 hover:text-content focus-visible:focus-ring"
      >
        {shown === 'copied' ? (
          <span className="inline-flex items-center gap-1 text-content">
            <Check aria-hidden size={12} />
            Copied
          </span>
        ) : shown === 'selected' ? (
          <span ref={line} className="select-all text-content">
            {text}
          </span>
        ) : (
          <>
            Build <span data-numeric="">{BUILD_SHA}</span> · {builtAt}
          </>
        )}
      </button>
      <span aria-live="polite" className="sr-only">
        {shown === 'copied' ? 'Build copied.' : ''}
      </span>
    </div>
  )
}
