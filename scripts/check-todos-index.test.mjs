import { describe, expect, it } from 'vitest'

import { findIndexDrift } from './check-todos-index.mjs'

/** An index in the shape the real one uses: a table row per note. */
const indexFor = (...names) =>
  ['# Behavior Backlog', '', '| Item | Type |', '| --- | --- |']
    .concat(names.map((name) => `| [An Item](./${name}) | Feature |`))
    .join('\n')

describe('behaviour backlog index drift', () => {
  it('names a note the index does not mention', () => {
    const drift = findIndexDrift({
      files: ['README.md', 'listed.md', 'forgotten.md'],
      indexMarkdown: indexFor('listed.md'),
    })

    expect(drift.unlisted).toEqual(['forgotten.md'])
    expect(drift.dangling).toEqual([])
  })

  it('names a row whose note is gone', () => {
    const drift = findIndexDrift({
      files: ['README.md', 'listed.md'],
      indexMarkdown: indexFor('listed.md', 'promoted-and-deleted.md'),
    })

    expect(drift.unlisted).toEqual([])
    expect(drift.dangling).toEqual(['promoted-and-deleted.md'])
  })

  it('passes an index in sync', () => {
    const drift = findIndexDrift({
      files: ['README.md', 'one.md', 'two.md'],
      indexMarkdown: indexFor('one.md', 'two.md'),
    })

    expect(drift).toEqual({ unlisted: [], dangling: [] })
  })

  // Promoted items move out of the Items table into "Graduated / Absorbed", and a
  // note can be referenced from the prose between them. The rule is that the
  // index mentions the note, not which table it sits in.
  it('accepts a note reached only from the graduated table', () => {
    const drift = findIndexDrift({
      files: ['README.md', 'graduated.md'],
      indexMarkdown: [
        indexFor(),
        '',
        '## Graduated / Absorbed',
        '',
        '| Former item | Where it went |',
        '| --- | --- |',
        '| [Graduated](./graduated.md) | Absorbed into a change |',
      ].join('\n'),
    })

    expect(drift).toEqual({ unlisted: [], dangling: [] })
  })

  // The real index links its notes with anchors and links out to sibling docs.
  // Neither may be mistaken for a note, or the check reports drift that is not
  // there and gets switched off.
  it('reads a link carrying an anchor, and ignores links outside the folder', () => {
    const drift = findIndexDrift({
      files: ['README.md', 'anchored.md'],
      indexMarkdown: [
        '| [Anchored](./anchored.md#current-behaviour) | Defect |',
        'See [Limitations](../../docs/LIMITATIONS.md#bills-are-record-only) and',
        '[the roadmap](../changes/ROADMAP.md).',
      ].join('\n'),
    })

    expect(drift).toEqual({ unlisted: [], dangling: [] })
  })

  it('ignores anything that is not a note', () => {
    const drift = findIndexDrift({
      files: ['README.md', 'note.md', '.gitkeep', 'scratch.txt'],
      indexMarkdown: indexFor('note.md'),
    })

    expect(drift).toEqual({ unlisted: [], dangling: [] })
  })
})
