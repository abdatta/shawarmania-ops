import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { buttonVariants } from '@/components/ui/button-variants'

interface PageHeaderProps {
  title: string
  subtitle?: string | undefined
  /** Where the back affordance leads; omitted, there is no back affordance. */
  backTo?: string | undefined
  /** Primary action slot — a button or link, already styled. */
  action?: ReactNode
  /**
   * Which outlet this surface is about, for somebody who may see more than
   * one. Empty for nearly everybody, because nearly everybody works at one —
   * see `useOutletScope`. It sits beside the title rather than in the shell
   * chrome on purpose: the choice belongs to this screen and confers nothing.
   */
  scope?: ReactNode
}

export function PageHeader({ title, subtitle, backTo, action, scope }: PageHeaderProps) {
  return (
    // Wraps rather than squeezing. An outlet selector is as wide as an outlet's
    // name, and beside it on a 390 px phone the title column collapsed to a few
    // characters and wrapped its subtitle down the screen. Since
    // owner-reaches-every-outlet the owner meets that selector on every
    // outlet-scoped surface, so it is now the common case rather than the
    // two-outlet manager's. Nothing changes where there is room for one line.
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        {backTo && (
          <Link
            to={backTo}
            aria-label="Back"
            className={buttonVariants({ variant: 'ghost', size: 'phone' })}
          >
            <ArrowLeft aria-hidden size={18} />
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-content">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-content-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="flex min-w-0 max-w-full shrink-0 items-center gap-2">
        {scope}
        {action}
      </div>
    </header>
  )
}
