import { Percent } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Card } from '@/components/ui/card'
import { LoadingRegion, Shimmer } from '@/components/ui/loading'
import { useAdapters } from '@/data-access'
import type { DiscountPreset } from '@/data-access/adapters'
import { formatPaise } from '@/domain'
import { cn } from '@/lib/cn'
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion'
import { PresetEditor } from './outlet-preset-editor'
import {
  SaveBar,
  SettingTile,
  SAVED_HOLD_MS,
  SETTLE_MS,
  type SavePhase,
} from './outlet-service-sections'

/** Existing bill-discount settings, edited inline within Orders. */
export function OutletDiscountPresets(props: { outletId: string; mayWrite: boolean }) {
  return <OutletPresets key={props.outletId} {...props} />
}

function OutletPresets({ outletId, mayWrite }: { outletId: string; mayWrite: boolean }) {
  const { menu } = useAdapters()
  const [stored, setStored] = useState<DiscountPreset[] | null>(null)
  const [draft, setDraft] = useState<DiscountPreset[]>([])
  const [failed, setFailed] = useState(false)
  const [phase, setPhase] = useState<SavePhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const reduceMotion = usePrefersReducedMotion()
  const saving = phase === 'saving'
  const dirty = stored !== null && JSON.stringify(stored) !== JSON.stringify(draft)

  useEffect(() => {
    let active = true
    void menu.readOutletMenu(outletId).then(
      (snapshot) => {
        if (active) {
          setStored(snapshot.presets)
          setDraft(snapshot.presets)
        }
      },
      () => {
        if (active) setFailed(true)
      },
    )
    return () => {
      active = false
    }
  }, [menu, outletId])

  useEffect(() => {
    if (phase === 'saved') {
      const timer = window.setTimeout(() => setPhase('settling'), SAVED_HOLD_MS)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'settling') {
      const timer = window.setTimeout(() => setPhase('idle'), reduceMotion ? 0 : SETTLE_MS)
      return () => window.clearTimeout(timer)
    }
  }, [phase, reduceMotion])

  async function save() {
    if (!mayWrite || saving || !dirty) return
    setPhase('saving')
    setError(null)
    try {
      const saved = await menu.setDiscountPresets(outletId, draft)
      setStored(saved)
      setDraft(saved)
      setPhase('saved')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save bill discount shortcuts. Try again.',
      )
      setPhase('idle')
    }
  }

  if (failed)
    return (
      <Card className="p-3">
        <p role="alert" className="text-sm font-semibold text-danger">
          Bill discount shortcuts could not be read. Try again in a moment.
        </p>
      </Card>
    )
  if (stored === null)
    return (
      <Card className="p-3">
        <LoadingRegion label="bill discount shortcuts">
          <OutletPresetsShimmer />
        </LoadingRegion>
      </Card>
    )

  return (
    <Card
      className={cn('p-3', phase === 'saved' && 'motion-safe:animate-[saved-glow_1.6s_ease-out]')}
      data-saved={phase === 'saved' || undefined}
      data-testid="presets-card"
    >
      <div data-testid="outlet-discount-presets">
        <SettingTile
          compact
          depth={1}
          icon={Percent}
          caption="Bill discount shortcuts"
          hint="Up to four whole-bill discounts at the counter"
          control={null}
        >
          {mayWrite ? (
            <>
              <PresetEditor
                key={revision}
                presets={draft}
                busy={saving}
                onSetPresets={async (next) => {
                  setDraft(next)
                  setError(null)
                  setPhase('idle')
                }}
              />
              <SaveBar
                name="Bill discount shortcuts"
                testPrefix="presets"
                dirty={dirty}
                phase={phase}
                error={error}
                onSave={() => void save()}
                onCancel={() => {
                  setDraft(stored.map((preset) => ({ ...preset })))
                  setError(null)
                  setPhase('idle')
                  setRevision((value) => value + 1)
                }}
              />
            </>
          ) : (
            <p className="text-sm font-semibold text-content">
              {stored.length
                ? stored
                    .map((preset) =>
                      preset.basis === 'percent'
                        ? `${preset.value / 100}%`
                        : formatPaise(preset.value),
                    )
                    .join(' · ')
                : 'No shortcuts'}
            </p>
          )}
        </SettingTile>
      </div>
    </Card>
  )
}

export function OutletPresetsShimmer() {
  return <Shimmer className="h-[calc(90px+5.5rem)]" />
}
