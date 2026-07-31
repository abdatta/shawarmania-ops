import { cn } from '@/lib/cn'

/**
 * A badge means one thing everywhere in this app: **somebody is waiting on you**
 * (spec: attention-badges). Not a total, not a status light, not decoration —
 * a count of things that will not resolve until a person does something.
 *
 * **The colour is the Approve button's own pair**, `--primary` / `--on-primary`
 * (design D1). The thing demanding attention and the button that clears it then
 * read as one concern, `--danger` stays reserved for things that are actually
 * wrong, and no new colour pair enters the system: this one is already asserted
 * by `npm run contrast`.
 *
 * **The name is required, not optional.** A badge whose entire job is to be
 * noticed would be the clearest possible violation of the design system's
 * "colour is never the only signal" if it worked only for people who can see
 * it. So `label` is a required prop, the digits are `aria-hidden`, and the
 * sentence a screen reader gets is the one the caller wrote.
 *
 * Above `MAX_COUNT` the badge reads `99+`. A three-digit number would widen it
 * out of the nav entry it is sitting on, and the difference between 100 and 140
 * arrivals is not a difference anybody acts on differently.
 */

/** Past this, the exact number stops being information and starts being width. */
const MAX_COUNT = 99

const SHARED = 'inline-flex items-center justify-center rounded-full bg-primary text-on-primary'

export function Badge({
  count,
  label,
  className,
  ...rest
}: {
  count: number
  /** What is waiting, as a sentence. Required — see above. */
  label: string
  className?: string
} & { 'data-testid'?: string }) {
  // Zero renders nothing, so the absence of a badge always means the same thing
  // (design D5). A negative count is a caller bug, and showing "-1" would be a
  // worse way to report it than showing nothing.
  if (count <= 0) return null

  return (
    <span
      className={cn(SHARED, 'h-5 min-w-5 px-1 text-[0.6875rem] font-bold leading-none', className)}
      {...rest}
    >
      <span aria-hidden>{count > MAX_COUNT ? `${MAX_COUNT}+` : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/**
 * The same signal where a number would not help — a control that leads
 * somewhere holding work, rather than holding it itself. It still carries a
 * name, because a dot nobody can see is not a signal at all.
 */
export function BadgeDot({
  label,
  className,
  ...rest
}: {
  label: string
  className?: string
} & { 'data-testid'?: string }) {
  return (
    <span className={cn(SHARED, 'size-2', className)} {...rest}>
      <span className="sr-only">{label}</span>
    </span>
  )
}
