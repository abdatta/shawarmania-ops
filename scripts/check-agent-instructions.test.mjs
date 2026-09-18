import { describe, expect, it } from 'vitest'

import { findInstructionDrift } from './check-agent-instructions.mjs'

/** Both trees complete, which is the state the repo is meant to hold. */
const BOTH_TREES = {
  claudeCommands: ['propose.md', 'apply.md', 'archive.md', 'explore.md', 'sync.md'],
  agentSkills: [
    'openspec-propose',
    'openspec-apply-change',
    'openspec-archive-change',
    'openspec-explore',
    'openspec-sync-specs',
  ],
}

const drift = (sources, trees = BOTH_TREES) => findInstructionDrift({ sources, ...trees })

describe('openspec CLI invocations', () => {
  it('names a fenced call and the line it sits on', () => {
    const { invocations } = drift([
      { path: 'a.md', text: 'Run:\n\n```bash\nopenspec status --change "x" --json\n```\n' },
    ])

    expect(invocations).toEqual([{ path: 'a.md', line: 4, call: 'openspec status' }])
  })

  it('catches the npx and node_modules spellings', () => {
    const { invocations } = drift([
      { path: 'a.md', text: 'npx openspec new change "x"' },
      { path: 'b.md', text: './node_modules/.bin/openspec list --json' },
    ])

    expect(invocations.map((i) => i.path)).toEqual(['a.md', 'b.md'])
  })

  it('catches a call written inline in prose', () => {
    const { invocations } = drift([{ path: 'a.md', text: 'First run `openspec init` here.' }])

    expect(invocations).toHaveLength(1)
  })

  // The stripped files are dense with these paths; a rule that fired on them
  // would be unusable and would be silenced rather than fixed.
  it('leaves openspec paths alone', () => {
    const { invocations } = drift([
      {
        path: 'a.md',
        text: [
          'The change lives at `openspec/changes/<name>/`.',
          'Read `openspec/config.yaml` and `openspec/specs/<capability>/spec.md`.',
          'Archived under `openspec/changes/archive/`.',
          'Then run `npm run roadmap:sync`.',
        ].join('\n'),
      },
    ])

    expect(invocations).toEqual([])
  })

  // The mapping table that replaced the calls names the CLI's own vocabulary.
  it('leaves the explanatory mapping table alone', () => {
    const { invocations } = drift([
      {
        path: 'a.md',
        text: [
          '| What the CLI would return | Value here |',
          '|---|---|',
          '| `schemaName` | `spec-driven` |',
          '| `changeRoot` | `openspec/changes/<name>/` |',
          '| active changes | the directories in `openspec/changes/` |',
          'There is no `openspec` binary on PATH.',
        ].join('\n'),
      },
    ])

    expect(invocations).toEqual([])
  })
})

describe('tree correspondence', () => {
  it('passes when both trees cover every workflow', () => {
    const { lopsided } = drift([])

    expect(lopsided).toEqual([])
  })

  it('names a workflow Codex is missing', () => {
    const { lopsided } = drift([], {
      ...BOTH_TREES,
      agentSkills: BOTH_TREES.agentSkills.filter((s) => s !== 'openspec-archive-change'),
    })

    expect(lopsided).toEqual([
      '.claude/commands/opsx/archive.md has no counterpart at .agents/skills/openspec-archive-change/',
    ])
  })

  it('names a workflow Claude is missing', () => {
    const { lopsided } = drift([], {
      ...BOTH_TREES,
      claudeCommands: BOTH_TREES.claudeCommands.filter((c) => c !== 'sync.md'),
    })

    expect(lopsided).toEqual([
      '.agents/skills/openspec-sync-specs/ has no counterpart at .claude/commands/opsx/sync.md',
    ])
  })

  it('ignores files in either tree that are not part of the workflow', () => {
    const { lopsided } = drift([], {
      claudeCommands: [...BOTH_TREES.claudeCommands, 'README.md'],
      agentSkills: [...BOTH_TREES.agentSkills, 'git-commit', 'next-change'],
    })

    expect(lopsided).toEqual([])
  })
})
