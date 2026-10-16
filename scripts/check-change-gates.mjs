#!/usr/bin/env node
/**
 * Every change gate is declared twice and tested both ways
 * (a-release-can-be-switched-off, design D4, D10, D11, D12).
 *
 * A gate lives in two places on purpose: its row in `change_gates`, inserted by
 * the migration that serves it, so it exists in production before any build
 * reads it; and its declaration in `src/change-gates/gates.ts`, so a toggle
 * point names a key the compiler knows. Nothing but this lint keeps the two
 * saying the same thing — the key, the code, the kind and what it depends on —
 * and nothing else makes sure a gate's tests run it both ways, that a gate is
 * retired on time, and that every proposal says how its change is released.
 *
 * `--proposals` runs only the last check. `docs.yml` runs it that way, because a
 * commit that adds only a proposal takes the prose tier and would never meet
 * the full lint (D12). `--count` prints how many gates are declared, so the
 * gates-on jobs in `verify.yml` can skip when there are none (D10).
 *
 * Every failure says what is wrong and where, why the rule exists, and what to
 * write instead, so an agent can fix it from the message alone.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { splitStatements } from './check-migrations.mjs'

const require = createRequire(import.meta.url)

export const DOCS = 'docs/RELEASES.md#change-gates'

/** Change folders created on or after this date need a `## Change gate` section. */
export const SECTION_SINCE = '2026-10-13'

/** Active folders written before `.openspec.yaml` carried a date; nothing new joins them. */
export const UNDATED_BEFORE_GATES = new Set([
  'aggregator-login-live-stages',
  'commit-attribution-uses-active-model',
  'rollback-each-dish-is-ticked-off',
])

/** At most this many `change` gates that depend on nothing (D11: Hodgson's inventory limit). */
export const MAX_ROOT_GATES = 5

/** A passed `retireBy` warns at once and fails this many days later. */
export const RETIRE_GRACE_DAYS = 14

const GATE_KEY = /^[a-z][a-z0-9-]*$/
const GATE_CODE = /^(?=.*[A-Z])[A-Z0-9]{2}$/
const TAG = /@cg-(on|off|round-trip):([a-z][a-z0-9-]*)/g
/** `useChangeGate('key')`, `snapshot['key']`, `bootSnapshot()['key']`, `snapshot.key`. */
const TOGGLE_POINT =
  /(?:useChangeGate\(\s*|[sS]napshot(?:\(\))?\s*\[\s*)['"]([a-z][a-z0-9-]*)['"]|[sS]napshot(?:\(\))?\.([a-z][a-z0-9]*)\b/g

const failure = (where, what, why, instead) => ({ where, what, why, instead })

// ── Reading the migrations' rows ────────────────────────────────────────────

/** Split `(a, 'b, c'), (d)` into tuples of raw fields, strings and parentheses respected. */
export function tuples(text) {
  const found = []
  let depth = 0
  let field = ''
  let fields = null
  let inString = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      field += ch
      if (ch === "'" && text[i + 1] === "'") {
        field += "'"
        i += 1
      } else if (ch === "'") {
        inString = false
      }
      continue
    }
    if (ch === "'") {
      inString = true
      field += ch
    } else if (ch === '(') {
      depth += 1
      if (depth === 1) {
        fields = []
        field = ''
      } else {
        field += ch
      }
    } else if (ch === ')') {
      depth -= 1
      if (depth === 0) {
        fields.push(field.trim())
        found.push(fields)
        fields = null
      } else {
        field += ch
      }
    } else if (ch === ',' && depth === 1) {
      fields.push(field.trim())
      field = ''
    } else if (depth >= 1) {
      field += ch
    } else if (!/[\s,]/.test(ch)) {
      break // `on conflict …` or anything else after the values
    }
  }
  return found
}

const unquote = (value) => (/^'.*'$/s.test(value) ? value.slice(1, -1).replace(/''/g, "'") : null)

/**
 * The gate rows, dependency rows and header declarations the migrations make.
 *
 * @param {{ name: string, source: string }[]} files
 */
export function readMigrations(files) {
  const rows = new Map()
  const dependencies = []
  const headers = []
  const unreadable = []

  for (const { name, source } of files) {
    const { statements, comments } = splitStatements(source)
    for (const { line, text } of comments) {
      const declared = /^--\s*(change-gate:|release:\s*contract)\s*(\S+)/.exec(text)
      if (declared) {
        headers.push({
          file: name,
          line,
          kind: declared[1] === 'change-gate:' ? 'change-gate' : 'contract',
          key: declared[2],
        })
      }
    }
    for (const statement of statements) {
      const code = statement.code.replace(/\s+/g, ' ').trim()
      const insert =
        /^insert into (?:public\.)?(change_gates|change_gate_dependencies)\s*(?:\(([^)]*)\))?\s*(.*)$/i.exec(
          code,
        )
      if (!insert) continue
      const columns = (insert[2] ?? '').split(',').map((column) => column.trim().toLowerCase())
      const values = /^values\s*(.*)$/i.exec(insert[3])
      if (!insert[2] || !values) {
        unreadable.push({ file: name, line: statement.line })
        continue
      }
      for (const tuple of tuples(values[1])) {
        const row = Object.fromEntries(
          columns.map((column, i) => [column, unquote(tuple[i] ?? '')]),
        )
        if (insert[1].toLowerCase() === 'change_gates') {
          rows.set(row.key, {
            key: row.key,
            code: row.code,
            kind: row.kind ?? 'change',
            file: name,
            line: statement.line,
          })
        } else {
          dependencies.push({ gate: row.gate_key, dependsOn: row.depends_on, file: name })
        }
      }
    }
  }
  return { rows, dependencies, headers, unreadable }
}

