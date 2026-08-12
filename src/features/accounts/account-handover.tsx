import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { QrCode } from '@/components/ui/qr-code'
import type { AccountHandover } from '@/data-access/adapters'
import { activationLink } from '@/lib/activation-link'

export interface AccountHandoverProps {
  handover: AccountHandover
  /** The recipient's presentation name, for the human-facing handover only. */
  name: string
  /** The newly issued link supersedes an earlier link of the same purpose. */
  replacement?: boolean | undefined
  /** A defensive status warning when the recipient became inactive meanwhile. */
  inactive?: boolean | undefined
  /** The parent owns the once-only panel state and may dismiss it. */
  onDismiss?: () => void
}

function HandoverCopyButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    const clipboard = window.navigator.clipboard
    if (!clipboard) {
      setCopied(false)
      return
    }

    try {
      await clipboard.writeText(link)
      setCopied(true)
    } catch {
      // Clipboard access can be unavailable on an ordinary HTTP tablet. The
      // visible link remains selectable, so do not imply it was copied.
      setCopied(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="phone" onClick={() => void copyLink()}>
        {copied ? 'Copied' : 'Copy link'}
      </Button>
      <p aria-live="polite" className="text-sm text-content-muted">
        {copied ? 'Link copied.' : null}
      </p>
    </div>
  )
}

/**
 * One concise, purpose-aware account handover. The link carries the bearer
 * code; the code is intentionally never repeated as a second thing to copy or
 * dictate, and identity remains outside the URL.
 */
export function AccountHandoverPanel({
  handover,
  name,
  replacement = false,
  inactive = false,
  onDismiss,
}: AccountHandoverProps) {
  const isReset = handover.purpose === 'password_reset'
  const heading = isReset ? 'Reset password' : 'Set up account'
  const purpose = isReset ? 'password-reset' : 'set-up'
  const link = activationLink(handover.code)
  const qrTitle = `${heading} link for ${name}`

  return (
    <section
      aria-labelledby="account-handover-heading"
      data-testid="account-handover"
      className="mb-4 rounded-xl border border-border bg-surface-raised p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h2 id="account-handover-heading" className="text-lg font-bold text-content">
          {heading}
        </h2>
        <p className="text-sm text-content-muted">
          For <span className="font-semibold text-content">{name}</span>
        </p>
        <p className="break-all text-sm text-content-muted">
          Username:{' '}
          <strong data-testid="account-handover-username" className="font-bold text-content">
            {handover.username}
          </strong>{' '}
          — check this before handing over the link.
        </p>
      </div>

      {isReset && (
        <p className="mt-3 rounded-lg border border-warning bg-surface p-3 text-sm text-content">
          Using this link replaces the password and ends other personal sessions.
        </p>
      )}

      {replacement && (
        <p
          data-testid="account-handover-replacement"
          className="mt-3 rounded-lg border border-warning bg-surface p-3 text-sm text-content"
        >
          This replaces the earlier {purpose} link. The earlier link no longer works.
        </p>
      )}

      {inactive && (
        <p
          data-testid="account-handover-inactive"
          className="mt-3 rounded-lg border border-warning bg-surface p-3 text-sm font-semibold text-content"
        >
          This account is deactivated. Reactivate it before issuing a link.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <QrCode
          value={link}
          title={qrTitle}
          className="h-48 w-48 shrink-0 self-center rounded-lg sm:self-start"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <HandoverCopyButton link={link} />
          <p
            data-testid="account-handover-link"
            className="rounded-lg border border-border bg-surface p-3 font-mono text-xs break-all text-content"
          >
            {link}
          </p>
          {onDismiss && (
            <Button variant="ghost" size="phone" onClick={onDismiss}>
              Done
            </Button>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-content-muted">
        Shown once · works once · expires{' '}
        <time dateTime={handover.expiresAt}>
          {new Date(handover.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
        </time>
      </p>
    </section>
  )
}
