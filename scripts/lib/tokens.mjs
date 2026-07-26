/**
 * Parse the single token source file into resolved semantic values per theme.
 *
 * This reads the same `src/styles/tokens.css` the application imports, so
 * there is no second token list that can drift out of sync with what ships.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const TOKENS_PATH = fileURLToPath(new URL('../../src/styles/tokens.css', import.meta.url))

/** Strip comments, then pull `selector { --name: value; ... }` blocks out. */
function parseBlocks(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks = []

  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim()
    const declarations = new Map()

    for (const declaration of match[2].split(';')) {
      const separator = declaration.indexOf(':')
      if (separator === -1) continue
      const name = declaration.slice(0, separator).trim()
      if (!name.startsWith('--')) continue
      declarations.set(name, declaration.slice(separator + 1).trim())
    }

    blocks.push({ selector, declarations })
  }

  return blocks
}

function mergeMatching(blocks, predicate) {
  const merged = new Map()
  for (const block of blocks) {
    if (!predicate(block.selector)) continue
    for (const [name, value] of block.declarations) merged.set(name, value)
  }
  return merged
}

/**
 * Follow `var(--x)` chains down to a literal value.
 * Throws on an unknown or cyclic reference — both are token-file bugs.
 */
function resolve(name, variables, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Cyclic token reference at ${name}`)
  seen.add(name)

  const raw = variables.get(name)
  if (raw === undefined) throw new Error(`Token ${name} is not defined`)

  const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw)
  return reference ? resolve(reference[1], variables, seen) : raw
}

/**
 * @returns {{ light: Map<string, string>, dark: Map<string, string> }}
 *   Fully-resolved token name -> literal colour, per theme.
 */
export function loadThemes(path = TOKENS_PATH) {
  const blocks = parseBlocks(readFileSync(path, 'utf8'))

  // The brand block and the light semantic block both target :root.
  const lightVars = mergeMatching(blocks, (selector) => selector.includes(':root'))
  const darkVars = new Map([
    ...lightVars,
    ...mergeMatching(blocks, (selector) => selector.includes("[data-theme='dark']")),
  ])

  const resolveAll = (variables) => {
    const resolved = new Map()
    for (const name of variables.keys()) resolved.set(name, resolve(name, variables))
    return resolved
  }

  return { light: resolveAll(lightVars), dark: resolveAll(darkVars) }
}
