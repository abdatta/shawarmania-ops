import { useEffect, useId, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import type { AddressSuggestion } from '@/data-access/adapters'

/**
 * Type a landmark, pick a place, fill an address.
 *
 * Knows nothing about outlets — it takes a lookup and a callback — so its
 * network, cancellation, and keyboard behavior stay isolated from the form.
 *
 * A real combobox rather than a div with a click handler: this form is filled
 * on a phone by somebody who may well be using a screen reader, and the
 * keyboard contract (arrow, enter, escape) is what makes a list of suggestions
 * usable rather than decorative.
 */

/** Long enough that a search is a decision, short enough not to feel laggy. */
const DEBOUNCE_MS = 300

export function AddressSearch({
  suggest,
  onPick,
  label,
  placeholder,
  hint,
}: {
  suggest: (query: string, signal?: AbortSignal) => Promise<AddressSuggestion[]>
  onPick: (suggestion: AddressSuggestion) => void
  label: string
  placeholder?: string
  hint?: string
}) {
  const inputId = useId()
  const listId = useId()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AddressSuggestion[] | null>(null)
  const [active, setActive] = useState(-1)
  const [open, setOpen] = useState(false)

  /**
   * Set when a pick fills the field, so the effect below does not immediately
   * search for the text it just wrote and reopen the list underneath.
   */
  const justPicked = useRef(false)

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false
      return
    }
    // Clearing for a too-short query happens in the change handler, not here:
    // a synchronous setState inside an effect is a cascading render, and this
    // effect exists to run a request rather than to mirror state.
    if (query.trim().length < 3) return

    const controller = new AbortController()
    const timer = setTimeout(() => {
      void suggest(query, controller.signal)
        .then((found) => {
          // Aborted requests still resolve here through the adapter's own
          // catch, so the signal is what decides whether this answer is still
          // wanted. Without it a slow response to "ka" lands after a fast one
          // to "kalyani" and replaces the better list with the worse.
          if (controller.signal.aborted) return
          setResults(found)
          setActive(-1)
          setOpen(true)
        })
        .catch(() => {
          if (!controller.signal.aborted) setResults([])
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, suggest])

  function pick(suggestion: AddressSuggestion) {
    justPicked.current = true
    setQuery(suggestion.placeName || suggestion.addressLine1)
    setOpen(false)
    setResults(null)
    setActive(-1)
    onPick(suggestion)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !results?.length) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (current <= 0 ? results.length - 1 : current - 1))
    } else if (event.key === 'Enter' && active >= 0) {
      // Only swallowed when something is highlighted, so Enter still submits
      // the form for somebody who never opened the list.
      event.preventDefault()
      pick(results[active]!)
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`

  return (
    <div className="relative">
      <label htmlFor={inputId} className="block text-sm font-semibold">
        {label}
      </label>
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(active >= 0 ? { 'aria-activedescendant': optionId(active) } : {})}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          const next = event.target.value
          setQuery(next)
          if (next.trim().length < 3) {
            setResults(null)
            setOpen(false)
            setActive(-1)
          }
        }}
        onKeyDown={onKeyDown}
      />
      {hint && <p className="mt-1 text-xs text-content-muted">{hint}</p>}

      {/*
        Zero results is an answer and gets said. Every other failure is silent:
        this is a shortcut on an optional block, and an error banner would tell
        somebody to fix something when there is nothing wrong and nothing they
        could do about it.
      */}
      {open && results?.length === 0 && (
        <p data-testid="address-no-matches" className="mt-1 text-xs text-content-muted">
          No matches. Type the address in the fields below instead.
        </p>
      )}

      {open && results !== null && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-surface shadow-lg"
        >
          {results.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              // The list closes on blur, so mousedown rather than click: click
              // fires after blur has already torn the option away.
              onMouseDown={(event) => {
                event.preventDefault()
                pick(suggestion)
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex min-h-[var(--size-control-phone)] cursor-pointer items-center px-3 py-2 text-sm ${
                index === active ? 'bg-surface-raised text-content' : 'text-content'
              }`}
            >
              {suggestion.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
