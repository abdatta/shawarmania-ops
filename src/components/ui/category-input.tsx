import { AlertTriangle, X } from 'lucide-react'
import { useId, useMemo, useState, type KeyboardEvent } from 'react'

import { normalizeCategory } from '@/domain'
import { cn } from '@/lib/cn'

import { Button } from './button'
import { Input } from './input'

const COMMISSION_NAMES = new Set([
  'aggregator commission',
  'zomato commission',
  'swiggy commission',
])
const DRAWER_NAMES = new Set(['cash banked', 'owner drawing', "owner's drawing"])

function expenseCategoryWarning(value: string): string | null {
  const phrase = normalizeCategory(value).toLocaleLowerCase()
  if (COMMISSION_NAMES.has(phrase)) {
    return 'Aggregator commission is already netted from aggregator revenue. Recording it as an expense would count it twice.'
  }
  if (DRAWER_NAMES.has(phrase)) {
    return 'Cash taken from the drawer belongs on the day as cash withdrawn, not as an expense, or the movement is counted twice.'
  }
  return null
}

export function CategoryInput({
  id,
  label,
  value,
  suggestions,
  onChange,
  testId,
}: {
  id: string
  label: string
  value: string
  suggestions: readonly string[]
  onChange: (value: string) => void
  testId?: string
}) {
  const generated = useId()
  const listId = `${id}-${generated}-suggestions`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [dismissedWarning, setDismissedWarning] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const query = normalizeCategory(value).toLocaleLowerCase()
    return suggestions.filter((candidate) => candidate.toLocaleLowerCase().includes(query))
  }, [suggestions, value])
  const warning = expenseCategoryWarning(value)
  const warningVisible =
    warning && dismissedWarning !== normalizeCategory(value).toLocaleLowerCase()

  function choose(candidate: string) {
    onChange(candidate)
    setOpen(false)
    setActive(-1)
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((current) => Math.min(current + 1, filtered.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === 'Enter' && open && active >= 0) {
      event.preventDefault()
      const candidate = filtered[active]
      if (candidate) choose(candidate)
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          required
          value={value}
          data-testid={testId}
          // No font-size utility here. `index.css` puts every input at 16px in
          // the base layer so iOS Safari does not zoom on focus, and a utility
          // class beats that layer: `text-base` is 1rem, which is 14px at this
          // root and reintroduces the zoom this field must not have.
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={keyDown}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
            setActive(-1)
          }}
        />
        {open && filtered.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
          >
            {filtered.map((candidate, index) => (
              <li
                key={candidate}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={active === index}
                className={cn(
                  'cursor-pointer rounded-lg px-3 py-2 text-sm text-content',
                  active === index && 'bg-surface-raised',
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(candidate)}
              >
                {candidate}
              </li>
            ))}
          </ul>
        )}
      </div>

      {warningVisible && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-warning bg-surface-raised p-3 text-sm text-content"
        >
          <AlertTriangle aria-hidden className="mt-0.5 shrink-0 text-warning" size={16} />
          <p className="min-w-0 flex-1">{warning}</p>
          <Button
            type="button"
            variant="ghost"
            size="phone"
            aria-label="Dismiss category warning"
            onClick={() => setDismissedWarning(normalizeCategory(value).toLocaleLowerCase())}
          >
            <X aria-hidden size={16} />
          </Button>
        </div>
      )}
    </div>
  )
}
