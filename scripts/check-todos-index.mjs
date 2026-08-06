#!/usr/bin/env node
/**
 * Enforce that the behaviour backlog's index lists every note in it.
 *
 * `openspec/todos/README.md` is the only page that reads as the backlog: it
 * carries the Type, Status, Area and — the column that does the real work — the
 * trigger that has to fire before an item is worth promoting. A note that is not
 * in that table is not deferred work, it is lost work. It still has a filename,
 * so nothing looks broken; it simply stops being read, and stops being weighed
 * against the roadmap when `/next-change` asks what to do next.
 *
 * That is exactly how `page-headers-reserve-their-own-space.md` sat unlisted for
 * two days: the note was written correctly and the index was never touched. The
 * table is maintained by hand and nothing checked it, which is a defect in the
 * process rather than in anybody's diligence — hence a check rather than a
 * reminder.
 *
 * Both directions are drift, and both fail:
 *
 *   - an **unlisted note** — a file no link in the index points at;
 *   - a **dangling row** — a link to a note that no longer exists, which is what
 *     an item leaves behind when it is promoted into a change and its file is
 *     removed without its row.
 *
 * Any link anywhere in the README counts as listing, deliberately. Items move
 * from the Items table to "Graduated / Absorbed" when they are promoted, and a
 * note can legitimately be referenced from the prose between them; the rule is
 * that the index mentions the note, not which table it sits in.
 *
 * Scoped to the todos index on purpose. `openspec/specs/README.md` has the same
 * class of drift and is a harder problem — it indexes directories and carries a
 * separately stale "Expected capabilities" line — so it is tracked as its own
 * backlog item rather than bolted on here. If it is fixed by this shape of
 * check, this is the file to generalise.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const INDEX_FILE = 'README.md'

/**
 * Resolved inside the CLI entry rather than at module load: the exported rule is
 * the module's contract and must import cleanly under the test runner, which
 * rewrites `import.meta.url` to something `fileURLToPath` rejects.
 */
const todosDir = () => fileURLToPath(new URL('../openspec/todos', import.meta.url))

/** Markdown links to a sibling note: `(./name.md)`, with or without the `./`. */
const NOTE_LINK = /\(\.?\/?([\w.-]+\.md)(?:#[^)]*)?\)/g

/**
 * Compare a set of note filenames against the index that should list them.
 *
 * Pure on purpose: the caller supplies the directory listing and the index text,
 * so the rule is testable without a fixture directory on disk.
 *
 * @param {{ files: string[], indexMarkdown: string }} input
 * @returns {{ unlisted: string[], dangling: string[] }}
 */
export function findIndexDrift({ files, indexMarkdown }) {
  const notes = files.filter((name) => name.endsWith('.md') && name !== INDEX_FILE)

  const linked = new Set()
  for (const [, target] of indexMarkdown.matchAll(NOTE_LINK)) {
    if (target !== INDEX_FILE) linked.add(target)
  }

  return {
    unlisted: notes.filter((name) => !linked.has(name)).sort(),
    dangling: [...linked].filter((target) => !notes.includes(target)).sort(),
  }
}

function main() {
  const directory = todosDir()
  const { unlisted, dangling } = findIndexDrift({
    files: readdirSync(directory),
    indexMarkdown: readFileSync(resolve(directory, INDEX_FILE), 'utf8'),
  })

  if (unlisted.length === 0 && dangling.length === 0) {
    console.log('Behaviour backlog index is in sync.')
    return
  }

  if (unlisted.length > 0) {
    process.stderr.write(`✗ ${unlisted.length} backlog note(s) missing from the index:\n`)
    for (const name of unlisted) process.stderr.write(`  openspec/todos/${name}\n`)
    process.stderr.write('  Add a row to the Items table in openspec/todos/README.md.\n')
  }

  if (dangling.length > 0) {
    process.stderr.write(`✗ ${dangling.length} index row(s) point at a note that is gone:\n`)
    for (const name of dangling) process.stderr.write(`  openspec/todos/${name}\n`)
    process.stderr.write('  Move the row to "Graduated / Absorbed", or drop it.\n')
  }

  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
