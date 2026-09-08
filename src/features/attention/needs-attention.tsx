import { ChevronRight, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { Card } from '@/components/ui/card'
import { Shimmer } from '@/components/ui/loading'
import { visibleSurfaces, type Surface } from '@/gates/registry'
import { useSession } from '@/session/context'
import { personalHeldRoles, personalNavigationRoles, ROLE_SEGMENTS } from '@/session/session'
import { ATTENTION_SOURCES } from './sources'

export function NeedsAttention() {
  const session = useSession()
  const seen = new Set<string>()
  const pages = visibleSurfaces(
    personalNavigationRoles(session),
    session.mode,
    personalHeldRoles(session),
  ).filter((page) => {
    const source = page.nav?.attention
    if (!source || seen.has(source)) return false
    seen.add(source)
    return true
  })
  const base = `${session.mode === 'demo' ? '/demo' : ''}/${ROLE_SEGMENTS[session.role ?? 'franchise_admin']}`
  return (
    <Card className="space-y-2 !p-3">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <TriangleAlert size={17} aria-hidden className="text-warning" />
        Needs attention
      </h2>
      <ul className="peer space-y-1 empty:hidden">
        {pages.map((page) => (
          <AttentionPage key={page.id} page={page} base={base} />
        ))}
      </ul>
      <p className="text-sm text-content-muted peer-has-[li]:hidden">Nothing waiting</p>
    </Card>
  )
}

function AttentionPage({ page, base }: { page: Surface; base: string }) {
  const useSource = ATTENTION_SOURCES[page.nav!.attention!]
  const attention = useSource()
  if (attention === null)
    return (
      <li aria-label={`Loading ${page.nav?.label} attention`}>
        <Shimmer className="h-11 w-full" />
      </li>
    )
  if (attention.count === 0) return null
  const Icon = page.nav!.icon
  return (
    <li>
      <Link
        to={page.path ? `${base}/${page.path}` : base}
        className="flex min-h-11 items-center gap-3 rounded-lg bg-surface-raised px-3 py-2 text-sm focus-visible:focus-ring"
        data-testid={`overview-attention-${page.nav!.attention}`}
      >
        <span className="rounded-lg bg-primary/10 p-1.5 text-accent-text">
          <Icon size={17} aria-hidden className="shrink-0" />
        </span>
        <span className="flex-1">
          {attention.summaryLabel ?? `${page.nav!.label}: ${attention.label}`}
        </span>
        <ChevronRight size={16} aria-hidden />
      </Link>
    </li>
  )
}
