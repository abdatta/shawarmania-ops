import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'

import { ThemeToggle } from '@/components/theme-toggle'
import { NavGroupAttentionBadge } from '@/features/attention/group-badge'
import { NavAttentionBadge } from '@/features/attention/nav-badge'
import {
  navTree,
  nodeSurfaces,
  visibleSurfaces,
  type NavGroupId,
  type NavNode,
  type Surface,
} from '@/gates/registry'
import { cn } from '@/lib/cn'
import { useSession } from '@/session/context'
import {
  personalHeldRoles,
  personalNavigationRoles,
  ROLE_SEGMENTS,
  type Role,
} from '@/session/session'

/**
 * The shell for the phone-first roles — Super Admin, Franchise Admin,
 * Employee. Bottom tabs on phone widths (one-handed reach, always-visible
 * state), a left rail on wider screens; both render the same registry-derived
 * entries. Mode-agnostic by design (spec: a uniform session context serves
 * real and demo modes): the demo tree passes its banner through one slot, the
 * real tree passes its account menu through the other, and nothing here
 * branches on mode beyond deriving the role's base path.
 *
 * **Navigation has two levels since #51.** Both rows draw `navTree`, so the bar
 * and the rail cannot disagree about what is a group or what is inside one.
 * They present it differently on purpose: there is vertical room on a rail, so
 * its sections are open by default and hiding things behind a click there would
 * buy nothing, while a phone shows one group at a time in a card above the bar.
 */
export function PhoneShell({
  banner,
  accountMenu,
  appAction,
}: {
  banner?: ReactNode
  accountMenu?: ReactNode
  appAction?: ReactNode
}) {
  const session = useSession()
  // Every role the person can reach, not just the one whose shell they are in:
  // a manager who also grills at the other outlet reaches both sets of surfaces
  // without switching anything (multi-outlet-people, design D6), and the owner
  // reaches the outlet-level surfaces holding no assignment at all
  // (owner-reaches-every-outlet, design D1). What they HOLD still decides which
  // homes are theirs.
  const held = personalHeldRoles(session)
  const items = visibleSurfaces(personalNavigationRoles(session), session.mode, held)
  const home = held[0]

  const baseFor = (role: Role) => {
    const segment = ROLE_SEGMENTS[role]
    return session.mode === 'demo' ? `/demo/${segment}` : `/${segment}`
  }

  /**
   * A navigation entry stays **inside the shell you are in** (design D1a): the
   * owner's Attendance is `/owner/attendance`, not `/admin/attendance`. Every
   * role branch mounts the same surface routes, and the gate resolves a path
   * against the roles the session can reach, so the surface is the same either
   * way — what differs is that one address keeps the reader where they are and
   * the other reads as though they had become somebody else. In demo mode it is
   * not merely cosmetic: the role lives in the URL there, so a link into another
   * role's segment would swap the persona mid-walk. The counter shell has always
   * done it this way; this is the phone shell agreeing with it.
   *
   * A home is the exception, because two of them cannot share one address: an
   * index surface keeps its own role's segment. Only a role the person holds
   * contributes one, so both addresses are always theirs.
   */
  const linkFor = (surface: Surface) => {
    const base = baseFor(surface.path === '' ? surface.role : (home ?? surface.role))
    return surface.path === '' ? base : `${base}/${surface.path}`
  }

  /**
   * Whether an entry stops claiming its own sub-paths: **the most specific
   * navigation entry wins, and only it.**
   *
   * `NavLink` matches by prefix unless told otherwise, which is right for a
   * surface whose sub-paths belong to it — Delivery stays lit on one channel's
   * page, because `ledger/delivery/:channel` is Delivery. It is wrong the
   * moment a sub-path has a navigation entry of its own: `ledger/expenses` is
   * not the Ledger, and lighting both told the reader they were in two places.
   *
   * Derived from the entries themselves rather than declared per surface, so the
   * next nested entry cannot forget to do it.
   */
  const claimedByAChild = (path: string) =>
    path !== '' && items.some((other) => other.path.startsWith(`${path}/`))

  /**
   * The navigation entry this one lives under, if any.
   *
   * **Path nesting is not applied inside a group** (#51): Expenses lives under
   * the Ledger's path and is drawn as its sibling in Finances, because two
   * levels of structure over four entries is one more than the reader needs.
   * What survives is the indent for a nested entry that is *not* grouped, which
   * is what keeps the rail's behaviour for anything outside a group.
   */
  const parentOf = (surface: Surface) =>
    surface.nav?.group
      ? undefined
      : items.find(
          (other) =>
            other.path !== '' && !other.nav?.group && surface.path.startsWith(`${other.path}/`),
        )

  const tree = navTree(items)
  const { openGroup, toggleGroup, groupOfLocation } = useOpenGroup(tree, linkFor)

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-content">
      {banner}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="min-w-0">
          <span className="block font-display text-lg leading-tight tracking-wide text-accent-text">
            Shawarmania Ops
          </span>
          <span className="block truncate text-xs text-content-muted">{session.displayName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {appAction}
          <ThemeToggle />
          {accountMenu}
        </div>
      </header>

      <div className="flex flex-1">
        <Rail
          tree={tree}
          linkFor={linkFor}
          claimedByAChild={claimedByAChild}
          parentOf={parentOf}
          groupOfLocation={groupOfLocation}
        />

        {/*
          The bar's full height **with a group open** — 64px of tabs plus the
          card's own block — reserved whether or not one is, so expanding a
          group does not shift the page under the reader's thumb.
        */}
        <main className="min-w-0 flex-1 px-4 pb-[calc(141px+env(safe-area-inset-bottom))] pt-5 md:pb-6">
          <Outlet />
        </main>
      </div>

      <PhoneBar
        tree={tree}
        linkFor={linkFor}
        claimedByAChild={claimedByAChild}
        openGroup={openGroup}
        groupOfLocation={groupOfLocation}
        toggleGroup={toggleGroup}
      />
    </div>
  )
}

