import {
  offeredServiceTypes,
  serviceChoiceShown,
  serviceTypeLabel,
  tableLabel,
  tablesOffered,
  type OutletServiceSettings,
  type ServiceType,
} from '@/domain'
import { cn } from '@/lib/cn'

/**
 * Where the food goes: *Dine-in* and *Takeaway*, beside the customer control,
 * **only where there is a choice to make** (each-outlet-chooses-how-it-serves,
 * owner 2026-09-27): both types offered, or dine-in with tables. A shop offering
 * one type with nothing to choose within it shows no chip, because every order
 * there already is that type.
 *
 * **Nothing is preselected, one tap marks the order, and the answer is owed**
 * [owner, 2026-09-27]: Order and Paid wait for it, the way they wait for the
 * customer decision. Tapping the chosen chip again takes a mistaken tap back,
 * and Order and Paid wait again — nobody should have to tap the other type and
 * back to undo one.
 *
 * At an outlet with tables, *Dine-in* asks which table in a popup rather than
 * choosing itself. Once answered, the chip reads the answer alone — *Table 4*,
 * or *No table* [owner, 2026-09-27] — and tapping it reopens the popup.
 *
 * Toggle buttons with `aria-pressed` rather than status chips: these are
 * controls, and the `Chip` primitive states a fact nobody acts on.
 */
export function ServiceChips({
  settings,
  serviceType,
  tableNumber,
  disabled,
  onChoose,
  onOpenTables,
}: {
  settings: OutletServiceSettings
  serviceType: ServiceType | null
  tableNumber: number | null
  disabled: boolean
  onChoose: (serviceType: ServiceType | null) => void
  onOpenTables: () => void
}) {
  if (!serviceChoiceShown(settings)) return null
  const offered = offeredServiceTypes(settings)

  function tap(type: ServiceType) {
    if (type === 'dine_in' && tablesOffered(settings)) {
      onOpenTables()
      return
    }
    onChoose(serviceType === type ? null : type)
  }

  return (
    <div
      role="group"
      aria-label="Where the food goes"
      // The full width of the panel, shared equally, so each chip is as easy a
      // target as the customer row beneath it.
      className={cn('grid gap-2', offered.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}
    >
      {offered.map((type) => {
        const on = serviceType === type
        return (
          <button
            key={type}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            data-testid={`service-chip-${type}`}
            onClick={() => tap(type)}
            className={cn(
              'inline-flex h-[var(--size-control)] select-none items-center justify-center whitespace-nowrap rounded-full px-4 font-semibold',
              'focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-50',
              on
                ? 'bg-primary text-on-primary hover:brightness-95'
                : 'border border-border bg-surface text-content hover:bg-surface-raised',
            )}
          >
            {type === 'dine_in' && on && tablesOffered(settings)
              ? tableNumber === null
                ? 'No table'
                : tableLabel(tableNumber)
              : serviceTypeLabel(type)}
          </button>
        )
      })}
    </div>
  )
}
