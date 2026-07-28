import { cn } from '@/lib/cn'

/**
 * The food-safety marker that says whether an item is vegetarian.
 *
 * **Shape carries it as well as colour.** The familiar Indian mark is a square
 * outline around a dot, green or brown — which is a colour-only distinction, and
 * roughly one man in twelve cannot read it. So the dot becomes a triangle for
 * non-vegetarian, matching the newer convention and giving the two marks
 * genuinely different silhouettes. A text label rides along for anyone reading
 * with their ears.
 *
 * `--marker-veg` and `--marker-nonveg` exist separately from `--success` and
 * `--danger` precisely so a status colour can be corrected without changing what
 * a veg dot looks like (tokens.css).
 */
export function VegMarker({ isVeg, className }: { isVeg: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center', className)}>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className={cn('size-4', isVeg ? 'text-marker-veg' : 'text-marker-nonveg')}
        fill="none"
      >
        <rect
          x="1"
          y="1"
          width="14"
          height="14"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
          data-testid="veg-marker-frame"
        />
        {isVeg ? (
          <circle cx="8" cy="8" r="3.5" fill="currentColor" data-testid="veg-marker-circle" />
        ) : (
          <path d="M8 4.2 12 11.6H4Z" fill="currentColor" data-testid="veg-marker-triangle" />
        )}
      </svg>
      <span className="sr-only">{isVeg ? 'Vegetarian' : 'Non-vegetarian'}</span>
    </span>
  )
}
