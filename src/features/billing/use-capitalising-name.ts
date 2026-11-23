import { useEffect, useLayoutEffect, useRef, type ChangeEvent } from 'react'
import { flushSync } from 'react-dom'

import { capitalisedName, capitalisedWord, isWordSpace } from '@/domain'

/**
 * The counter's name field, capitalising a new customer's name as each word is
 * finished (a-customer-name-is-capitalised, design D2). The on path of
 * `customer-names-capitalised`; the off path is the field as it always was.
 *
 * **A word is finished** when a space is typed after it, when the biller
 * pauses, or when the box is confirmed. The field then shows `capitalisedWord`
 * of what was typed for it, in the field itself, with no line or button beside
 * it [owner, 2026-11-23].
 *
 * **Judged from what was typed, not from what is shown.** The hook keeps, for
 * every character in the field, the character the biller typed there. A
 * correction changes case only, so the two always have the same length, and a
 * word the biller carries on typing after a pause is judged again whole: `RAH`,
 * a pause and `UL` reads `Rahul`, never `RahUL`.
 *
 * **The cursor never moves** [owner, 2026-11-23], and this outranks correcting:
 * a correction that cannot promise it is skipped, and the word left as typed.
 * The five ways a cursor jumps in a corrected input, and the guard for each:
 *
 *   1. The text changes length. Corrections change case only, letter for
 *      letter (`capitalisedWord` leaves `ß` and a dotted `İ` alone), and
 *      spacing is tidied only in the name saved, never in the field.
 *   2. React puts the caret at the end when it sets a value from code. The
 *      selection, direction included, is put back before paint.
 *   3. A key lands between the decision and the change. The pause applies only
 *      while the field still holds exactly the value it was worked out from,
 *      and applies synchronously, so there is no gap for another key.
 *   4. The keyboard is composing. Nothing changes between `compositionstart`
 *      and `compositionend`: changing the value mid-composition makes an
 *      Android keyboard re-insert its word somewhere else.
 *   5. The cursor is not at the end. A pause corrects only with the cursor at
 *      the end of the text and nothing selected; a space corrects only the word
 *      behind it, so nothing after the cursor shifts.
 *
 * **Going back turns it off** [owner, 2026-11-23]. Deleting a character of a
 * word the box changed, or typing anywhere in it but at its end, stops all
 * correction until the box closes, confirm included: the name saved is then
 * exactly what the field shows, trimmed. Deleting only the space after such a
 * word, fixing a typo in a word the box has not changed, and moving the cursor
 * stop nothing.
 */

/** How long a pause finishes the word at the cursor. Tuned on the counter tablet. */
export const NAME_PAUSE_MS = 900

/** One edit to the field: `deleted` characters at `start` replaced by `inserted`. */
interface Edit {
  start: number
  deleted: number
  inserted: string
}

interface Selection {
  value: string
  start: number | null
  end: number | null
  direction: 'forward' | 'backward' | 'none' | null
}

