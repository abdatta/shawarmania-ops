import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { Chip } from '@/components/ui/chip'

import type { CampaignShownState } from './words'

/** A figure and what it is, as the fixed-cost and outlet pages draw theirs. */
export function Tile({
  caption,
  children,
  testId,
}: {
  caption: ReactNode
  children: ReactNode
  testId?: string
}) {
  return (
    <div className="rounded-lg bg-surface-raised px-3 py-2" data-testid={testId}>
      <dt className="text-xs text-content-muted">{caption}</dt>
      <dd className="text-base font-semibold tabular-nums text-content">{children}</dd>
    </div>
  )
}

export function Section({
  id,
  title,
  actions,
  children,
}: {
  id: string
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="flex min-h-10 items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold text-content-muted">
          {title}
        </h2>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/**
 * A campaign's state, as a chip. Sending is the one live state, so it alone
 * carries a dot; every state is also its own word.
 */
export function StateChip({ state }: { state: CampaignShownState }) {
  if (state === 'sending') {
    return (
      <Chip tone="good" data-testid="campaign-state">
        <span aria-hidden className="size-1.5 rounded-full bg-success" />
        sending
      </Chip>
    )
  }
  if (state === 'done') {
    return (
      <Chip tone="good" icon={Check} data-testid="campaign-state">
        done
      </Chip>
    )
  }
  return (
    <Chip
      tone={state === 'paused' ? 'warn' : state === 'stopped' ? 'bad' : 'neutral'}
      data-testid="campaign-state"
    >
      {state}
    </Chip>
  )
}
