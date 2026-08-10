/**
 * Near-match detection for free-text category names.
 *
 * A category is typed rather than chosen, so the way it fails is a near miss:
 * "Shwarma" beside "Shawarma" splits one group into two at the counter, and
 * once both exist nothing downstream can tell they were meant to be one. So the
 * comparison happens before the write, and it has to be generous enough to
 * catch a tired thumb on a phone at the end of a shift.
 *
 * Everything here is folded first — case, accents, punctuation and spacing all
 * removed — and then read for the four shapes a mistyped category actually
 * takes. Order matters to the caller: the reasons are ranked by how likely each
 * is to be the word the person meant.
 */

export type CategoryMatchReason = 'same' | 'plural' | 'typo' | 'contains'

export interface CategoryMatch {
  /** The existing category, spelled as it is already stored. */
  name: string
  /**
   * Why it matched. Not shown: a line of explanation under each candidate turns
   * a three-word decision into a paragraph. It orders them instead.
   */
  reason: CategoryMatchReason
}

/** How many candidates are worth reading before a decision stops being one. */
const MAX_MATCHES = 5

const REASON_RANK: Record<CategoryMatchReason, number> = {
  same: 0,
  plural: 1,
  typo: 2,
  contains: 3,
}

/**
 * The one comparison key. Diacritics are stripped so "Café" meets "Cafe",
 * punctuation becomes a gap so "Non-Veg" meets "Non Veg", and the result is
 * never stored — only compared.
 */
export function foldCategory(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function squash(folded: string): string {
  return folded.replace(/ /gu, '')
}

function words(folded: string): string[] {
  return folded === '' ? [] : folded.split(' ')
}

/**
 * How far apart two words may be and still read as one typo. Short words are
 * held tight because at three letters almost everything is within two edits;
 * "Rolls" must not be offered as a correction for "Bowls".
 */
function typoAllowance(shortest: number): number {
  if (shortest <= 3) return 0
  if (shortest <= 5) return 1
  if (shortest <= 9) return 2
  return 3
}

/**
 * A typo rarely destroys the first letter — fingers land in the wrong place
 * after the word has started, not before it. So agreement there buys one more
 * edit of latitude, which is what separates "shwarnm" from "Shawarma" (three
 * edits, plainly the same word) from "Bowls" against "Rolls" (two edits, two
 * different words). Widening the allowance for everything would have admitted
 * both.
 */
function allowanceFor(a: string, b: string): number {
  const base = typoAllowance(Math.min(a.length, b.length))
  return base > 0 && a[0] === b[0] ? base + 1 : base
}

/**
 * Optimal string alignment distance — Levenshtein plus adjacent transposition,
 * because "Bugrers" for "Burgers" is one slip of two fingers, not two errors.
 * Bounded so a long pair stops counting once it is already too far apart.
 */
function editDistance(a: string, b: string, limit: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = new Array<number>(b.length + 1)
  let current = new Array<number>(b.length + 1)
  let beforePrevious = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j += 1) previous[j] = j

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    let best = current[0]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (beforePrevious[j - 2] ?? 0) + 1)
      }
      current[j] = value
      if (value < best) best = value
    }
    if (best > limit) return limit + 1
    const spare = beforePrevious
    beforePrevious = previous
    previous = current
    current = spare
  }
  return previous[b.length] ?? limit + 1
}

function isPluralOf(plural: string, singular: string): boolean {
  if (plural === `${singular}s` || plural === `${singular}es`) return true
  return singular.endsWith('y') && plural === `${singular.slice(0, -1)}ies`
}

function pluralAlike(a: string, b: string): boolean {
  return isPluralOf(a, b) || isPluralOf(b, a)
}

function typoAlike(a: string, b: string): boolean {
  const allowance = allowanceFor(a, b)
  if (allowance === 0) return false
  return editDistance(a, b, allowance) <= allowance
}

/** Same number of words, every word the singular or plural of its partner. */
function pluralPhrase(a: string, b: string): boolean {
  const left = words(a)
  const right = words(b)
  if (left.length === 0 || left.length !== right.length) return false
  let differed = false
  for (const [index, word] of left.entries()) {
    const other = right[index] ?? ''
    if (word === other) continue
    if (!pluralAlike(word, other)) return false
    differed = true
  }
  return differed
}

/**
 * Every word of the shorter name appears in the longer one, allowing for a
 * plural or a typo on the way — so "Shwarma" finds "Shawarma Rolls" and "Roll"
 * finds "Chicken Rolls". Single letters are ignored: they match everything and
 * mean nothing.
 */
function containsPhrase(a: string, b: string): boolean {
  const left = words(a)
  const right = words(b)
  if (left.length === right.length) return false
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  const meaningful = shorter.filter((word) => word.length >= 3)
  if (meaningful.length === 0) return false
  return meaningful.every((word) =>
    longer.some((other) => word === other || pluralAlike(word, other) || typoAlike(word, other)),
  )
}

function reasonFor(typed: string, existing: string): CategoryMatchReason | null {
  if (typed === existing) return 'same'
  if (pluralPhrase(typed, existing)) return 'plural'
  if (typoAlike(squash(typed), squash(existing))) return 'typo'
  if (containsPhrase(typed, existing)) return 'contains'
  return null
}

/**
 * The existing categories a typed one might have meant, best first. An empty
 * result is the licence to create the typed category without asking: a
 * confirmation shown for every new category is read for none of them.
 *
 * A candidate whose folded form is identical to the typed one is still
 * returned, under `same` — the database resolves case and surrounding space,
 * but not accents, punctuation or internal spacing, so "Non-Veg" beside
 * "Non Veg" is a genuine split this is the only thing standing in front of.
 */
export function matchCategory(
  typed: string,
  existing: readonly string[],
  limit: number = MAX_MATCHES,
): CategoryMatch[] {
  const folded = foldCategory(typed)
  if (folded === '') return []

  const seen = new Set<string>()
  const matches: CategoryMatch[] = []
  for (const candidate of existing) {
    const key = foldCategory(candidate)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    const reason = reasonFor(folded, key)
    if (reason) matches.push({ name: candidate, reason })
  }

  return matches
    .sort(
      (a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || a.name.localeCompare(b.name, 'en'),
    )
    .slice(0, limit)
}
