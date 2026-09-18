import { Check } from 'lucide-react'

import { cn } from '@/lib/cn'

/**
 * One of a pipeline card's two answers, drawn as a checkbox inside a button.
 *
 * The rail's job at a glance is to say **what is true**, not what to press
 * next. So the label names the fact — `Prepared`, `Paid` — and never the verb
 * for the next press: a control that told you the verb would have to change its
 * word every time it was used, which is exactly the churn #55 exists to remove.
 * `Reprepare` and `Un-pay` are gone as words for that reason, not renamed.
 *
 * Colour states the fact rather than the next step. Unchecked is an ordinary
 * secondary control with the box outlined in the tone's own colour; checked
 * floods the whole control with that colour and redraws the box and its mark in
 * **that control's own foreground token** (`--on-primary`, `--on-success`), so
 * the mark inherits a ratio the contrast validator already gates instead of a
 * fixed grey that would be muddy on dark flame orange and weak on light ember.
 *
 * Checked and unchecked differ in **shape** as well as colour — an empty square
 * against a ticked one — which is what survives a greasy tablet in daylight and
 * a biller who does not see the two hues apart.
 *
 * Not a real checkbox input, deliberately: Paid opens the tender dialog on the
 * way in and a reasoned take-back on the way out, so a form control firing its
 * change event before the change had happened would lie to assistive technology
 * as well as to the eye. It is a toggle **button** carrying `aria-pressed`.
 */
export type StateToggleTone = 'primary' | 'success'

const TONE: Record<StateToggleTone, { fill: string; outline: string; mark: string }> = {
  primary: {
    fill: 'bg-primary text-on-primary',
    outline: 'border-primary text-primary',
    mark: 'text-primary',
  },
  success: {
    fill: 'bg-success text-on-success',
    outline: 'border-success text-success',
    mark: 'text-success',
  },
}

/**
 * The box itself, which inverts when it is ticked.
 *
 * Unchecked it is an outline in the tone's own colour on the control's ground.
 * Checked **on a filled control** it becomes a solid square of that control's
 * foreground token with the tick cut out of it in the tone — white box, ember
 * tick — rather than an outlined box with a tick of the same colour as its
 * border. Solid reads as ticked from further away, and the tick keeps the
 * accent that says which of the two facts this control is about, so the box
 * carries both the state and the tone instead of only the state.
 *
 * The pair is `--primary` on `--on-primary` (and the success equivalent), which
 * is the same two colours the validator already gates as a button's own label —
 * the same ratio, read the other way round.
 */
function StateBox({
  checked,
  className,
  markClassName,
}: {
  checked: boolean
  className?: string
  markClassName?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[4px] border-2',
        className,
      )}
    >
      {checked && <Check size={13} strokeWidth={4} className={markClassName} />}
    </span>
  )
}

export function StateToggle({
  label,
  tone,
  checked,
  /**
   * False where this tablet cannot change the fact — in the pipeline that means
   * another till's order, and nothing else. Drawn then as a statement printed
   * on the card: no border, no press affordance, not a button, and no
   * `aria-pressed` to misreport. Never a dimmed button, which is a promise the
   * screen is refusing to keep and which billers read as breakage.
   */
  interactive = true,
  disabled = false,
  onActivate,
  testId,
}: {
  label: string
  tone: StateToggleTone
  checked: boolean
  interactive?: boolean
  disabled?: boolean
  onActivate?: () => void
  testId?: string
}) {
  const tokens = TONE[tone]

  if (!interactive) {
    return (
      <span
        {...(testId ? { 'data-testid': testId } : {})}
        data-state={checked ? 'recorded' : 'unrecorded'}
        data-fact
        className="flex h-9 flex-1 items-center justify-center gap-2 px-3 text-base font-semibold text-content"
      >
        {/*
          The fact variant keeps the tone in the box's fill rather than in its
          tick. It has no coloured control behind it, so an inverted box would
          be a white square on a pale card — the one ground where inverting
          takes the state away instead of sharpening it.
        */}
        <StateBox
          checked={checked}
          className={checked ? cn(tokens.fill, 'border-transparent') : tokens.outline}
        />
        {label}
      </span>
    )
  }

  return (
    <button
      type="button"
      {...(testId ? { 'data-testid': testId } : {})}
      aria-pressed={checked}
      data-state={checked ? 'recorded' : 'unrecorded'}
      disabled={disabled}
      onClick={onActivate}
      className={cn(
        'inline-flex h-9 flex-1 select-none items-center justify-center gap-2 rounded-lg px-3',
        'text-base font-semibold transition-[filter,background-color]',
        'disabled:pointer-events-none disabled:opacity-50 focus-visible:focus-ring',
        checked
          ? cn(tokens.fill, 'hover:brightness-95')
          : cn('border border-border bg-surface text-content hover:bg-surface-raised'),
      )}
    >
      <StateBox
        checked={checked}
        className={checked ? 'border-current bg-current' : cn(tokens.outline, 'bg-surface')}
        {...(checked ? { markClassName: tokens.mark } : {})}
      />
      {label}
    </button>
  )
}
