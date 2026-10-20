import { ChevronRight, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { Card } from '@/components/ui/card'
import { Shimmer } from '@/components/ui/loading'
import { visibleSurfaces, type Surface } from '@/gates/registry'
import { useSession } from '@/session/context'
import { personalHeldRoles, personalNavigationRoles, ROLE_SEGMENTS } from '@/session/session'
import { ATTENTION_SOURCES } from './sources'
import { TONE_ICON, TONE_SURFACE } from './tone'

export function NeedsAttention() {
  const session = useSession()
  const seen = new Set<string>()
  const pages = visibleSurfaces(
    personalNavigationRoles(session),
    session.mode,
    personalHeldRoles(session),
  )
    .filter((page) => {
      const source = page.nav?.attention
      if (!source || seen.has(source)) return false
      seen.add(source)
      return true
    })
    // Money owed goes first, whatever the navigation's order (owner, 2026-10-20).
    .sort((a, b) => Number(pinned(b)) - Number(pinned(a)))
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

/** Sources that are money owed: listed before everything that is only waiting. */
const PINNED = new Set(['fixed-costs-unpaid'])

function pinned(page: Surface): boolean {
  return PINNED.has(page.nav?.attention ?? '')
}

/** The row's fill and its icon's, by how loudly the source asks. */
const TONE = {
  plain: { row: 'bg-surface-raised', icon: 'bg-primary/10 text-accent-text' },
  due: { row: `${TONE_SURFACE.due} font-semibold`, icon: TONE_ICON.due },
  late: { row: `${TONE_SURFACE.late} font-semibold`, icon: TONE_ICON.late },
} as const

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
  const tone = TONE[attention.tone ?? 'plain']
  return (
    <li>
      <Link
        to={(attention.path ?? page.path) ? `${base}/${attention.path ?? page.path}` : base}
        className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm focus-visible:focus-ring ${tone.row}`}
        data-testid={`overview-attention-${page.nav!.attention}`}
        data-tone={attention.tone ?? 'plain'}
      >
        <span className={`rounded-lg p-1.5 ${tone.icon}`}>
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
