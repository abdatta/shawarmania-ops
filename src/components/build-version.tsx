import { Check, Copy } from 'lucide-react'
import { useRef, useState } from 'react'

import { useChangeGateSnapshot } from '@/change-gates/context'
import { activeCodes, buildCode } from '@/change-gates/snapshot'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
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
 * **It reads as it always has** (owner, 2026-10-13): the build, then when it was
 * built. While any change gate is on for the page it becomes a button, and opens
 * the build code — `c1f19c32·DT-KR` — with a Copy, so whoever is reporting a
 * problem can hand over the build and the changes it runs in one line.
 */
export function BuildVersion({
  className,
  testId = 'build-version',
}: {
  className?: string
  /** The account menu's copy has its own, so a page holds one `build-version`. */
  testId?: string
}) {
  const codes = activeCodes(useChangeGateSnapshot())
  const [open, setOpen] = useState(false)
  let builtAt = BUILD_TIME
  try {
    builtAt = formatDateTime(BUILD_TIME)
  } catch {
    // A malformed injected timestamp must never break the shell.
  }

  const words = (
    <>
      Build <span data-numeric="">{BUILD_SHA}</span> · {builtAt}
    </>
  )

  if (codes.length === 0) {
    return (
      <p
        className={cn('text-xs text-content-muted whitespace-nowrap', className)}
        data-testid={testId}
      >
        {words}
      </p>
    )
  }

  // A div, not a paragraph: the dialog below cannot sit inside a <p>.
  return (
    <div className={cn('text-xs text-content-muted whitespace-nowrap', className)}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={testId}
        aria-haspopup="dialog"
        aria-label={`Build ${BUILD_SHA}, with ${codes.length} change ${
          codes.length === 1 ? 'gate' : 'gates'
        } on. Show the build code.`}
        className="rounded underline decoration-dotted decoration-border underline-offset-4 hover:text-content focus-visible:focus-ring"
      >
        {words}
      </button>
      <BuildCodeDialog
        open={open}
        code={buildCode(BUILD_SHA, codes)}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}

/**
 * The build code and a way to copy it. Where the clipboard is refused — it is,
 * over plain http on a phone — the code is selected instead and nothing claims a
 * copy, as the outlet page's public-menu address does.
 */
function BuildCodeDialog({
  open,
  code,
  onClose,
}: {
  open: boolean
  code: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const shown = useRef<HTMLElement>(null)

  async function copy() {
    const clipboard = window.navigator.clipboard as Clipboard | undefined
    if (clipboard) {
      try {
        await clipboard.writeText(code)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
        return
      } catch {
        // Falls through to selecting it.
      }
    }
    const selection = window.getSelection()
    if (shown.current && selection) selection.selectAllChildren(shown.current)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-label="Build code"
      className="m-auto w-full max-w-sm rounded-xl p-4"
    >
      <h2 className="text-base font-semibold text-content">Build code</h2>
      <p className="mt-2 text-sm text-content-muted">
        The build and the change gates it is running. Send it with any problem you report.
      </p>
      <code
        ref={shown}
        className="mt-3 block break-all rounded-lg bg-surface-raised px-3 py-2 text-base font-semibold text-content"
        data-testid="build-code"
      >
        {code}
      </code>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" size="phone" onClick={onClose}>
          Close
        </Button>
        <Button
          type="button"
          variant="primary"
          size="phone"
          onClick={() => void copy()}
          aria-label={copied ? 'Build code copied' : 'Copy build code'}
          data-testid="copy-build-code"
        >
          {copied ? <Check aria-hidden size={16} /> : <Copy aria-hidden size={16} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Build code copied.' : ''}
      </span>
    </Modal>
  )
}