// ── The checks ──────────────────────────────────────────────────────────────

const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

/**
 * Everything D4 asks of the declarations, their rows and their tests.
 *
 * @returns {{ failures: object[], warnings: object[] }}
 */
export function checkChangeGates({
  declared,
  retired,
  rows,
  dependencies,
  headers = [],
  unreadable = [],
  unitTests,
  browserTags,
  togglePoints = new Map(),
  changes,
  today,
}) {
  const failures = []
  const warnings = []
  const keys = Object.keys(declared)
  const at = (key) => `src/change-gates/gates.ts \`${key}\``

  for (const place of unreadable) {
    failures.push(
      failure(
        `supabase/migrations/${place.file}:${place.line}`,
        'inserts gate rows in a form this lint cannot read',
        'the lint compares every row with its declaration, so it has to read them.',
        'Write `insert into public.change_gates (key, code, kind, …) values (…), (…);` with literal values, and the same for `change_gate_dependencies (gate_key, depends_on)`.',
      ),
    )
  }

  for (const key of retired) {
    if (keys.includes(key)) {
      failures.push(
        failure(
          at(key),
          'is declared and also retired',
          'a key that once gated one change must never wake up meaning another.',
          'Give the new gate a new key. Keys are never reused; a retired gate’s two-letter code may be.',
        ),
      )
    }
  }

  for (const [key, row] of rows) {
    if (!keys.includes(key) && !retired.includes(key)) {
      failures.push(
        failure(
          `supabase/migrations/${row.file}:${row.line}`,
          `inserts the gate \`${key}\`, which the code neither declares nor has retired`,
          'every gate the database knows must be one the code can read or one it has finished with.',
          `Declare \`${key}\` in CHANGE_GATES, or add it to RETIRED_CHANGE_GATES if its change has been retired.`,
        ),
      )
    }
  }

  for (const header of headers) {
    if (!keys.includes(header.key) && !retired.includes(header.key)) {
      failures.push(
        failure(
          `supabase/migrations/${header.file}:${header.line}`,
          `names the gate \`${header.key}\`, which the code neither declares nor has retired`,
          'a migration’s header says which gate guards it, so the gate must exist.',
          `Declare \`${header.key}\` in src/change-gates/gates.ts, or correct the key in the header.`,
        ),
      )
    }
  }

  const codes = new Map()
  let roots = 0
  for (const key of keys) {
    const gate = declared[key]
    const row = rows.get(key)

    if (!GATE_KEY.test(key)) {
      failures.push(
        failure(
          at(key),
          'is not a valid key',
          'keys are kebab-case.',
          'Use lowercase words joined by hyphens.',
        ),
      )
    }

    if (!row) {
      failures.push(
        failure(
          at(key),
          'has no migration inserting its row',
          'the row must reach production before any build that reads the gate, and it carries the words the Change gates page shows.',
          `In the migration that serves its on path, \`insert into public.change_gates (key, code, kind, title, on_means, off_means, change_name, change_number) values ('${key}', '${gate.code}', '${gate.kind}', …);\` — off by default.`,
        ),
      )
    } else {
      for (const field of ['code', 'kind']) {
        if (row[field] !== gate[field]) {
          failures.push(
            failure(
              at(key),
              `says ${field} \`${gate[field]}\`, and its row in ${row.file} says \`${row[field]}\``,
              'the code and the database must describe the same gate.',
              'Make the declaration match the migration. A gate already in production is changed by a new migration, never by editing an old one.',
            ),
          )
        }
      }
      const fromRows = dependencies
        .filter((dependency) => dependency.gate === key)
        .map((dependency) => dependency.dependsOn)
        .sort()
      const fromCode = [...(gate.dependsOn ?? [])].sort()
      if (fromRows.join(',') !== fromCode.join(',')) {
        failures.push(
          failure(
            at(key),
            `depends on [${fromCode.join(', ')}] in the code and on [${fromRows.join(', ')}] in the migrations`,
            'the database refuses a turn the code would allow, or allows one it would refuse.',
            `Insert a \`change_gate_dependencies (gate_key, depends_on)\` row for each gate in \`dependsOn\`, and nothing else.`,
          ),
        )
      }
    }

    if (!GATE_CODE.test(gate.code)) {
      failures.push(
        failure(
          at(key),
          `has the code \`${gate.code}\``,
          'a code is two characters, capitals or digits, at least one a letter, so it reads unambiguously in a build code.',
          'Choose two characters like `DT` or `K2`.',
        ),
      )
    } else if (codes.has(gate.code)) {
      failures.push(
        failure(
          at(key),
          `shares the code \`${gate.code}\` with \`${codes.get(gate.code)}\``,
          'a build code lists codes, so two live gates with one code cannot be told apart.',
          'Choose a code no declared gate uses. Retired gates’ codes are free.',
        ),
      )
    } else {
      codes.set(gate.code, key)
    }

    for (const parent of gate.dependsOn ?? []) {
      if (!keys.includes(parent)) {
        failures.push(
          failure(
            at(key),
            retired.includes(parent)
              ? `depends on \`${parent}\`, which has been retired`
              : `depends on \`${parent}\`, which is not declared`,
            'a gate runs only while every gate it depends on is on, so each must exist and stay declared as long as it does.',
            retired.includes(parent)
              ? `Retire \`${key}\` first or in the same change, or stop it depending on \`${parent}\`.`
              : `Declare \`${parent}\`, or correct the key.`,
          ),
        )
      }
    }

    if (gate.kind === 'change' && !gate.selfTest && (gate.dependsOn ?? []).length === 0) roots += 1

    if (gate.selfTest) {
      const broken = [
        gate.kind !== 'change' && 'is not a `change` gate',
        !gate.reason && 'has no `reason`',
        gate.retireBy !== undefined && 'has a `retireBy`',
        (gate.dependsOn ?? []).length > 0 && 'depends on another gate',
        (togglePoints.get(key) ?? []).length > 0 &&
          `is read by ${togglePoints.get(key).join(', ')}`,
      ].filter(Boolean)
      for (const what of broken) {
        failures.push(
          failure(
            at(key),
            `is a self-test gate that ${what}`,
            'a self-test gate counts toward no limit and is never retired, which holds only while it changes nothing a suite must run both ways.',
            'Keep it a `change` gate with a `reason`, no `retireBy`, no dependency and no toggle point — or drop `selfTest` and give it a `retireBy`.',
          ),
        )
      }
    }

    if (gate.kind === 'ops' && !gate.reason) {
      failures.push(
        failure(
          at(key),
          'is an `ops` gate with no `reason`',
          'an ops gate is permanent, so it must say why it stays.',
          'Add `reason: …` saying why the switch must outlive its change.',
        ),
      )
    }

    if (!changes.has(gate.change)) {
      failures.push(
        failure(
          at(key),
          `belongs to the change \`${gate.change}\`, which has no folder in openspec/changes/`,
          'every gate belongs to the OpenSpec change that introduced it.',
          'Name the change folder (active or archived) the gate came from.',
        ),
      )
    }

    if (gate.kind === 'change' && !gate.selfTest) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(gate.retireBy ?? '') ||
        Number.isNaN(Date.parse(gate.retireBy))
      ) {
        failures.push(
          failure(
            at(key),
            `has the retireBy \`${gate.retireBy}\``,
            'every change gate has a date by which its retirement is due.',
            "Write `retireBy: 'YYYY-MM-DD'`, usually six to eight weeks after release.",
          ),
        )
      } else {
        const overdue = daysBetween(gate.retireBy, today)
        if (overdue > RETIRE_GRACE_DAYS) {
          failures.push(
            failure(
              at(key),
              `was due for retirement on ${gate.retireBy}, ${overdue} days ago`,
              'every live gate doubles what must be tested and read; a gate left on forever is dead code with a switch on it.',
              'Retire it with the `retire-gate` workflow, or move `retireBy` in a reviewed edit that says why.',
            ),
          )
        } else if (overdue >= 0) {
          warnings.push(
            failure(
              at(key),
              `is due for retirement (${gate.retireBy}); lint fails ${RETIRE_GRACE_DAYS} days after`,
              'retirement is part of the change.',
              'Run the `retire-gate` workflow.',
            ),
          )
        }
      }
    }

    const tagged = (kind) => browserTags.filter((tag) => tag.kind === kind && tag.key === key)
    const missing = []
    if (!(unitTests.get(key) ?? []).length)
      missing.push(`a unit test calling \`describeChangeGate('${key}', …)\``)
    if (tagged('on').length === 0) missing.push(`a browser test tagged \`@cg-on:${key}\``)
    if (gate.roundTrip === 'tested' && tagged('round-trip').length === 0) {
      missing.push(
        `a browser test tagged \`@cg-round-trip:${key}\` (its roundTrip says \`tested\`)`,
      )
    }
    if (gate.roundTrip !== 'tested' && !/^none: \S/.test(gate.roundTrip ?? '')) {
      failures.push(
        failure(
          at(key),
          'has no roundTrip',
          'turning a gate off must strand nothing; the declaration says how that was proved.',
          "Write `roundTrip: 'tested'` and add a `@cg-round-trip:` browser test, or `roundTrip: 'none: <why nothing can be stranded>'`.",
        ),
      )
    }
    if (missing.length > 0) {
      failures.push(
        failure(
          at(key),
          `is missing ${missing.join(', and ')}`,
          'a gate is tested in both states: off is production’s default and the way back, on is the release.',
          'Add the missing tests. Tag a browser test whose assertion only holds with the gate on `@cg-on:<key>`, and an old one it changes `@cg-off:<key>` — a tag is the only edit an existing test may get.',
        ),
      )
    }
  }

  // Loops, which the database also refuses.
  const visiting = new Set()
  const done = new Set()
  const walk = (key, path) => {
    if (done.has(key) || !declared[key]) return
    if (visiting.has(key)) {
      failures.push(
        failure(
          at(key),
          `depends on itself through ${[...path, key].join(' → ')}`,
          'a loop could never be turned on.',
          'Remove one of the dependencies.',
        ),
      )
      return
    }
    visiting.add(key)
    for (const parent of declared[key].dependsOn ?? []) walk(parent, [...path, key])
    visiting.delete(key)
    done.add(key)
  }
  for (const key of keys) walk(key, [])

  if (roots > MAX_ROOT_GATES) {
    failures.push(
      failure(
        'src/change-gates/gates.ts',
        `declares ${roots} change gates that depend on nothing; at most ${MAX_ROOT_GATES}`,
        'every live gate doubles what must be tested; the cap keeps the untested combinations few.',
        'Retire a gate before declaring another. A gate depending on another does not count.',
      ),
    )
  }

  for (const tag of browserTags) {
    if (!keys.includes(tag.key)) {
      failures.push(
        failure(
          tag.file,
          `is tagged \`@cg-${tag.kind}:${tag.key}\`, and \`${tag.key}\` is not a declared gate`,
          'a tag decides in which state a test runs; one naming no gate runs in a state that never comes.',
          retired.includes(tag.key)
            ? `\`${tag.key}\` is retired: delete its \`@cg-off:\` tests and drop the tag from its \`@cg-on:\` ones.`
            : 'Correct the key.',
        ),
      )
    }
  }

  return { failures, warnings }
}

