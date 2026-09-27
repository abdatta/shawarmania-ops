import type { ReactNode } from 'react'

/**
 * The outline that marks a destructive button on the outlet page — Mark closed,
 * Delete outlet, Remove a tablet — laid over the secondary button. Red text and
 * a red edge, not a red fill: visible, and never the loudest thing on the page.
 */
export const DANGER_OUTLINE = 'border-danger text-danger'

/**
 * The label over one group of an outlet's things — Details, Tablets, and the
 * settings that follow them — with that group's actions on the right
 * (outlets-one-at-a-time, owner 2026-09-26).
 *
 * Small and quiet on purpose: the outlet's own name heads the page these sit
 * on, and every group belongs to it. A heading as loud as the outlet's name
 * made Tablets read as a separate thing standing beside the outlet rather than
 * something inside it.
 */
export function OutletSection({
  title,
  id,
  actions,
  children,
  ...rest
}: {
  title: ReactNode
  /** For `aria-labelledby`, so the group is announced by its label. */
  id: string
  actions?: ReactNode
  children: ReactNode
} & { 'data-testid'?: string }) {
  return (
    <section aria-labelledby={id} className="space-y-2" {...rest}>
      <div className="flex min-h-10 items-center justify-between gap-2">
        <h3 id={id} className="text-sm font-semibold text-content-muted">
          {title}
        </h3>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
