import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MAX_ROOT_GATES,
  checkChangeGates,
  checkProposals,
  loadDeclarations,
  readMigrations,
  tuples,
} from './check-change-gates.mjs'

/**
 * `lint:change-gates` (a-release-can-be-switched-off, design D4, D12): the code's
 * declarations and the migrations' rows say the same thing, every gate is
 * tested both ways and retired on time, and every new proposal says how its
 * change is released.
 */

const gate = (overrides = {}) => ({
  kind: 'change',
  code: 'DT',
  change: 'each-dish-is-ticked-off',
  retireBy: '2026-12-01',
  roundTrip: 'none: nothing queued depends on it',
  ...overrides,
})

const MIGRATION = `-- change-gate: dish-ticks
insert into public.change_gates (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('dish-ticks', 'DT', 'change', 'Dish ticks', 'Each dish, ticked.', 'Orders, as today.', 'each-dish-is-ticked-off', 74),
  ('kitchen-ready', 'KR', 'change', 'Kitchen ready', 'Ready, from ticks.', 'Ready, as today.', 'each-dish-is-ticked-off', 74);
insert into public.change_gate_dependencies (gate_key, depends_on) values ('kitchen-ready', 'dish-ticks');`

/** A healthy pair of gates, one depending on the other; each test breaks one thing. */
function world(change = {}) {
  const base = {
    declared: {
      'dish-ticks': gate(),
      'kitchen-ready': gate({ code: 'KR', dependsOn: ['dish-ticks'] }),
    },
    retired: [],
    ...readMigrations([{ name: '20261101000000_dish_ticks.sql', source: MIGRATION }]),
    unitTests: new Map([
      ['dish-ticks', ['src/a.test.ts']],
      ['kitchen-ready', ['src/b.test.ts']],
    ]),
    browserTags: [
      { kind: 'on', key: 'dish-ticks', file: 'e2e/a.spec.ts' },
      { kind: 'on', key: 'kitchen-ready', file: 'e2e/b.spec.ts' },
    ],
    changes: new Set(['each-dish-is-ticked-off']),
    today: '2026-11-15',
  }
  return { ...base, ...change }
}

const whats = (input) => checkChangeGates(input).failures.map((failure) => failure.what)

describe('a healthy pair of gates', () => {
  it('passes', () => {
    expect(checkChangeGates(world())).toEqual({ failures: [], warnings: [] })
  })
})

describe('the code and the database say the same thing', () => {
  it('fails a declared gate no migration inserts', () => {
    const input = world({ declared: { ...world().declared, 'third-one': gate({ code: 'T3' }) } })
    expect(whats(input)).toContain('has no migration inserting its row')
  })

  it('fails a row the code neither declares nor has retired, and passes it once retired', () => {
    const declared = { 'dish-ticks': gate() }
    expect(whats(world({ declared }))).toContainEqual(
      expect.stringContaining(
        'inserts the gate `kitchen-ready`, which the code neither declares nor has retired',
      ),
    )
    const browserTags = world().browserTags.filter((tag) => tag.key === 'dish-ticks')
    expect(whats(world({ declared, retired: ['kitchen-ready'], browserTags }))).toEqual([])
  })

  it('fails a key both declared and retired', () => {
    expect(whats(world({ retired: ['dish-ticks'] }))).toContain('is declared and also retired')
  })

  it('fails a code or kind that disagrees with the row', () => {
    const declared = {
      ...world().declared,
      'dish-ticks': gate({ code: 'D1', kind: 'ops', reason: 'stays' }),
    }
    const found = whats(world({ declared }))
    expect(found).toContainEqual(expect.stringContaining('says code `D1`'))
    expect(found).toContainEqual(expect.stringContaining('says kind `ops`'))
  })

  it('fails dependencies that disagree with the rows', () => {
    const declared = { ...world().declared, 'kitchen-ready': gate({ code: 'KR' }) }
    expect(whats(world({ declared }))).toContain(
      'depends on [] in the code and on [dish-ticks] in the migrations',
    )
  })

  it('fails a migration header naming a gate nobody declared', () => {
    const migrations = readMigrations([
      { name: '20261101000000_dish_ticks.sql', source: MIGRATION },
      {
        name: '20261102000000_more.sql',
        source: '-- change-gate: dish-tick\ncreate table public.t (id int);',
      },
    ])
    expect(whats(world(migrations))).toContain(
      'names the gate `dish-tick`, which the code neither declares nor has retired',
    )
  })

  it('fails rows it cannot read', () => {
    const migrations = readMigrations([
      { name: '20261101000000_dish_ticks.sql', source: MIGRATION },
      {
        name: '20261102000000_odd.sql',
        source: 'insert into public.change_gates select * from elsewhere;',
      },
    ])
    expect(whats(world(migrations))).toContain('inserts gate rows in a form this lint cannot read')
  })
})

