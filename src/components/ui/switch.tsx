import { cn } from '@/lib/cn'

/**
 * An on/off setting, saying so to a screen reader as a switch.
 *
 * **Not `StateToggle` and not a pressed button.** Those record a fact about an
 * order and name it in words; this turns part of a settings page on, and the
 * page answers by growing the settings that belong under it. `role="switch"`
 * is what tells assistive technology that the control is a setting rather than
 * an action.
 *
 * Every colour is a pair the contrast validator already gates: the on track is
 * `--primary` under an `--on-primary` knob, the pair every primary button uses,
 * and the off track is `--content-muted` under a `--surface` knob, the pair
 * muted text uses. On and off differ in **position** as well as colour, which
 * is what survives a reader who does not see the two hues apart.
 *
 * The whole 44px row height is the target, not the 24px track: a settings page
 * is used on a phone.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  testId,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** What the switch turns on, for the accessible name. */
  label: string
  disabled?: boolean
  testId?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...(testId ? { 'data-testid': testId } : {})}
      className={cn(
        'inline-flex h-[var(--size-control-phone)] shrink-0 select-none items-center rounded-full px-1',
        'focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-6 w-11 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-primary' : 'bg-content-muted',
        )}
      >
        <span
          className={cn(
            'size-5 rounded-full shadow-sm transition-transform motion-reduce:transition-none',
            checked ? 'translate-x-5 bg-on-primary' : 'translate-x-0 bg-surface',
          )}
        />
      </span>
    </button>
  )
}
