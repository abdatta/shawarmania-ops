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
}

export function PageHeader({ title, subtitle, backTo, action }: PageHeaderProps) {
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        {backTo && (
          <Link
            to={backTo}
            aria-label="Back"
            className={buttonVariants({ variant: 'ghost', size: 'phone' })}
          >
            <ArrowLeft aria-hidden size={18} />
          </Link>
        )}
        <div>
          <h1 className="text-xl font-bold text-content">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-content-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </header>
  )
}