/**
 * Which group the phone bar is showing the children of.
 *
 * Seeded from the address and re-seeded **only when the reader crosses into or
 * out of a group**, so arriving on the Ledger opens Finances and going to
 * Overview closes it, while moving between siblings leaves a group the reader
 * opened by hand open under them. It is deliberately not persisted: the address
 * re-opens the right group on arrival, which is the only case that matters.
 */
function useOpenGroup(tree: NavNode[], linkFor: (surface: Surface) => string) {
  const { pathname } = useLocation()

  // The group holding the entry the reader is standing in. Longest match wins,
  // the same way the bar decides which tab to light.
  let groupOfLocation: NavGroupId | null = null
  let longest = -1
  for (const node of tree) {
    for (const surface of nodeSurfaces(node)) {
      const link = linkFor(surface)
      const inside = pathname === link || pathname.startsWith(`${link}/`)
      if (inside && link.length > longest) {
        longest = link.length
        groupOfLocation = surface.nav?.group ?? null
      }
    }
  }

  const [openGroup, setOpenGroup] = useState<NavGroupId | null>(groupOfLocation)
  const crossed = useRef(groupOfLocation)

  useEffect(() => {
    if (crossed.current === groupOfLocation) return
    crossed.current = groupOfLocation
    setOpenGroup(groupOfLocation)
  }, [groupOfLocation])

  const toggleGroup = (group: NavGroupId) => {
    setOpenGroup((current) => {
      // **A group the reader is inside cannot be closed from in there.** Tapping
      // it would leave them on a Finances page with no sibling row and no way
      // back to one except by tapping again.
      //
      // It is the *closing* that is refused, not the tap. A reader standing on
      // the Ledger with Setup open must be able to get back to their own
      // siblings, and the only control that does it is this one.
      if (current === group) return group === groupOfLocation ? current : null
      return group
    })
  }

  return { openGroup, toggleGroup, groupOfLocation }
}

/** Every badged child of a node, as the sources a group badge sums. */
function sourcesOf(node: NavNode) {
  return nodeSurfaces(node)
    .map((surface) => surface.nav?.attention)
    .filter((source): source is NonNullable<typeof source> => !!source)
}

/**
 * The wide-screen rail.
 *
 * **A group row is an ordinary row** — the same height, weight, casing and lit
 * colour as Overview and Attendance, with a chevron as the only difference,
 * because the difference is only that this row opens rather than goes. Uppercase
 * small-caps section headings were tried and rejected: they made Finances and
 * Setup read as a different *kind* of thing from the entries beside them, which
 * they are not. A group is a peer of Overview, not a heading above it.
 *
 * Sections are open by default and collapsible. There is vertical room here, so
 * hiding things behind a click buys nothing.
 */