describe('codes and dependencies', () => {
  it('fails a malformed code and a code two live gates share', () => {
    expect(
      whats(world({ declared: { ...world().declared, 'dish-ticks': gate({ code: '12' }) } })),
    ).toContainEqual(expect.stringContaining('has the code `12`'))
    expect(
      whats(
        world({
          declared: {
            ...world().declared,
            'kitchen-ready': gate({ code: 'DT', dependsOn: ['dish-ticks'] }),
          },
        }),
      ),
    ).toContainEqual(expect.stringContaining('shares the code `DT` with `dish-ticks`'))
  })

  it('fails a dependency that is undeclared, or retired while its child lives', () => {
    const declared = { 'kitchen-ready': gate({ code: 'KR', dependsOn: ['dish-ticks'] }) }
    expect(whats(world({ declared, retired: [] }))).toContain(
      'depends on `dish-ticks`, which is not declared',
    )
    expect(whats(world({ declared, retired: ['dish-ticks'] }))).toContain(
      'depends on `dish-ticks`, which has been retired',
    )
  })

  it('fails a loop', () => {
    const declared = {
      a: gate({ code: 'AA', dependsOn: ['b'] }),
      b: gate({ code: 'BB', dependsOn: ['a'] }),
    }
    expect(whats(world({ declared }))).toContainEqual(
      expect.stringMatching(/^depends on itself through/),
    )
  })

  it(`allows ${MAX_ROOT_GATES} change gates that depend on nothing, and not one more`, () => {
    const declared = (count) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [`g${i}`, gate({ code: `G${i}` })]),
      )
    const roots = (count) =>
      whats(world({ declared: declared(count) })).filter((what) => /depend on nothing/.test(what))
    expect(roots(MAX_ROOT_GATES)).toEqual([])
    expect(roots(MAX_ROOT_GATES + 1)).toHaveLength(1)
  })
})

describe('retirement is on time', () => {
  it('passes before retireBy, warns from it, and fails fourteen days after', () => {
    const at = (today) => checkChangeGates(world({ today }))
    expect(at('2026-11-30')).toEqual({ failures: [], warnings: [] })
    expect(at('2026-12-01').warnings).toHaveLength(2)
    expect(at('2026-12-15').failures).toEqual([])
    expect(at('2026-12-16').failures.map((failure) => failure.what)).toContain(
      'was due for retirement on 2026-12-01, 15 days ago',
    )
  })

  it('never expires an ops gate, which must say why it stays', () => {
    const ops = (reason) => ({ ...world().declared, 'dish-ticks': gate({ kind: 'ops', reason }) })
    const rowsAsOps = readMigrations([
      {
        name: '20261101000000_dish_ticks.sql',
        source: MIGRATION.replace("'DT', 'change'", "'DT', 'ops'"),
      },
    ])
    const aboutDishTicks = (input) =>
      checkChangeGates(input).failures.filter((failure) => failure.where.includes('`dish-ticks`'))
    expect(
      aboutDishTicks(
        world({
          ...rowsAsOps,
          declared: ops('the kitchen printer fails often'),
          today: '2027-06-01',
        }),
      ),
    ).toEqual([])
    expect(whats(world({ ...rowsAsOps, declared: ops(undefined) }))).toContain(
      'is an `ops` gate with no `reason`',
    )
  })

  it('exempts a self-test gate from the root limit and retireBy, and holds it to changing nothing', () => {
    const selfTest = (overrides = {}) => ({
      ...world().declared,
      'dish-ticks': gate({
        selfTest: true,
        reason: 'the gate system’s own tests turn it',
        retireBy: undefined,
        ...overrides,
      }),
    })
    const aboutDishTicks = (input) =>
      checkChangeGates(input).failures.filter((failure) => failure.where.includes('`dish-ticks`'))
    expect(aboutDishTicks(world({ declared: selfTest(), today: '2027-06-01' }))).toEqual([])
    expect(checkChangeGates(world({ declared: selfTest(), today: '2027-06-01' })).warnings).toEqual(
      [],
    )

    const roots = (count) =>
      whats(
        world({
          declared: {
            ...selfTest(),
            ...Object.fromEntries(
              Array.from({ length: count }, (_, i) => [`g${i}`, gate({ code: `G${i}` })]),
            ),
          },
        }),
      ).filter((what) => /depend on nothing/.test(what))
    expect(roots(MAX_ROOT_GATES)).toEqual([])

    expect(whats(world({ declared: selfTest({ reason: undefined }) }))).toContain(
      'is a self-test gate that has no `reason`',
    )
    expect(whats(world({ declared: selfTest({ retireBy: '2026-12-01' }) }))).toContain(
      'is a self-test gate that has a `retireBy`',
    )
    expect(whats(world({ declared: selfTest({ dependsOn: ['kitchen-ready'] }) }))).toContain(
      'is a self-test gate that depends on another gate',
    )
    expect(
      whats(
        world({
          declared: selfTest(),
          togglePoints: new Map([['dish-ticks', ['src/counter.tsx']]]),
        }),
      ),
    ).toContain('is a self-test gate that is read by src/counter.tsx')
  })

  it('fails a gate whose change has no folder', () => {
    expect(whats(world({ changes: new Set() }))).toContainEqual(
      expect.stringContaining('which has no folder in openspec/changes/'),
    )
  })
})

