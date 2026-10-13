import { ChevronRight, ToggleRight } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { ConfirmTurn } from './confirm-turn'
import { dependentsOn, inDependencyOrder } from './order'
import { tabletState, type TabletState } from './tablet-state'
import { BuildVersion } from '@/components/build-version'
import { DataTable, type DataTableColumn } from '@/components/layout/data-table'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { LoadingRegion, LoadingTable, Shimmer } from '@/components/ui/loading'
import { Switch } from '@/components/ui/switch'
import { useAdapters } from '@/data-access/adapters-context'
import {
  DataActionError,
  type ChangeGateEvent,
  type ChangeGateSummary,
  type DeviceHealthReading,
} from '@/data-access/adapters'
import { formatDayTime, formatRecentAge } from '@/domain'
import { cn } from '@/lib/cn'

/**
 * The owner's change gates (a-release-can-be-switched-off, design D18).
 *
 * A change gate applies or removes one change while the app runs — the owner's
 * name and the owner's description (2026-10-12). A list like Team: one row per
 * gate, its state in a word, the gates it is dependent on named by code under it,
 * and the whole row opening that gate's own page. A gate comes after the gates it
 * depends on. Reached from the account menu rather than the navigation, because it
 * is about the app, not an outlet.
 *
 * **Read from the adapter, never from the build's own declarations** (D4): an
 * owner's phone still on an older build must list, and be able to turn off, a
 * gate a newer build added.
 */
export function ChangeGatesSurface() {
  const { changeGates } = useAdapters()
  const [gates, setGates] = useState<ChangeGateSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void changeGates
      .overview()
      .then((overview) => {
        if (active) setGates(overview.gates)
      })
      .catch((cause: unknown) => {
        if (active)
          setError(messageOf(cause, 'Could not load change gates. Try again in a moment.'))
      })
    return () => {
      active = false
    }
  }, [changeGates])

  const ordered = useMemo(() => (gates === null ? null : inDependencyOrder(gates)), [gates])

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Change gates" />

      {error && (
        <p
          role="alert"
          data-testid="change-gates-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {ordered === null ? (
        error ? null : (
          <LoadingTable
            label="change gates"
            rows={3}
            rowHeight="h-16"
            data-testid="change-gates-loading"
          />
        )
      ) : (
        <div data-testid="change-gate-list">
          <GateTable
            gates={ordered}
            all={gates ?? []}
            to={(gate) => gate.key}
            empty={
              <EmptyState
                icon={ToggleRight}
                title="No change is gated. A change that alters how a screen behaves arrives here, off, until you turn it on."
              />
            }
          />
        </div>
      )}

      <BuildVersion className="mt-10 text-center" />
    </div>
  )
}

/**
 * The gates as rows, drawn the same way on the list and on a gate's own page,
 * where its dependencies and the gates that need it are rows of their own
 * (owner, 2026-10-13: "like a clickable table row").
 */
function GateTable({
  gates,
  all,
  to,
  empty,
}: {
  gates: ChangeGateSummary[]
  /** Every gate, to name dependencies by code. */
  all: ChangeGateSummary[]
  to: (gate: ChangeGateSummary) => string
  empty?: ReactNode
}) {
  const codeOf = (key: string) => all.find((gate) => gate.key === key)?.code ?? key
  const columns: DataTableColumn<ChangeGateSummary>[] = [
    {
      id: 'gate',
      header: 'Change gate',
      cell: (gate) => (
        // One link stretched over its row, as Outlets does: the whole row is one
        // tap, and a screen reader meets one link named for the gate.
        <Link
          to={to(gate)}
          relative="path"
          data-testid={`open-gate-${gate.key}`}
          className="block py-2 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:focus-ring"
        >
          <span className="flex items-center gap-2">
            <span className="font-semibold text-content">{gate.title}</span>
            <GateCode code={gate.code} />
          </span>
          <span className="block text-xs text-content-muted">{changeLabel(gate)}</span>
          {gate.dependsOn.length > 0 && (
            <span
              className="mt-1 flex flex-wrap items-center gap-1 text-xs text-content-muted"
              data-testid={`depends-${gate.key}`}
            >
              Dependent on{' '}
              {gate.dependsOn.map((key) => (
                <Fragment key={key}>
                  <GateCode code={codeOf(key)} />{' '}
                </Fragment>
              ))}
            </span>
          )}
        </Link>
      ),
    },
    {
      id: 'state',
      header: 'Status',
      cell: (gate) => <GateState enabled={gate.enabled} />,
    },
    {
      id: 'open',
      header: <span className="sr-only">Open the change gate</span>,
      align: 'right',
      cell: () => <ChevronRight aria-hidden size={16} className="inline text-content-muted" />,
    },
  ]
  return (
    <DataTable
      columns={columns}
      rows={gates}
      rowKey={(gate) => gate.key}
      rowClassName={() => 'relative hover:bg-surface-raised'}
      empty={empty ?? null}
    />
  )
}