function Rail({
  tree,
  linkFor,
  claimedByAChild,
  parentOf,
  groupOfLocation,
}: {
  tree: NavNode[]
  linkFor: (surface: Surface) => string
  claimedByAChild: (path: string) => boolean
  parentOf: (surface: Surface) => Surface | undefined
  groupOfLocation: NavGroupId | null
}) {
  const [collapsed, setCollapsed] = useState<readonly NavGroupId[]>([])

  return (
    <nav
      aria-label="Primary"
      className="hidden border-r border-border p-3 md:flex md:w-48 md:flex-col md:gap-1"
    >
      {tree.map((node) => {
        if (node.kind === 'surface') {
          return (
            <RailLink
              key={node.surface.id}
              surface={node.surface}
              linkFor={linkFor}
              claimedByAChild={claimedByAChild}
              nested={parentOf(node.surface) !== undefined}
            />
          )
        }

        const shut = collapsed.includes(node.group.id)
        const Icon = node.group.icon
        return (
          <div key={node.group.id} className="contents">
            <button
              type="button"
              aria-expanded={!shut}
              onClick={() =>
                setCollapsed((current) =>
                  current.includes(node.group.id)
                    ? current.filter((id) => id !== node.group.id)
                    : [...current, node.group.id],
                )
              }
              className={cn(
                'flex h-[var(--size-control-phone)] items-center gap-2 rounded-lg px-3 text-sm font-semibold',
                'focus-visible:focus-ring',
                'hover:bg-surface-raised',
                // Lit whenever the reader is inside it, open or shut. The lit
                // child keeps the raised background, so the two say different
                // things: the group says which part of the app the reader is
                // in, the child says which screen.
                groupOfLocation === node.group.id
                  ? 'text-accent-text'
                  : 'text-content-muted hover:text-content',
              )}
              data-testid={`nav-group-${node.group.id}`}
            >
              <Icon aria-hidden size={18} />
              {node.group.label}
              <span className="ml-auto flex items-center gap-1">
                {/* The sum only while the parts are out of sight. */}
                {shut && (
                  <NavGroupAttentionBadge group={node.group.label} sources={sourcesOf(node)} />
                )}
                {shut ? (
                  <ChevronRight aria-hidden size={14} />
                ) : (
                  <ChevronDown aria-hidden size={14} />
                )}
              </span>
            </button>
            {!shut &&
              node.children.map((surface) => (
                <RailLink
                  key={surface.id}
                  surface={surface}
                  linkFor={linkFor}
                  claimedByAChild={claimedByAChild}
                  nested
                />
              ))}
          </div>
        )
      })}
    </nav>
  )
}

function RailLink({
  surface,
  linkFor,
  claimedByAChild,
  nested,
}: {
  surface: Surface
  linkFor: (surface: Surface) => string
  claimedByAChild: (path: string) => boolean
  nested: boolean
}) {
  const Icon = surface.nav?.icon
  return (
    <NavLink
      to={linkFor(surface)}
      end={surface.path === '' || claimedByAChild(surface.path)}
      className={({ isActive }) =>
        cn(
          'flex h-[var(--size-control-phone)] items-center gap-2 rounded-lg px-3 text-sm font-semibold',
          'focus-visible:focus-ring',
          // Indented, and hung off a rule that runs down beside it. Two signals
          // rather than one, because an indent alone reads as a rendering
          // accident at this scale.
          nested && 'ml-3 border-l border-border pl-4',
          isActive
            ? 'bg-surface-raised text-accent-text'
            : 'text-content-muted hover:bg-surface-raised hover:text-content',
        )
      }
    >
      {Icon && <Icon aria-hidden size={18} />}
      {surface.nav?.label}
      {surface.nav?.attention && (
        // At the end of a rail row, where there is width for it.
        <span className="ml-auto">
          <NavAttentionBadge
            key={surface.nav.attention}
            source={surface.nav.attention}
            surface={surface.nav.label}
          />
        </span>
      )}
    </NavLink>
  )
}

/**
 * The phone's bottom bar, and the card a group opens above it.
 *
 * **Two full-width rows butted together was built first and rejected on sight**
 * — two bars of equal weight, squared off against each other, with nothing
 * saying which was in charge. **A pill or segmented control for the second row
 * was rejected too**: it has to read like the navigation bar, not like a filter.
 * What survived is a card of the same tabs one size smaller, and that single
 * step is the whole of how the two rows are ranked.
 *
 * The card is drawn **inside the bar's own block**. It floated free at first and
 * the sliver of page showing between it and the bar read as a mistake — half a
 * line of somebody's name, scrolling behind the navigation. The bar owns that
 * gap.
 */