export function useCapitalisingName(name: string, setName: (name: string) => void) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** The value the hook last knew the field to hold. */
  const known = useRef(name)
  /** What the biller typed, character for character with `known`. */
  const typed = useRef(name)
  /** Whether each character belongs to a word the box changed. */
  const changed = useRef<boolean[]>(Array.from({ length: name.length }, () => false))
  const stopped = useRef(false)
  const composing = useRef(false)
  const timer = useRef<number | null>(null)
  /** The selection to put back once a correction has been rendered. */
  const restore = useRef<Selection | null>(null)
  /** The value last rendered, for the pause timer, which outlives its render. */
  const rendered = useRef(name)

  /** A value set from outside the hook is taken as typed, and nothing in it as changed. */
  function reconcile(current: string) {
    if (known.current === current) return
    known.current = current
    typed.current = current
    changed.current = Array.from({ length: current.length }, () => false)
  }

  function clearPause() {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  function schedulePause() {
    clearPause()
    timer.current = window.setTimeout(finishAtPause, NAME_PAUSE_MS)
  }

  /*
    Every word through `capitalisedWord`, judged from what was typed, and which
    of them the box has now changed. Same length as `typed`, always.
  */
  function correctWords(from: number, to: number, shown: string): string {
    let next = shown
    let index = from
    while (index < to) {
      if (isWordSpace(typed.current[index]!)) {
        index += 1
        continue
      }
      let end = index
      while (end < to && !isWordSpace(typed.current[end]!)) end += 1
      const word = typed.current.slice(index, end)
      const fixed = capitalisedWord(word)
      if (fixed.length === word.length) {
        next = next.slice(0, index) + fixed + next.slice(end)
        for (let i = index; i < end; i += 1) changed.current[i] = fixed !== word
      }
      index = end
    }
    return next
  }

  function finishAtPause() {
    timer.current = null
    const field = inputRef.current
    if (field === null || stopped.current || composing.current) return
    // Guard 2's premise: a selection is put back only on a focused field.
    if (document.activeElement !== field) return
    const current = rendered.current
    // Guard 3: a key that has reached the field and not yet been handled.
    if (field.value !== current) return
    // Guard 5: only with the cursor at the very end and nothing selected.
    if (field.selectionStart !== field.selectionEnd || field.selectionEnd !== current.length) return
    reconcile(current)
    const shown = correctWords(0, current.length, current)
    if (shown === current) return
    restore.current = {
      value: shown,
      start: field.selectionStart,
      end: field.selectionEnd,
      direction: field.selectionDirection,
    }
    known.current = shown
    // Rendered before this callback returns, so no key can land in between.
    flushSync(() => setName(shown))
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const field = event.currentTarget
    const next = field.value
    reconcile(name)
    schedulePause()
    if (stopped.current) {
      known.current = next
      setName(next)
      return
    }
    const edit = locateEdit(known.current, next, field.selectionStart, field.selectionEnd)
    const goesBack =
      changed.current.slice(edit.start, edit.start + edit.deleted).some(Boolean) ||
      (edit.inserted !== '' && changed.current[edit.start] === true)
    if (goesBack) {
      stopped.current = true
      clearPause()
      known.current = next
      setName(next)
      return
    }
    typed.current =
      typed.current.slice(0, edit.start) +
      edit.inserted +
      typed.current.slice(edit.start + edit.deleted)
    changed.current = [
      ...changed.current.slice(0, edit.start),
      ...Array.from({ length: edit.inserted.length }, () => false),
      ...changed.current.slice(edit.start + edit.deleted),
    ]
    let shown = next
    const typingSpace =
      edit.deleted === 0 && edit.inserted.length === 1 && isWordSpace(edit.inserted)
    // Guard 4: never while composing; guard 5: only the word behind the space.
    if (typingSpace && !composing.current && !isComposing(event)) {
      let start = edit.start
      while (start > 0 && !isWordSpace(typed.current[start - 1]!)) start -= 1
      shown = correctWords(start, edit.start, next)
    }
    known.current = shown
    if (shown !== next) {
      restore.current = {
        value: shown,
        start: field.selectionStart,
        end: field.selectionEnd,
        direction: field.selectionDirection,
      }
    }
    setName(shown)
  }

  // Guard 2: put the selection back, before paint, wherever a correction was
  // rendered. Runs after every render, and acts only on the value it is for.
  useLayoutEffect(() => {
    rendered.current = name
    const want = restore.current
    if (want === null) return
    restore.current = null
    const field = inputRef.current
    if (field === null || field.value !== want.value || document.activeElement !== field) return
    if (want.start === null || want.end === null) return
    if (
      field.selectionStart !== want.start ||
      field.selectionEnd !== want.end ||
      field.selectionDirection !== want.direction
    ) {
      field.setSelectionRange(want.start, want.end, want.direction ?? undefined)
    }
  })

  useEffect(() => clearPause, [])

  return {
    /** Spread onto the name input on the on path. */
    field: {
      ref: inputRef,
      value: name,
      onChange,
      onCompositionStart: () => {
        composing.current = true
      },
      onCompositionEnd: () => {
        composing.current = false
        schedulePause()
      },
    },
    /**
     * The name to save: capitalised word by word as typed, trimmed, with single
     * spaces; or, once the biller has gone back, exactly what the field shows,
     * trimmed.
     */
    savedName(): string {
      reconcile(name)
      return stopped.current ? name.trim() : capitalisedName(typed.current)
    },
  }
}

function isComposing(event: ChangeEvent<HTMLInputElement>): boolean {
  return (event.nativeEvent as InputEvent).isComposing === true
}

/**
 * Where one input event changed the field. The caret after an edit sits at the
 * end of what was inserted, which places an insertion that a plain diff could
 * put in several places (`a` typed into `aa`); a diff is the fallback when the
 * caret does not fit.
 */
export function locateEdit(
  previous: string,
  next: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): Edit {
  if (selectionStart !== null && selectionStart === selectionEnd && selectionStart <= next.length) {
    const caret = selectionStart
    const suffix = next.length - caret
    if (
      suffix <= previous.length &&
      previous.slice(previous.length - suffix) === next.slice(caret)
    ) {
      const limit = Math.min(caret, previous.length - suffix)
      let start = 0
      while (start < limit && previous[start] === next[start]) start += 1
      return {
        start,
        deleted: previous.length - suffix - start,
        inserted: next.slice(start, caret),
      }
    }
  }
  const limit = Math.min(previous.length, next.length)
  let start = 0
  while (start < limit && previous[start] === next[start]) start += 1
  let suffix = 0
  while (
    suffix < limit - start &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1
  }
  return {
    start,
    deleted: previous.length - suffix - start,
    inserted: next.slice(start, next.length - suffix),
  }
}