/**
 * Every active change folder created on or after SECTION_SINCE answers how its
 * change is released (D11a, D12). It does not judge the answer.
 *
 * @param {{ name: string, created: string | null, proposal: string | null }[]} folders
 */
export function checkProposals(folders) {
  const failures = []
  for (const folder of folders) {
    const where = `openspec/changes/${folder.name}`
    if (!folder.created) {
      if (UNDATED_BEFORE_GATES.has(folder.name)) continue
      failures.push(
        failure(
          `${where}/.openspec.yaml`,
          'has no `created:` date',
          'the date decides whether the proposal must carry a `## Change gate` section.',
          'Write `.openspec.yaml` with `schema: spec-driven` and `created: YYYY-MM-DD`.',
        ),
      )
      continue
    }
    if (folder.created < SECTION_SINCE || folder.proposal === null) continue
    if (!/^## Change gate\s*$/m.test(folder.proposal)) {
      failures.push(
        failure(
          `${where}/proposal.md`,
          'has no `## Change gate` section',
          'every change says how it is released and how it is turned off, so the owner can turn it off.',
          'Add `## Change gate`: the key, its two-letter code, and what On and Off mean, worded as the Change gates page will show them — Off is the behaviour as it is today. Or `No gate:` and why (docs, tooling, a new surface the registry holds back, or a fix that must reach every device).',
        ),
      )
    }
  }
  return failures
}