function PhoneBar({
  tree,
  linkFor,
  claimedByAChild,
  openGroup,
  groupOfLocation,
  toggleGroup,
}: {
  tree: NavNode[]
  linkFor: (surface: Surface) => string
  claimedByAChild: (path: string) => boolean
  openGroup: NavGroupId | null
  groupOfLocation: NavGroupId | null
  toggleGroup: (group: NavGroupId) => void
}) {
  const openIndex = tree.findIndex((node) => node.kind === 'group' && node.group.id === openGroup)
  const open = openIndex >= 0 ? tree[openIndex] : undefined

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {open?.kind === 'group' && (
        // Full bar width, so the tail's fraction needs no measuring.
        <div className="relative">
          <div className="px-2 pb-3 pt-2">
            <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-lg">
              <div className="no-scrollbar flex overflow-x-auto" id={`nav-card-${open.group.id}`}>
                {open.children.map((surface) => (
                  <BarTab
                    key={surface.id}
                    surface={surface}
                    linkFor={linkFor}
                    claimedByAChild={claimedByAChild}
                    small
                  />
                ))}
              </div>
            </div>
          </div>
          {/*
            A 12px square rotated 45°, with only its bottom and right borders
            drawn — the card covers the other two, which is what makes it read as
            a tail rather than a diamond under a card. The tabs share the bar's
            width equally, so the centre of the nth is a fraction and needs no
            measuring, and it stays correct when the card is scrolled sideways,
            which a notch cut into the bar does not.
          */}
          <span
            aria-hidden
            className="absolute bottom-[calc(0.75rem-6px)] h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-border bg-surface-raised"
            style={{ left: `${((openIndex + 0.5) / tree.length) * 100}%` }}
            data-testid="nav-card-tail"
          />
        </div>
      )}

      <div className="flex border-t border-border">
        {tree.map((node) =>
          node.kind === 'surface' ? (
            <BarTab
              key={node.surface.id}
              surface={node.surface}
              linkFor={linkFor}
              claimedByAChild={claimedByAChild}
            />
          ) : (
            <GroupTab
              key={node.group.id}
              node={node}
              open={openGroup === node.group.id}
              inside={groupOfLocation === node.group.id}
              onToggle={() => toggleGroup(node.group.id)}
            />
          ),
        )}
      </div>
    </nav>
  )
}

/** The shared shape of a bar tab and a card tab — icon over label. */
const TAB =
  'flex flex-1 shrink-0 flex-col items-center justify-center gap-1 px-1 text-center font-semibold focus-visible:focus-ring'

function BarTab({
  surface,
  linkFor,
  claimedByAChild,
  small,
}: {
  surface: Surface
  linkFor: (surface: Surface) => string
  claimedByAChild: (path: string) => boolean
  /** A card tab: 56px and 18px against the bar's 64px and 20px. */
  small?: boolean
}) {
  const Icon = surface.nav?.icon
  return (
    <NavLink
      to={linkFor(surface)}
      // No indenting is possible in a row of tabs, so the single highlight
      // carries the whole answer here.
      end={surface.path === '' || claimedByAChild(surface.path)}
      className={({ isActive }) =>
        cn(
          TAB,
          small ? 'h-[56px] min-w-[4rem] text-[0.6875rem]' : 'h-[64px] min-w-[4.5rem] text-xs',
          isActive ? 'text-accent-text' : 'text-content-muted',
        )
      }
    >
      {/*
        The badge sits on the corner of the icon here rather than after the
        label: a tab is a stack, and a number on the end of the word would push
        it wider than its neighbours.
      */}
      <span className="relative">
        {Icon && <Icon aria-hidden size={small ? 18 : 20} />}
        {surface.nav?.attention && (
          <span className="absolute -right-2.5 -top-1.5">
            <NavAttentionBadge
              key={surface.nav.attention}
              source={surface.nav.attention}
              surface={surface.nav.label}
            />
          </span>
        )}
      </span>
      {surface.nav?.label}
    </NavLink>
  )
}

/**
 * A group's tab: it expands rather than navigates, so it is a button.
 *
 * **Lit whenever the reader is inside it, open or shut** — the bar says where
 * you are, not what you last tapped. Opening Setup while standing on Overview
 * leaves Overview lit.
 */
function GroupTab({
  node,
  open,
  inside,
  onToggle,
}: {
  node: NavNode & { kind: 'group' }
  open: boolean
  inside: boolean
  onToggle: () => void
}) {
  const Icon = node.group.icon
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={open ? `nav-card-${node.group.id}` : undefined}
      className={cn(
        TAB,
        'h-[64px] min-w-[4.5rem] text-xs',
        inside ? 'text-accent-text' : 'text-content-muted',
      )}
      data-testid={`nav-group-${node.group.id}`}
    >
      <span className="relative">
        <Icon aria-hidden size={20} />
        {/* The sum only while the parts are out of sight (spec: attention-badges). */}
        {!open && (
          <span className="absolute -right-2.5 -top-1.5">
            <NavGroupAttentionBadge group={node.group.label} sources={sourcesOf(node)} />
          </span>
        )}
      </span>
      <span className="flex items-center gap-0.5">
        {node.group.label}
        {open ? <ChevronDown aria-hidden size={12} /> : <ChevronRight aria-hidden size={12} />}
      </span>
    </button>
  )
}
