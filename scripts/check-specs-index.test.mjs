import { describe, expect, it } from 'vitest'

import { findLivingSpecIndexDrift } from './check-specs-index.mjs'

const capability = (name, hasSpec = true) => ({ name, isDirectory: true, hasSpec })

const indexFor = (...names) =>
  ['# Living Specs', '', '## Current capabilities']
    .concat(names.map((name) => `- [${name}](./${name}/spec.md)`))
    .join('\n')

describe('living-spec index drift', () => {
  it('names a capability the index does not mention', () => {
    const drift = findLivingSpecIndexDrift({
      entries: [capability('listed'), capability('forgotten')],
      indexMarkdown: indexFor('listed'),
    })

    expect(drift).toEqual({ missing: ['forgotten'], dangling: [] })
  })

  it('names an index link whose capability is gone', () => {
    const drift = findLivingSpecIndexDrift({
      entries: [capability('listed')],
      indexMarkdown: indexFor('listed', 'deleted'),
    })

    expect(drift).toEqual({ missing: [], dangling: ['deleted'] })
  })

  it('names an index link whose directory has no spec', () => {
    const drift = findLivingSpecIndexDrift({
      entries: [capability('listed'), capability('missing-spec', false)],
      indexMarkdown: indexFor('listed', 'missing-spec'),
    })

    expect(drift).toEqual({ missing: [], dangling: ['missing-spec'] })
  })

  it('passes a complete current index', () => {
    const drift = findLivingSpecIndexDrift({
      entries: [capability('one'), capability('two')],
      indexMarkdown: indexFor('one', 'two'),
    })

    expect(drift).toEqual({ missing: [], dangling: [] })
  })

  it('ignores direct entries that are not capability directories', () => {
    const drift = findLivingSpecIndexDrift({
      entries: [capability('real'), { name: 'draft.md', isDirectory: false, hasSpec: false }],
      indexMarkdown: indexFor('real'),
    })

    expect(drift).toEqual({ missing: [], dangling: [] })
  })

  it('ignores unrelated links and accepts anchors on capability links', () => {
    const drift = findLivingSpecIndexDrift({
      entries: [capability('anchored')],
      indexMarkdown: [
        '- [Anchored](./anchored/spec.md#requirements)',
        'See [the roadmap](../changes/ROADMAP.md) and [docs](../../docs/README.md).',
      ].join('\n'),
    })

    expect(drift).toEqual({ missing: [], dangling: [] })
  })

  it('does not write or mutate authored inputs', () => {
    const entries = Object.freeze([Object.freeze(capability('one'))])
    const indexMarkdown = indexFor('one')

    expect(findLivingSpecIndexDrift({ entries, indexMarkdown })).toEqual({
      missing: [],
      dangling: [],
    })
    expect(entries).toEqual([capability('one')])
    expect(indexMarkdown).toBe(indexFor('one'))
  })
})