// ── Reading the repository ──────────────────────────────────────────────────

const root = () => fileURLToPath(new URL('..', import.meta.url))

/**
 * The declarations, through the TypeScript compiler rather than a regular
 * expression. `gates.ts` imports nothing, so its CommonJS output runs as is.
 */
export function loadDeclarations(source) {
  const ts = require('typescript')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const module = { exports: {} }
  new Function('exports', 'module', outputText)(module.exports, module)
  return {
    declared: module.exports.CHANGE_GATES,
    retired: [...module.exports.RETIRED_CHANGE_GATES],
  }
}

function filesUnder(dir, pattern) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
}

function readFolders(base) {
  const changesDir = join(base, 'openspec/changes')
  return readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    .map((entry) => {
      const dir = join(changesDir, entry.name)
      const meta = join(dir, '.openspec.yaml')
      const created = existsSync(meta)
        ? (/^created:\s*(\d{4}-\d{2}-\d{2})/m.exec(readFileSync(meta, 'utf8'))?.[1] ?? null)
        : null
      const proposal = existsSync(join(dir, 'proposal.md'))
        ? readFileSync(join(dir, 'proposal.md'), 'utf8')
        : null
      return { name: entry.name, created, proposal }
    })
}

function todayInIndia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}

function print(list, mark, stream) {
  for (const item of list) {
    stream.write(
      `${mark} ${item.where}  ${item.what}.\n    Why: ${item.why}\n    Instead: ${item.instead}\n    See ${DOCS}\n\n`,
    )
  }
}

