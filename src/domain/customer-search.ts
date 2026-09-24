/**
 * How the owner's customer search matches, in one place (a-gold-member-is-a-label).
 *
 * The adapter uses it to decide who is a result, and the screen uses it to bold
 * the part of each result that matched. One module, so the two can never
 * disagree about why somebody is on the list.
 *
 * Three kinds of match, strongest first:
 *
 *   - **digits** — three or more (spaces, dashes and a pasted `+91` allowed),
 *     found as one run anywhere in the ten-digit number, so the last few
 *     somebody remembers are enough;
 *   - **name** — three or more characters found as one run anywhere in the
 *     saved name, ignoring case;
 *   - **name, loosely** — the same characters in the same order with gaps
 *     between them, so `mmta` still finds `Moumta`. Tried only for a name, and
 *     only when the exact matches leave room [owner, 2026-09-24]. Never for a
 *     number: three digits in order occur somewhere in most ten-digit numbers,
 *     so a loose number match would answer with nearly everybody.
 *
 * **Three of either** [owner, 2026-09-24] — one minimum, so nobody has to
 * remember which kind of query needs how many.
 */

export const CUSTOMER_SEARCH_MIN_LETTERS = 3
export const CUSTOMER_SEARCH_MIN_DIGITS = 3

export type CustomerQuery =
  | { kind: 'digits'; digits: string }
  | { kind: 'name'; needle: string }
  /** Too short to be an answer; nobody is asked. */
  | { kind: 'too-short' }

export function parseCustomerQuery(query: string): CustomerQuery {
  const trimmed = query.trim()
  if (/^[+\d\s-]+$/.test(trimmed)) {
    let digits = trimmed.replace(/\D/g, '')
    // `+91` is the country, never part of what is being looked for — typed at
    // the start of a half-number as much as pasted on a whole one. Without the
    // plus, `91` counts only when it makes the number longer than ten digits.
    if ((trimmed.startsWith('+') || digits.length > 10) && digits.startsWith('91')) {
      digits = digits.slice(2)
    }
    return digits.length >= CUSTOMER_SEARCH_MIN_DIGITS
      ? { kind: 'digits', digits }
      : { kind: 'too-short' }
  }
  const needle = trimmed.toLocaleLowerCase('en-IN')
  return needle.length >= CUSTOMER_SEARCH_MIN_LETTERS
    ? { kind: 'name', needle }
    : { kind: 'too-short' }
}

/** How strongly a customer matched: 0 is exact, 1 is loose, null is not at all. */
export function customerMatchStrength(
  query: CustomerQuery,
  customer: { name: string | null; phone: string },
): 0 | 1 | null {
  if (query.kind === 'digits') return customer.phone.slice(-10).includes(query.digits) ? 0 : null
  if (query.kind === 'too-short') return null
  const name = (customer.name ?? '').toLocaleLowerCase('en-IN')
  if (name.includes(query.needle)) return 0
  return subsequenceIndices(name, query.needle) === null ? null : 1
}

/** One run of text, and whether it is part of what matched. */
export interface MatchSegment {
  text: string
  matched: boolean
}

/**
 * A saved name cut into the parts that matched the query and the parts that
 * did not — one run for an exact match, scattered letters for a loose one.
 */
export function highlightName(name: string, query: CustomerQuery): MatchSegment[] {
  if (query.kind !== 'name') return [{ text: name, matched: false }]
  const lower = name.toLocaleLowerCase('en-IN')
  const at = lower.indexOf(query.needle)
  const indices =
    at >= 0
      ? Array.from({ length: query.needle.length }, (_, offset) => at + offset)
      : subsequenceIndices(lower, query.needle)
  return segments(name, new Set(indices ?? []))
}

/**
 * A number as the screen writes it — `90000 00104` — with the matched digits
 * marked. The display's space is stepped over, so a match straddling it is
 * still one bold run with an ordinary space inside.
 */
export function highlightPhone(formatted: string, query: CustomerQuery): MatchSegment[] {
  if (query.kind !== 'digits') return [{ text: formatted, matched: false }]
  const digitPositions = [...formatted].flatMap((character, index) =>
    /\d/.test(character) ? [index] : [],
  )
  const digits = digitPositions.map((index) => formatted[index]).join('')
  const at = digits.indexOf(query.digits)
  if (at < 0) return [{ text: formatted, matched: false }]
  const first = digitPositions[at]!
  const last = digitPositions[at + query.digits.length - 1]!
  const marked = new Set<number>()
  for (let index = first; index <= last; index += 1) marked.add(index)
  return segments(formatted, marked)
}

/** Where each character of `needle` sits in `haystack`, taken in order, or null. */
function subsequenceIndices(haystack: string, needle: string): number[] | null {
  const found: number[] = []
  let from = 0
  for (const character of needle) {
    const at = haystack.indexOf(character, from)
    if (at < 0) return null
    found.push(at)
    from = at + 1
  }
  return found
}

function segments(text: string, marked: ReadonlySet<number>): MatchSegment[] {
  const out: MatchSegment[] = []
  for (const [index, character] of [...text].entries()) {
    const matched = marked.has(index)
    const last = out.at(-1)
    if (last && last.matched === matched) last.text += character
    else out.push({ text: character, matched })
  }
  return out
}
