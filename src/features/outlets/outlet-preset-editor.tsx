import { Trash2, Plus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DiscountPreset } from '@/data-access/adapters'
import { formatPaise, rupeesToPaise } from '@/domain'
import { Segmented } from './outlet-service-sections'

/**
 * The counter panel's percentage presets.
 *
 * Between none and four. Four is a layout fact rather than an arbitrary cap: the
 * biller's panel fits four across one row, and a preset row that wraps is worse
 * than one preset fewer.
 */
export function PresetEditor({
  presets,
  busy,
  onSetPresets,
}: {
  presets: DiscountPreset[]
  busy: boolean
  onSetPresets: (presets: DiscountPreset[]) => Promise<void>
}) {
  const [adding, setAdding] = useState('')
  const [addingBasis, setAddingBasis] = useState<'percent' | 'amount'>('percent')

  const label = (preset: DiscountPreset) =>
    preset.basis === 'percent' ? `${preset.value / 100}%` : formatPaise(preset.value)

  return (
    <div data-testid="discount-presets">
      <div className="space-y-2">
        {presets.length === 0 && <p className="text-xs text-content-muted">No shortcuts set.</p>}
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, presets.length)}, minmax(0, 1fr))` }}
        >
          {presets.map((preset) => (
            <Button
              key={`${preset.basis}-${preset.value}`}
              data-testid={`preset-${preset.basis}-${preset.value}`}
              variant="ghost"
              size="phone"
              className="min-h-[44px] min-w-0 gap-1 rounded-lg bg-surface px-1 text-sm font-semibold text-content"
              aria-label={`Remove the ${label(preset)} preset`}
              title={`Remove ${label(preset)}`}
              disabled={busy}
              onClick={() =>
                void onSetPresets(
                  presets.filter(
                    (candidate) =>
                      !(candidate.basis === preset.basis && candidate.value === preset.value),
                  ),
                )
              }
            >
              <span className="truncate">{label(preset)}</span>
              <Trash2 aria-hidden size={13} className="shrink-0" />
            </Button>
          ))}
        </div>

        {presets.length < 4 && (
          <div className="flex items-center gap-2">
            <Input
              className="h-[44px] min-w-0 flex-1 bg-surface"
              inputMode="decimal"
              autoComplete="off"
              aria-label="New preset value"
              disabled={busy}
              placeholder="Value"
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
            />
            {/*
              Two buttons rather than a dropdown: there are exactly two units,
              and a select costs a tap to open before the tap that chooses. It is
              also the same %/₹ pair the discount sheet and the counter panel
              already use, so the control means one thing everywhere.
            */}
            <Segmented
              label="New preset unit"
              compact
              single
              disabled={busy}
              testId="preset-unit"
              options={[
                { value: 'percent', label: '%', on: addingBasis === 'percent' },
                { value: 'amount', label: '₹', on: addingBasis === 'amount' },
              ]}
              onToggle={(value) => setAddingBasis(value as 'percent' | 'amount')}
            />
            <Button
              variant="secondary"
              size="phone"
              className="min-h-[44px] w-[44px] shrink-0 px-0"
              aria-label="Add shortcut"
              title="Add shortcut"
              data-testid="add-preset"
              disabled={busy || adding.trim() === ''}
              onClick={() => {
                const numeric = Number(adding.trim())
                if (!Number.isFinite(numeric) || numeric <= 0) return
                if (addingBasis === 'percent' && numeric > 100) return
                const next: DiscountPreset = {
                  basis: addingBasis,
                  // Basis points for a percentage, paise for an amount — the
                  // same integer convention the rest of the discount path uses.
                  value:
                    addingBasis === 'percent' ? Math.round(numeric * 100) : rupeesToPaise(numeric),
                }
                if (
                  presets.some(
                    (preset) => preset.basis === next.basis && preset.value === next.value,
                  )
                ) {
                  setAdding('')
                  return
                }
                void onSetPresets(
                  [...presets, next].sort(
                    (left, right) =>
                      left.basis.localeCompare(right.basis) || left.value - right.value,
                  ),
                )
                setAdding('')
              }}
            >
              <Plus aria-hidden size={16} />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
