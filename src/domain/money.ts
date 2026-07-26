/**
 * Money formatting. Pure, no I/O.
 *
 * Money is integer paise everywhere in this system. Floats are never stored,
 * passed, or arithmetic'd — `0.1 + 0.2` problems in a cash-reconciliation app
 * are unacceptable. Conversion to rupees happens here, at the display edge,
 * and nowhere else.
 */

/** Thrown when a value that must be integer paise is not. */
export class NotPaiseError extends TypeError {
  constructor(value: number) {
    super(
      `Expected integer paise, received ${String(value)}. ` +
        `Money is integer paise; a fractional value means a float leaked into the money path.`,
    )
    this.name = 'NotPaiseError'
  }
}

function assertPaise(paise: number): void {
  if (!Number.isInteger(paise)) throw new NotPaiseError(paise)
}

/**
 * Indian digit grouping: last three digits, then twos.
 * `en-IN` gets this right, so we use it rather than hand-rolling the grouping.
 */
const rupeeGroups = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
})

/**
 * Format integer paise as Indian-grouped rupees: `12345600` -> `₹1,23,456`.
 *
 * Whole-rupee amounts drop the paise part, because the overwhelming majority
 * of counter prices are whole rupees and `₹120.00` down a column is noise.
 * A non-integer input throws rather than rounding: silently accepting a float
 * would launder exactly the bug the integer-paise rule exists to prevent.
 */
export function formatPaise(paise: number): string {
  assertPaise(paise)
  const negative = paise < 0
  const absolute = Math.abs(paise)
  const rupees = Math.trunc(absolute / 100)
  const remainder = absolute % 100

  const formatted = rupeeGroups.format(rupees + remainder / 100)
  const trimmed = remainder === 0 ? formatted.slice(0, -3) : formatted

  return `${negative ? '-' : ''}₹${trimmed}`
}

/** Rupees as a number (for input fields only, never for arithmetic). */
export function paiseToRupees(paise: number): number {
  assertPaise(paise)
  return paise / 100
}

/**
 * Rupees entered by a human -> integer paise. Rounds to the nearest paisa,
 * because a UI can hand us `19.999999999999998` from its own float maths.
 */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) throw new TypeError(`Expected a finite rupee amount, got ${rupees}`)
  return Math.round(rupees * 100)
}
