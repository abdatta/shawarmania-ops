import { useEffect, type RefObject } from 'react'

/**
 * Open modals, innermost last. Every `Modal` registers, keypad or not, so a
 * confirmation opened over a pad takes the keyboard away from the pad under it.
 */
const openDialogs: HTMLDialogElement[] = []

/**
 * A physical keyboard on an on-screen number pad [owner, 2026-10-06].
 *
 * Some counters bill from a laptop, or a tablet with a keyboard attached, and a
 * biller with keys under their hands should not have to reach for the screen
 * for every digit. So a typed key **presses the pad's own button**, the one
 * marked `data-keypad-key` with that key's name: a digit, `.`, `Backspace`, or
 * `Enter` for the dialog's primary action. Pressing the real button, rather
 * than reimplementing what it does, is what keeps every limit the pad already
 * has — a disabled key typed is a disabled key tapped.
 *
 * **Nothing here is a text field, and that is the point.** The pads carry none
 * so that a touch screen never raises its own keyboard over them; key events
 * only ever come from a keyboard that is really there.
 *
 * Left alone: a dialog with no marked keys, any dialog but the innermost, a key
 * typed into a real field (the customer's name), and any key with a modifier.
 */
export function useKeypadKeys(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    if (import.meta.env.DEV) reportKeypadGaps(dialog)
    openDialogs.push(dialog)

    /*
      Whether focus was last moved with Tab. Enter on a control somebody tabbed
      to is theirs, as it is everywhere else; Enter on a key the mouse happened
      to leave focused is not, or it would press that digit again.
    */
    let tabbed = false
    const onPointerDown = () => {
      tabbed = false
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Tab') tabbed = true
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (openDialogs.at(-1) !== dialog) return

      const name = keypadKeyName(event)
      if (name === null || isTextEntry(event.target)) return
      const keys = ownKeys(dialog!)
      if (keys.length === 0) return

      if (name === 'Enter') {
        const control = event.target instanceof Element ? event.target.closest('button, a') : null
        if (control && tabbed) return
        /*
          Taken even when the primary action is disabled, so a focused key never
          answers Enter instead. And a held Enter acts once: the repeats would
          otherwise confirm straight through whichever dialog opens next.
        */
        event.preventDefault()
        if (event.repeat) return
      }

      const button = keys.find((key) => key.dataset.keypadKey === name)
      if (!button || button.disabled) return
      event.preventDefault()
      button.click()
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      openDialogs.splice(openDialogs.indexOf(dialog), 1)
    }
  }, [ref, open])
}

/**
 * The pad key a keyboard key stands for: top row and number pad alike. The
 * number pad is read by position, so it types digits with Num Lock off too,
 * where its keys would otherwise arrive as arrows and Page Up.
 */
function keypadKeyName(event: KeyboardEvent): string | null {
  if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(-1)
  if (/^[0-9]$/.test(event.key)) return event.key
  if (event.key === '.' || event.code === 'NumpadDecimal') return '.'
  if (event.key === 'Backspace' || event.key === 'Enter') return event.key
  return null
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest('input, textarea, select') !== null
}

/** This dialog's marked keys, and not those of a dialog nested inside it. */
function ownKeys(dialog: HTMLDialogElement): HTMLButtonElement[] {
  return [...dialog.querySelectorAll<HTMLButtonElement>('button[data-keypad-key]')].filter(
    (key) => key.closest('dialog') === dialog,
  )
}

/**
 * What a number pad in this dialog is missing for a physical keyboard, as
 * sentences; empty when nothing is, or when the dialog draws no pad.
 *
 * **A pad is recognised by its digits, not by a name or a label**: ten buttons
 * reading 0 to 9 are a number pad whatever they are called, so a pop-up added
 * later cannot opt out by naming its pad differently. Each digit must be marked
 * with itself, and the dialog must mark a Backspace key and its Enter action.
 */
export function keypadGaps(dialog: HTMLDialogElement): string[] {
  const own = [...dialog.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) => button.closest('dialog') === dialog,
  )
  const digits = own.filter((button) => /^[0-9]$/.test(button.textContent?.trim() ?? ''))
  if (new Set(digits.map((button) => button.textContent!.trim())).size < 10) return []

  const gaps: string[] = []
  for (const button of digits) {
    const digit = button.textContent!.trim()
    if (button.dataset.keypadKey !== digit) {
      gaps.push(`the ${digit} key is not marked data-keypad-key="${digit}"`)
    }
  }
  for (const key of ['Backspace', 'Enter']) {
    if (!own.some((button) => button.dataset.keypadKey === key)) {
      gaps.push(`no button is marked data-keypad-key="${key}"`)
    }
  }
  return gaps
}

/**
 * Every pad takes a keyboard, and a new one that does not is caught where it is
 * built: a test that opens it fails, and a dev build says so in the console.
 * Production never pays for the check. `npm run lint:keypads` covers the pad
 * nobody has written a test for.
 */
function reportKeypadGaps(dialog: HTMLDialogElement) {
  const gaps = keypadGaps(dialog)
  if (gaps.length === 0) return
  const name = dialog.getAttribute('aria-label') ?? 'A dialog'
  const message = `${name} draws a number pad a physical keyboard cannot reach: ${gaps.join('; ')}. Mark its keys as described in use-keypad-keys.ts.`
  if (import.meta.env.MODE === 'test') throw new Error(message)
  console.error(message)
}