/**
 * **One change gate's own page.** Its state and the switch that turns it come
 * first (owner, 2026-10-13), then its code, what On and Off mean, the gates it is
 * dependent on and the gates that need it, every tablet's live reading, and the
 * history.
 *
 * Back steps back through the reader's own history, as an outlet's page does,
 * and goes to the list when the page was opened first.
 */
export function ChangeGatePage() {
  const { changeGates } = useAdapters()
  const navigate = useNavigate()
  const location = useLocation()
  const { gateKey = '' } = useParams()
  const [gates, setGates] = useState<ChangeGateSummary[] | null>(null)
  const [tablets, setTablets] = useState<DeviceHealthReading[]>([])
  const [history, setHistory] = useState<ChangeGateEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reads, setReads] = useState(0)

  const toList = useCallback(
    () => void navigate('..', { relative: 'path', replace: true }),
    [navigate],
  )
  const back = useCallback(() => {
    if (location.key === 'default') toList()
    else void navigate(-1)
  }, [location.key, navigate, toList])

  useEffect(() => {
    let active = true
    void Promise.all([changeGates.overview(), changeGates.history(gateKey)])
      .then(([overview, events]) => {
        if (!active) return
        setGates(overview.gates)
        setTablets(overview.tablets)
        setHistory(events)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setGates([])
        setError(messageOf(cause, 'Could not load this change gate. Try again in a moment.'))
      })
    return () => {
      active = false
    }
  }, [changeGates, gateKey, reads])

  const all = gates ?? []
  const gate = gates === null ? undefined : (all.find((g) => g.key === gateKey) ?? null)
  const dependencies = gate ? all.filter((g) => gate.dependsOn.includes(g.key)) : []
  const neededBy = gate ? all.filter((g) => g.dependsOn.includes(gate.key)) : []
  const alsoOff = gate ? dependentsOn(gate.key, all) : []
  const waitingFor = gate && !gate.enabled ? dependencies.filter((g) => !g.enabled) : []

  async function turn(reason: string | null) {
    if (!gate) return
    setBusy(true)
    setError(null)
    try {
      await changeGates.turn(gate.key, !gate.enabled, reason)
      setConfirming(false)
      setReads((count) => count + 1)
    } catch (cause) {
      setError(messageOf(cause, 'That change gate could not be turned. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        onBack={back}
        title={gate ? gate.title : 'Change gate'}
        subtitle={gate ? changeLabel(gate) : undefined}
      />

      {error && (
        <p
          role="alert"
          data-testid="change-gates-error"
          className="mb-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {gate === undefined ? (
        <GatePageShimmer />
      ) : gate === null ? (
        error ? null : (
          <EmptyState icon={ToggleRight} title="There is no change gate by that name." />
        )
      ) : (
        <div className="space-y-6" data-testid={`gate-${gate.key}`}>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-raised py-1 pl-3 pr-1">
              <p className="text-sm" data-testid="gate-since">
                <span className="font-semibold text-content">{gate.enabled ? 'On' : 'Off'}</span>
                <span className="text-content-muted">{sinceWords(gate)}</span>
              </p>
              <Switch
                checked={gate.enabled}
                onChange={() => setConfirming(true)}
                label={`${gate.enabled ? 'Turn off' : 'Turn on'} ${gate.title}`}
                disabled={busy || waitingFor.length > 0}
                testId="turn-gate"
              />
            </div>
            {waitingFor.length > 0 && (
              <p className="text-sm text-content-muted" data-testid="gate-blocked">
                Turn on {waitingFor.map((g) => g.title).join(' and ')} first: this is dependent on{' '}
                {waitingFor.length === 1 ? 'it' : 'them'}.
              </p>
            )}
          </div>

          <dl className="grid grid-cols-1 gap-2">
            <Tile caption="Code">
              <GateCode code={gate.code} />
            </Tile>
            <Tile caption="On means">{gate.onMeans}</Tile>
            <Tile caption="Off means">{gate.offMeans}</Tile>
          </dl>

          {dependencies.length > 0 && (
            <Section id="gate-dependencies" title="Dependent on">
              <div data-testid="gate-dependencies">
                <GateTable gates={dependencies} all={all} to={(g) => `../${g.key}`} />
              </div>
            </Section>
          )}

          {neededBy.length > 0 && (
            <Section id="gate-needed-by" title="Needed by">
              <div data-testid="gate-needed-by">
                <GateTable gates={neededBy} all={all} to={(g) => `../${g.key}`} />
              </div>
            </Section>
          )}

          <Section id="gate-tablets" title="Tablets">
            <Tablets gate={gate} tablets={tablets} />
          </Section>

          <Section id="gate-history" title="History">
            <History events={history} />
          </Section>
        </div>
      )}

      {gate && (
        <ConfirmTurn
          open={confirming}
          title={gate.title}
          turningOn={!gate.enabled}
          alsoOff={gate.enabled ? alsoOff.map((g) => g.title) : []}
          busy={busy}
          onConfirm={(reason) => void turn(reason)}
          onClose={() => setConfirming(false)}
        />
      )}

      <BuildVersion className="mt-10 text-center" />
    </div>
  )
}

/**
 * A chosen setting reads as plain words, never as a dot (the owner's
 * conventions, 2026-09-26): dots on this app mean live readings.
 */
function GateState({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="font-semibold text-content" data-testid="gate-state">
      On
    </span>
  ) : (
    <span className="text-content-muted" data-testid="gate-state">
      Off
    </span>
  )
}

/** The gate's code, as the build stamp lists it. */
function GateCode({ code }: { code: string }) {
  return (
    <span
      className="rounded border border-border px-1.5 text-xs font-semibold tracking-wide text-content-muted"
      data-numeric=""
      data-testid="gate-code"
    >
      {code}
    </span>
  )
}

/**
 * Every gate belongs to an OpenSpec change; a roadmap number is shown only when
 * the change has one (owner, 2026-10-12).
 */
function changeLabel(gate: ChangeGateSummary): string {
  return gate.changeNumber === null ? gate.changeName : `#${gate.changeNumber} · ${gate.changeName}`
}

function sinceWords(gate: ChangeGateSummary): string {
  if (!gate.changedAt) return ' · never turned'
  const who = gate.changedByName ? ` · ${gate.changedByName}` : ''
  return ` · since ${formatDayTime(gate.changedAt)}${who}`
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof DataActionError ? cause.message : fallback
}

/** A caption over a value, as the outlet page's tiles are. */
function Tile({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-raised px-3 py-2">
      <dt className="text-xs text-content-muted">{caption}</dt>
      <dd className="text-sm font-semibold text-content">{children}</dd>
    </div>
  )
}

/**
 * A quiet label over one group, its actions on the right — the outlet page's
 * section, kept local because a change gate is not an outlet.
 */
function Section({
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
        <h3 id={id} className="text-sm font-semibold text-content-muted">
          {title}
        </h3>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

const DOT: Record<TabletState['health'], string> = {
  ok: 'bg-success',
  failing: 'bg-danger',
  stale: 'bg-content-muted',
}

/**
 * Every tablet, grouped by outlet, as live readings — so a dot is allowed here.
 *
 * Two different things on each line. **Running or waiting** is about this gate:
 * whether the tablet has reloaded into its current state yet, which is what the
 * owner watches after a turn. **Requests, failures and the slowest** are about
 * the tablet, whatever it runs: how it is talking to the server over the last
 * minute. They are what would have shown, on 12 October, a counter sending six
 * hundred requests a minute and then recovering (design D13).
 */
function Tablets({ gate, tablets }: { gate: ChangeGateSummary; tablets: DeviceHealthReading[] }) {
  const groups = useMemo(() => {
    const byOutlet = new Map<string, { name: string; tablets: DeviceHealthReading[] }>()
    for (const tablet of tablets) {
      const group = byOutlet.get(tablet.outletId) ?? { name: tablet.outletName, tablets: [] }
      group.tablets.push(tablet)
      byOutlet.set(tablet.outletId, group)
    }
    return [...byOutlet.values()]
  }, [tablets])

  if (tablets.length === 0) {
    return (
      <p
        className="rounded-lg bg-surface-raised px-3 py-2 text-sm text-content-muted"
        data-testid="no-tablets"
      >
        Tablets report here once Tablet health is on.
      </p>
    )
  }

  const now = new Date()
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.name} className="space-y-1">
          <p className="text-xs font-semibold text-content-muted">{group.name}</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {group.tablets.map((tablet) => {
              const state = tabletState(tablet, gate, now)
              return (
                <li
                  key={tablet.deviceId}
                  className="flex items-start gap-3 px-3 py-2"
                  data-testid={`tablet-${tablet.deviceId}`}
                  data-health={state.health}
                  data-follows={state.follows}
                >
                  <span
                    aria-hidden
                    className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', DOT[state.health])}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="font-semibold text-content">{tablet.label}</span>
                      <span className="text-xs text-content-muted" data-numeric="">
                        {tablet.build} ·{' '}
                        <span
                          className={cn(
                            state.follows === 'waiting' && 'font-semibold text-warning',
                          )}
                        >
                          {state.follows}
                        </span>
                      </span>
                    </p>
                    <p className="text-xs text-content-muted">
                      {state.health === 'stale' ? (
                        <span className="font-semibold">
                          Silent · last heard {formatRecentAge(tablet.reportedAt, now)}
                        </span>
                      ) : (
                        <>
                          <span data-numeric="">{tablet.requests} requests</span>
                          {' · '}
                          <span
                            className={cn(tablet.failed > 0 && 'font-semibold text-danger')}
                            data-numeric=""
                          >
                            {tablet.failed} failed
                          </span>
                          {' · '}
                          <span data-numeric="">slowest {seconds(tablet.slowestMs)}</span>
                          {' · '}
                          {formatRecentAge(tablet.reportedAt, now)}
                        </>
                      )}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

function History({ events }: { events: ChangeGateEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="rounded-lg bg-surface-raised px-3 py-2 text-sm text-content-muted">
        Never turned. It has been off since it arrived.
      </p>
    )
  }
  return (
    <ul
      className="divide-y divide-border rounded-lg border border-border"
      data-testid="gate-history"
    >
      {events.map((event) => (
        <li key={`${event.at}-${event.enabled}`} className="flex gap-3 px-3 py-2 text-sm">
          <span className="w-32 shrink-0 text-content-muted" data-numeric="">
            {formatDayTime(event.at)}
          </span>
          <span
            className={cn(
              'w-8 shrink-0',
              event.enabled ? 'font-semibold text-content' : 'text-content-muted',
            )}
          >
            {event.enabled ? 'On' : 'Off'}
          </span>
          <span className="min-w-0 flex-1 text-content-muted">
            {[event.source === 'operator' ? 'From the dashboard' : event.byName, event.reason]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Tiles, State, then the Tablets label over two tablets and the History label
 * over two turns — the shape the page arrives in, so nothing reflows when it does.
 */
function GatePageShimmer() {
  return (
    <LoadingRegion
      label="this change gate"
      className="space-y-6"
      data-testid="change-gates-loading"
    >
      <div className="space-y-2">
        <Shimmer className="h-14" />
        <Shimmer className="h-14" />
        <Shimmer className="h-14" />
      </div>
      <div className="space-y-2">
        <Shimmer className="h-10 w-1/3" />
        <Shimmer className="h-9" />
      </div>
      <div className="space-y-2">
        <Shimmer className="h-10 w-1/3" />
        <Shimmer className="h-28" />
      </div>
      <div className="space-y-2">
        <Shimmer className="h-10 w-1/3" />
        <Shimmer className="h-20" />
      </div>
    </LoadingRegion>
  )
}