function main() {
  const base = root()
  const proposalFailures = checkProposals(readFolders(base))
  if (process.argv.includes('--proposals')) {
    print(proposalFailures, '✗', process.stderr)
    if (proposalFailures.length > 0) process.exitCode = 1
    else console.log('Every change folder since 2026-10-13 says how it is released.')
    return
  }

  const { declared, retired } = loadDeclarations(
    readFileSync(join(base, 'src/change-gates/gates.ts'), 'utf8'),
  )
  if (process.argv.includes('--count')) {
    console.log(Object.keys(declared).length)
    return
  }
  const migrationsDir = join(base, 'supabase/migrations')
  const migrations = readMigrations(
    readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => ({ name, source: readFileSync(join(migrationsDir, name), 'utf8') })),
  )

  const unitTests = new Map()
  for (const file of filesUnder(join(base, 'src'), /\.test\.tsx?$/)) {
    for (const match of readFileSync(file, 'utf8').matchAll(
      /describeChangeGate\(\s*['"]([a-z0-9-]+)['"]/g,
    )) {
      unitTests.set(match[1], [...(unitTests.get(match[1]) ?? []), relative(base, file)])
    }
  }
  // A toggle point is a read of a gate by the app, outside its tests.
  const togglePoints = new Map()
  for (const file of filesUnder(join(base, 'src'), /\.tsx?$/)) {
    if (/\.test\.tsx?$/.test(file)) continue
    for (const match of readFileSync(file, 'utf8').matchAll(TOGGLE_POINT)) {
      const key = match[1] ?? match[2]
      togglePoints.set(key, [...(togglePoints.get(key) ?? []), relative(base, file)])
    }
  }
  const browserTags = []
  for (const dir of ['e2e', 'e2e-auth']) {
    for (const file of filesUnder(join(base, dir), /\.spec\.ts$/)) {
      for (const match of readFileSync(file, 'utf8').matchAll(TAG)) {
        browserTags.push({
          kind: match[1],
          key: match[2],
          file: relative(base, file).replace(/\\/g, '/'),
        })
      }
    }
  }

  const archived = readdirSync(join(base, 'openspec/changes/archive')).map((name) =>
    name.replace(/^\d{4}-\d{2}-\d{2}-/, ''),
  )
  const active = readFolders(base).map((folder) => folder.name)

  const { failures, warnings } = checkChangeGates({
    declared,
    retired,
    ...migrations,
    unitTests,
    browserTags,
    togglePoints,
    changes: new Set([...active, ...archived]),
    today: todayInIndia(),
  })
  const all = [...failures, ...proposalFailures]

  print(warnings, '!', process.stdout)
  if (all.length === 0) {
    console.log(
      `Every change gate (${Object.keys(declared).length}) is declared twice, tested both ways and on time; every change folder since ${SECTION_SINCE} says how it is released.`,
    )
    return
  }
  print(all, '✗', process.stderr)
  process.stderr.write(`${all.length} change-gate finding(s).\n`)
  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