describe('every gate is tested both ways', () => {
  it('fails a gate with no describeChangeGate unit test or no @cg-on browser test', () => {
    const found = whats(world({ unitTests: new Map(), browserTags: [] }))
    expect(found).toContainEqual(expect.stringContaining("describeChangeGate('dish-ticks', …)"))
    expect(found).toContainEqual(expect.stringContaining('`@cg-on:kitchen-ready`'))
  })

  it('needs a round-trip test when the declaration says it was tested', () => {
    const declared = { ...world().declared, 'dish-ticks': gate({ roundTrip: 'tested' }) }
    expect(whats(world({ declared }))).toContainEqual(
      expect.stringContaining('`@cg-round-trip:dish-ticks`'),
    )
    const tagged = [
      ...world().browserTags,
      { kind: 'round-trip', key: 'dish-ticks', file: 'e2e/c.spec.ts' },
    ]
    expect(whats(world({ declared, browserTags: tagged }))).toEqual([])
  })

  it('fails a tag naming a gate that is not declared, and says what to do once it is retired', () => {
    const browserTags = [
      ...world().browserTags,
      { kind: 'off', key: 'old-gate', file: 'e2e/old.spec.ts' },
    ]
    const [found] = checkChangeGates(world({ browserTags, retired: ['old-gate'] })).failures
    expect(found.what).toContain('`@cg-off:old-gate`')
    expect(found.instead).toContain('delete its `@cg-off:` tests')
  })
})

describe('every new proposal says how its change is released', () => {
  const folder = (overrides) => ({
    name: 'a-new-change',
    created: '2026-10-13',
    proposal: '# A new change\n\n## Why\n\nBecause.\n',
    ...overrides,
  })

  it('fails a proposal created on or after 2026-10-13 with no Change gate section', () => {
    expect(checkProposals([folder()]).map((failure) => failure.what)).toEqual([
      'has no `## Change gate` section',
    ])
    expect(
      checkProposals([folder({ proposal: '## Change gate\n\nNo gate: tooling only.\n' })]),
    ).toEqual([])
  })

  it('leaves older folders and folders without a proposal alone', () => {
    expect(checkProposals([folder({ created: '2026-10-12' }), folder({ proposal: null })])).toEqual(
      [],
    )
  })

  it('fails a folder with no date, except the ones written before folders had dates', () => {
    expect(checkProposals([folder({ created: null })]).map((failure) => failure.what)).toEqual([
      'has no `created:` date',
    ])
    expect(
      checkProposals([folder({ name: 'rollback-each-dish-is-ticked-off', created: null })]),
    ).toEqual([])
  })
})

describe('reading', () => {
  it('splits value tuples with commas and quotes inside strings', () => {
    expect(tuples("('a', 'b, ''c''', 75), ('d', 'e', null) on conflict do nothing")).toEqual([
      ["'a'", "'b, ''c'''", '75'],
      ["'d'", "'e'", 'null'],
    ])
  })

  it('reads the real declarations and the real migration’s rows', () => {
    const { declared, retired } = loadDeclarations(
      readFileSync(resolve(process.cwd(), 'src/change-gates/gates.ts'), 'utf8'),
    )
    expect(Object.keys(declared)).toContain('probe')
    expect(retired).toContain('tablet-health')
    expect(Array.isArray(retired)).toBe(true)
    const { rows } = readMigrations([
      {
        name: '20261018000000_change_gates.sql',
        source: readFileSync(
          resolve(process.cwd(), 'supabase/migrations/20261018000000_change_gates.sql'),
          'utf8',
        ),
      },
    ])
    expect(rows.get('probe')).toMatchObject({ code: 'PB', kind: 'change' })
    expect(rows.get('tablet-health')).toMatchObject({ code: 'TH', kind: 'change' })
  })
})
