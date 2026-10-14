import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { BillLineDraft } from '@/data-access/adapters'
import { dishLocked, NOTE_STORAGE_KEY, rankedNotes } from '@/domain/dish-workflow'

function readCounts(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(NOTE_STORAGE_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter(
        ([note, count]) =>
          note.length <= 60 && typeof count === 'number' && Number.isFinite(count) && count > 0,
      ),
    )
  } catch {
    return {}
  }
}

/**
 * A dish's note. On a composer row the kitchen has partly made, the note is for
 * the food not made yet, and says so; on a row all made, there is nothing it
 * can change, and the sheet says that instead (owner, 2026-10-14).
 */
export function DishNoteSheet({
  line,
  made = 0,
  onClose,
  onSave,
}: {
  /** The row's line not made yet, or, when all of it is made, its first. */
  line: BillLineDraft
  /** How much of the row is made: Done or handed over. */
  made?: number
  onClose: () => void
  onSave: (note: string | null, onlyOne: boolean) => void
}) {
  const [note, setNote] = useState(line.note ?? '')
  const [onlyOne, setOnlyOne] = useState(false)
  const [counts] = useState(readCounts)
  if (dishLocked(line))
    return (
      <Modal
        open
        onClose={onClose}
        aria-label={`Note for ${line.itemName}`}
        className="m-auto w-[min(92vw,28rem)] rounded-2xl p-5"
      >
        <h2 className="text-lg font-black">Note for {line.itemName}</h2>
        <p className="mt-2 text-sm text-content-muted">
          Already made, so its note can't change. Add another to note it.
        </p>
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" size="phone" onClick={onClose}>
            Close
          </Button>
        </div>
      </Modal>
    )
  return (
    <Modal
      open
      onClose={onClose}
      aria-label={`Note for ${line.itemName}`}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl p-5"
    >
      <h2 className="text-lg font-black">
        {made > 0
          ? `Note for the ${line.quantity} ${line.itemName} not made yet`
          : `Note for ${line.itemName}`}
      </h2>
      {made > 0 && (
        <p className="mt-1 text-sm text-content-muted">
          {made === 1
            ? 'The 1 already made keeps its note.'
            : `The ${made} already made keep their note.`}
        </p>
      )}
      <div className="my-3 flex flex-wrap gap-2">
        {rankedNotes(counts).map((quick) => (
          <Button key={quick} variant="secondary" size="phone" onClick={() => setNote(quick)}>
            {quick}
          </Button>
        ))}
      </div>
      <label className="block text-sm font-bold" htmlFor="dish-note">
        Dish note
      </label>
      <input
        id="dish-note"
        autoFocus
        value={note}
        maxLength={60}
        onChange={(event) => setNote(event.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-content focus-visible:focus-ring"
      />
      <p className="mt-1 text-xs text-content-muted">{note.length}/60 · Kitchen and counter only</p>
      {line.quantity >= 2 && (
        <fieldset className="mt-4 flex gap-4">
          <legend className="mb-2 text-sm font-bold">Apply to</legend>
          <label className="flex min-h-10 items-center gap-2">
            <input
              type="radio"
              name="note-scope"
              checked={!onlyOne}
              onChange={() => setOnlyOne(false)}
            />
            All {line.quantity}
          </label>
          <label className="flex min-h-10 items-center gap-2">
            <input
              type="radio"
              name="note-scope"
              checked={onlyOne}
              onChange={() => setOnlyOne(true)}
            />
            Only 1
          </label>
        </fieldset>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" size="phone" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="phone"
          onClick={() => {
            const saved = note.trim() || null
            if (saved) {
              try {
                localStorage.setItem(
                  NOTE_STORAGE_KEY,
                  JSON.stringify({ ...counts, [saved]: (counts[saved] ?? 0) + 1 }),
                )
              } catch {
                /* Local convenience only. */
              }
            }
            onSave(saved, onlyOne)
          }}
        >
          Save note
        </Button>
      </div>
    </Modal>
  )
}
