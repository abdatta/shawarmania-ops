import { MapPinOff, UserCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useAdapters, type Tables } from '@/data-access'
import { DataActionError, type OutletAttendanceRules } from '@/data-access/adapters'
import { OutletSection } from '@/features/outlets/outlet-section'
import {
  Answer,
  SAVED_HOLD_MS,
  SaveBar,
  SETTLE_MS,
  SettingTile,
  type SavePhase,
} from '@/features/outlets/outlet-service-sections'
import { cn } from '@/lib/cn'
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion'

/**
 * An outlet's **Attendance** rules (a-check-in-at-the-shop-approves-itself,
 * design D2), after Google review on the outlet's page and built the same way:
 * a switch per rule, one Save.
 *
 * ```
 * ATTENDANCE
 * ┌ Manager approves every check-in                    [off] ┐
 * │ Check-ins at the shop are approved automatically          │
 * ┌ Block check-ins away from the shop                 [off] ┐
 * │ Away check-ins wait for a manager                         │
 * ```
 *
 * Both start off, which is the new behaviour: a check-in the shop's fence
 * measures inside is approved by itself, and one from away waits. The owner
 * sets them for any outlet and a manager for the outlets they manage: how an
 * outlet runs its staff is its own business [owner, 2026-10-25]. The shop's
 * position and fence are not here — they prove where a franchise trades, and
 * stay the owner's, under Details.
 */
export function OutletAttendanceSection({
  outlet,
  mayWrite,
}: {
  outlet: Tables<'outlets'>
  /** Whether to offer the controls. The database is what refuses the write. */
  mayWrite: boolean
}) {
  const { outlets } = useAdapters()
  const [stored, setStored] = useState<OutletAttendanceRules>({
    needsManager: outlet.attendance_needs_manager,
    blocksAway: outlet.attendance_blocks_away,
  })
  const unsurveyed = outlet.latitude === null || outlet.longitude === null

  if (!mayWrite) {
    return (
      <OutletSection
        id={`attendance-${outlet.id}`}
        title="Attendance"
        data-testid="attendance-rules-section"
      >
        <Card className="space-y-2 p-3">
          <SettingTile
            depth={1}
            icon={UserCheck}
            caption="Manager approves every check-in"
            control={<Answer>{stored.needsManager ? 'On' : 'Off'}</Answer>}
          />
          <SettingTile
            depth={1}
            icon={MapPinOff}
            caption="Block check-ins away from the shop"
            control={<Answer>{stored.blocksAway ? 'On' : 'Off'}</Answer>}
          />
        </Card>
      </OutletSection>
    )
  }

  return (
    <RulesForm
      key={outlet.id}
      outletId={outlet.id}
      stored={stored}
      unsurveyed={unsurveyed}
      onSave={async (next) => {
        const row = await outlets.updateAttendanceRules(outlet.id, next)
        const saved = {
          needsManager: row.attendance_needs_manager,
          blocksAway: row.attendance_blocks_away,
        }
        setStored(saved)
        return saved
      }}
    />
  )
}

function RulesForm({
  outletId,
  stored,
  unsurveyed,
  onSave,
}: {
  outletId: string
  stored: OutletAttendanceRules
  unsurveyed: boolean
  onSave: (next: OutletAttendanceRules) => Promise<OutletAttendanceRules>
}) {
  const [needsManager, setNeedsManager] = useState(stored.needsManager)
  const [blocksAway, setBlocksAway] = useState(stored.blocksAway)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<SavePhase>('idle')
  const busy = phase === 'saving'
  const reduceMotion = usePrefersReducedMotion()

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

  const dirty = needsManager !== stored.needsManager || blocksAway !== stored.blocksAway

  async function submit() {
    setPhase('saving')
    setError(null)
    try {
      const saved = await onSave({ needsManager, blocksAway })
      setNeedsManager(saved.needsManager)
      setBlocksAway(saved.blocksAway)
      setPhase('saved')
    } catch (cause) {
      setError(cause instanceof DataActionError ? cause.message : 'That could not be saved.')
      setPhase('idle')
    }
  }

  return (
    <OutletSection
      id={`attendance-${outletId}`}
      title="Attendance"
      data-testid="attendance-rules-section"
    >
      <Card
        className={cn(
          'space-y-2 p-3',
          phase === 'saved' && 'motion-safe:animate-[saved-glow_1.6s_ease-out]',
        )}
        data-saved={phase === 'saved' || undefined}
      >
        <SettingTile
          depth={1}
          icon={UserCheck}
          caption="Manager approves every check-in"
          hint={
            needsManager
              ? 'Every check-in waits for a manager'
              : 'Check-ins at the shop are approved automatically'
          }
          control={
            <Switch
              checked={needsManager}
              label="Manager approves every check-in"
              testId="attendance-needs-manager-switch"
              disabled={busy}
              onChange={(value) => {
                setNeedsManager(value)
                setError(null)
              }}
            />
          }
        />
        <SettingTile
          depth={1}
          icon={MapPinOff}
          caption="Block check-ins away from the shop"
          hint={
            unsurveyed && blocksAway
              ? 'This shop’s location isn’t set, so every check-in would be refused'
              : blocksAway
                ? 'Away check-ins are refused. You record them instead'
                : 'Away check-ins wait for a manager'
          }
          control={
            <Switch
              checked={blocksAway}
              label="Block check-ins away from the shop"
              testId="attendance-blocks-away-switch"
              disabled={busy}
              onChange={(value) => {
                setBlocksAway(value)
                setError(null)
              }}
            />
          }
        />
        <SaveBar
          dirty={dirty}
          phase={phase}
          error={error}
          name="Attendance"
          testPrefix="attendance-rules"
          onSave={() => void submit()}
          onCancel={() => {
            setNeedsManager(stored.needsManager)
            setBlocksAway(stored.blocksAway)
            setError(null)
          }}
        />
      </Card>
    </OutletSection>
  )
}
