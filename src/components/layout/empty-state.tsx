import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: LucideIcon
  /** One sentence saying what to do next — never "No data" (docs/DESIGN_SYSTEM.md). */
  title: string
  action?: ReactNode
}

export function EmptyState({ icon: Icon, title, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
      {Icon && <Icon aria-hidden size={28} className="text-content-muted" />}
      <p className="max-w-sm text-sm text-content-muted">{title}</p>
      {action}
    </div>
  )
}
