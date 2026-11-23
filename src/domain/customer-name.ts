/**
 * How a customer's name is capitalised, in one place
 * (a-customer-name-is-capitalised, design D1).
 *
 * The counter's name field uses it as each word is finished, and the one-time
 * correction of the names already saved uses it too, so the two can never
 * disagree about which names read wrongly. It imports nothing, so Node can load
 * it with its types stripped.
 *
 * **Word by word** [owner, 2026-11-22]. A word is a run of characters between
 * spaces, and it is capitalised when any one of these holds:
 *
 *   - every cased letter in it is lowercase (`rahul`, `md`, `a`);
 *   - every cased letter is uppercase and there are three or more of them
 *     (`RAHUL`; not `MD`, `SK`, `AK`, which are usually initials);
 *   - it is one lowercase letter followed by two or more uppercase ones, the
 *     shape caps lock leaves (`rAHUL`).
 *
 * Anything else is left exactly as typed: mixed case (`McKenzie`, `d'Souza`,
 * `MOhan`) is taken as meant, and a word with no cased letters (Bengali,
 * digits) has nothing to change.
 *
 * **A correction changes case and nothing else.** Every character keeps its
 * index, because the field corrects a word while the biller is typing beside it
 * and a correction that shifted anything could move their cursor. A word whose
 * case mapping would change its length (`ß`, a dotted `İ`) is left alone.
 */

const UPPER = /^\p{Lu}$/u
const LOWER = /^\p{Ll}$/u
/** A titlecase letter (`ǅ`) is cased but neither: its word is left alone. */
const TITLE = /\p{Lt}/u
/**
 * What does not start a new capital: a letter, a digit, or a mark riding on
 * one. Postgres `initcap`'s boundary, so `d'souza` reads `D'Souza` and `a8aaa`
 * reads `A8aaa`.
 */
const CONTINUES_WORD = /^[\p{L}\p{N}\p{M}]$/u
const WHITESPACE = /\s/u
const WORD = /\S+/gu

/** Whether every character keeps its length under both case mappings. */
function caseMappingKeepsLength(word: string): boolean {
  for (const character of word) {
    const lower = character.toLowerCase()
    const upper = character.toUpperCase()
    if (lower.length !== character.length || upper.length !== character.length) return false
    if ([...lower].length !== 1 || [...upper].length !== 1) return false
  }
  return true
}

/** Whether a word, judged as typed, should be capitalised at all. */
function readsInOneCase(word: string): boolean {
  if (TITLE.test(word)) return false
  const cased = [...word].filter((character) => UPPER.test(character) || LOWER.test(character))
  if (cased.length === 0) return false
  if (cased.every((character) => LOWER.test(character))) return true
  if (cased.length >= 3 && cased.every((character) => UPPER.test(character))) return true
  const [first, ...rest] = cased
  return (
    first !== undefined &&
    LOWER.test(first) &&
    rest.length >= 2 &&
    rest.every((character) => UPPER.test(character))
  )
}

/**
 * The word to show instead of `word`, or `word` itself when it is to be left
 * alone. Never a different length, and never different except in case.
 */
export function capitalisedWord(word: string): string {
  if (word === '' || !readsInOneCase(word) || !caseMappingKeepsLength(word)) return word
  let capitalised = ''
  let previous: string | null = null
  for (const character of word) {
    const startsCapital = previous === null || !CONTINUES_WORD.test(previous)
    capitalised += startsCapital ? character.toUpperCase() : character.toLowerCase()
    previous = character
  }
  // Belt and braces: the promise is case only, letter for letter.
  return capitalised.length === word.length ? capitalised : word
}

/**
 * Every word of `text` through `capitalisedWord`, with every space left exactly
 * where it is: the same length, character for character. What the name field
 * shows once its words are finished.
 */
export function capitalisedWords(text: string): string {
  return text.replace(WORD, (word) => capitalisedWord(word))
}

/**
 * A whole name as it is saved: every word capitalised, trimmed, and runs of
 * spaces collapsed to one. What the counter saves on confirm, and what the
 * one-time correction compares each saved name with.
 */
export function capitalisedName(name: string): string {
  return (name.match(WORD) ?? []).map(capitalisedWord).join(' ')
}

/** Whether a character separates two words. */
export function isWordSpace(character: string): boolean {
  return WHITESPACE.test(character)
}
