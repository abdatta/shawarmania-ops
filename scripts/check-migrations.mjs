#!/usr/bin/env node
/**
 * Migrations only add (a-release-can-be-switched-off, design D8).
 *
 * A migration is published before the build that uses it, and it stays
 * published when a change gate turns off or an earlier build is republished.
 * Nothing undoes it: `deploy.yml` pushes forward only, and a migration cannot be
 * turned off. So every migration must leave every published build working, and
 * this lint holds that for whichever agent wrote the migration.
 *
 * On 12 October #74's migration replaced `counter_kitchen_marks`, a function the
 * published counter called every few seconds. Turning anything off in the app
 * could not have brought the old function back. Under this lint that migration
 * fails, and its author is told to write `counter_kitchen_marks_v2` instead.
 *
 * **How it reads a migration.** Files at or before the baseline are read for
 * the inventory of what already exists — tables, functions, views, scheduled
 * jobs — and are never linted themselves. Files after it are linted in order, and
 * what each creates joins the inventory for the next. Comments are dropped before
 * matching, because a migration's prose describes the rules it keeps; string
 * contents are blanked, because a gate's title may say "drop"; and the bodies of
 * functions are set aside, because a function writing at run time is the app's
 * write path, not a migration moving data. A `do` block runs once, at migration
 * time, so its body is linted statement by statement, `execute '…'` included.
 *
 * **What it cannot see.** A `select` that calls a function which writes, and SQL
 * assembled at run time from anything but a literal. Review carries those, as it
 * does every Edge Function (AGENTS.md).
 *
 * **Its three ways through**, each printed on every run:
 *
 * - `-- change-gate: <key>` in a migration's header says the migration serves that
 *   gate's on path. Its triggers and policies on existing tables must check
 *   `app_change_gate('<key>')`, and a function or view it creates may be replaced
 *   later by another migration declaring the same gate.
 * - `-- release: contract <key>` is a retirement's contract migration: it may
 *   drop, rename, retype, revoke and replace, once no published build uses the
 *   old shape. It still moves no data.
 * - `-- release-lint: allow <rule>[, <rule>] — <reason>` above one statement admits
 *   that statement for those rules. `-- release: emergency <reason>` admits a whole
 *   corrective migration the owner authorised. Both need a reason of twenty
 *   characters or more.
 *
 * Every failure says what is wrong and where, why the rule exists, and what to
 * write instead, so an agent can fix it from the message alone (D12).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Files at or before this are the inventory; files after it are linted. */
export const BASELINE = '20261017000000'

export const DOCS = 'docs/RELEASES.md#migrations-only-add'

const MIN_REASON = 20

const GATE_KEY = /^[a-z][a-z0-9-]*$/

/** The only existing tables a migration inserts into: gate declarations. */
const DECLARATION_TABLES = new Set(['public.change_gates', 'public.change_gate_dependencies'])

/**
 * Every rule: why it exists, and what to write instead. `instead` may take the
 * finding, so the message can name the `_v2` to create or the gate to check.
 */
export const RULES = {
  drop: {
    why: 'every published build may still use what this removes, and a gate turned off cannot bring it back.',
    instead: () =>
      'Leave it in place. Removing it is the retirement’s contract migration (`-- release: contract <key>`), written once no published build uses it.',
  },
  rename: {
    why: 'every published build names the object by its current name.',
    instead: () =>
      'Add the new shape alongside the old (a new column the on path writes, or `<name>_v2`), and drop the old in the contract migration.',
  },
  'column-change': {
    why: 'a published build reads and writes this column as it is; a new type, default or `not null` can fail its writes.',
    instead: () =>
      'Add a new column with the new shape. The on path writes it (or both), and the contract migration drops the old one.',
  },
  'column-not-null': {
    why: 'a published build inserts rows without this column, and `not null` with no default fails every one of them.',
    instead: () =>
      'Add it nullable or with a default, and require the value in the on path’s function.',
  },
  constraint: {
    why: 'a write a published build makes today may break a new constraint (a unique index is one).',
    instead: () =>
      'Enforce it in the on path’s function. Widening a check so the on path can write a new value? Keep it one statement and say so above it: `-- release-lint: allow drop, constraint — <why old builds are unaffected>`.',
  },
  'function-change': {
    why: 'published builds call this function as it is now, and turning a gate off cannot undo a migration that changed it.',
    instead: (finding) =>
      `Create \`${v2(finding.object)}(...)\` in this migration, call it only from the gate's on path, and leave \`${finding.object}\` untouched. The contract migration drops the old one.`,
  },
  'view-change': {
    why: 'published builds read this view as it is now, and turning a gate off cannot undo a migration that changed it.',
    instead: (finding) =>
      `Create \`${v2(finding.object)}\` in this migration, read it only from the gate's on path, and leave \`${finding.object}\` untouched. The contract migration drops the old one.`,
  },
  'trigger-ungated': {
    why: 'a trigger on an existing table fires for every published build’s writes, gate on or off.',
    instead: (finding) =>
      `Declare the gate in the header (\`-- change-gate: <key>\`), define the trigger's function in this migration, and open its body with \`if not public.app_change_gate('${finding.gate ?? '<key>'}') then return new; end if;\`.`,
  },
  'trigger-change': {
    why: 'enabling or disabling a trigger changes what every published build’s writes do.',
    instead: () =>
      'Add a new trigger that checks `app_change_gate(<key>)`; the contract migration retires the old one.',
  },
  'policy-ungated': {
    why: 'a policy on an existing table changes what every published build can read or write, gate on or off; a restrictive one narrows it for all of them.',
    instead: (finding) =>
      `Declare the gate in the header (\`-- change-gate: <key>\`) and add a permissive policy whose expression includes \`public.app_change_gate('${finding.gate ?? '<key>'}')\`.`,
  },
  'policy-change': {
    why: 'altering or replacing a policy, or switching Row-Level Security, changes access for every published build.',
    instead: () =>
      'Add a new permissive policy that checks `app_change_gate(<key>)`; the contract migration removes the old. A security fix meant to reach old builds takes an inline exception, with the owner’s agreement recorded in the design.',
  },
  revoke: {
    why: 'a published build may rely on the privilege.',
    instead: () =>
      'Keep the grant. Revoke it in the contract migration, once no published build uses it.',
  },
  data: {
    why: 'old builds and the off state still read these rows, and a migration’s update or delete cannot be turned off.',
    instead: () =>
      'A migration inserts gate rows and backfills columns it added, nothing else. Change other rows in the on path’s function, or in a one-off the owner reviews.',
  },
  publication: {
    why: 'published builds listen to every table in the publication.',
    instead: () => 'Only `add table`. Removing one is the contract migration’s.',
  },
  cron: {
    why: 'a scheduled job runs whatever build is published; rescheduling or removing one cannot be turned off.',
    instead: () =>
      'Schedule a new job under a new name, whose function checks `app_change_gate(<key>)`. The contract migration unschedules the old one.',
  },
  header: {
    why: 'the header tells this lint which gate a migration serves.',
    instead: () =>
      'Write at most one `-- change-gate: <key>`; or `-- release: contract <key>` on its own; or `-- release: emergency <reason of 20 or more characters>`.',
  },
  exception: {
    why: 'an exception admits one statement, for named rules, with a reason anyone can read later.',
    instead: () =>
      'Write `-- release-lint: allow <rule>[, <rule>] — <reason of 20 or more characters>` directly above the statement it covers, and remove it if the statement breaks none of those rules.',
  },
}

/** What a retirement's contract migration may do that no other migration may. */
const CONTRACT_ADMITS = new Set([
  'drop',
  'rename',
  'column-change',
  'column-not-null',
  'constraint',
  'function-change',
  'view-change',
  'trigger-change',
  'policy-change',
  'revoke',
  'publication',
  'cron',
])

function v2(name) {
  return `${name}_v2`
}

// ── Reading SQL ─────────────────────────────────────────────────────────────

/**
 * Split SQL into top-level statements, with comments, strings and dollar-quoted
 * bodies understood, so a `;` inside any of them does not end a statement.
 *
 * Each statement carries `code` (comments removed, strings kept, each body
 * replaced by a marker), `bare` (strings blanked too), the line it starts on,
 * the comments directly above it and its bodies with the lines they start on.
 *
 * @returns {{ statements: Statement[], comments: Comment[] }}
 */
export function splitStatements(source, firstLine = 1) {
  const statements = []
  const allComments = []
  let code = ''
  let bare = ''
  let bodies = []
  let comments = []
  let start = null
  let line = firstLine
  let i = 0
  const n = source.length
  const isWord = (ch) => ch !== undefined && /[A-Za-z0-9_]/.test(ch)

  const flush = () => {
    if (start !== null) statements.push({ code, bare, line: start, comments, bodies })
    code = ''
    bare = ''
    bodies = []
    comments = []
    start = null
  }
  const begin = () => {
    if (start === null) start = line
  }
  const countLines = (text) => (text.match(/\n/g) ?? []).length

  while (i < n) {
    const c = source[i]
    const next = source[i + 1]

    if (c === '-' && next === '-') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? n : end
      const comment = { line, text: source.slice(i, stop) }
      allComments.push(comment)
      if (start === null) comments.push(comment)
      i = stop
      continue
    }

    if (c === '/' && next === '*') {
      let depth = 1
      let j = i + 2
      while (j < n && depth > 0) {
        if (source[j] === '/' && source[j + 1] === '*') {
          depth += 1
          j += 2
        } else if (source[j] === '*' && source[j + 1] === '/') {
          depth -= 1
          j += 2
        } else {
          j += 1
        }
      }
      line += countLines(source.slice(i, j))
      code += ' '
      bare += ' '
      i = j
      continue
    }

    if (c === "'") {
      begin()
      const escapes = /[eE]/.test(source[i - 1] ?? '') && !isWord(source[i - 2])
      let j = i + 1
      while (j < n) {
        if (escapes && source[j] === '\\') {
          j += 2
        } else if (source[j] === "'" && source[j + 1] === "'") {
          j += 2
        } else if (source[j] === "'") {
          break
        } else {
          j += 1
        }
      }
      const literal = source.slice(i, j + 1)
      line += countLines(literal)
      code += literal
      bare += "''"
      i = j + 1
      continue
    }

    if (c === '"') {
      begin()
      let j = i + 1
      while (j < n && !(source[j] === '"' && source[j + 1] !== '"')) j += source[j] === '"' ? 2 : 1
      const quoted = source.slice(i, j + 1)
      code += quoted
      bare += quoted
      i = j + 1
      continue
    }

    if (c === '$' && !isWord(source[i - 1])) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i, i + 64))
      if (tag) {
        begin()
        const open = i + tag[0].length
        const end = source.indexOf(tag[0], open)
        const stop = end === -1 ? n : end
        const text = source.slice(open, stop)
        bodies.push({ text, line })
        line += countLines(text)
        const marker = ` «${bodies.length - 1}» `
        code += marker
        bare += marker
        i = end === -1 ? n : end + tag[0].length
        continue
      }
    }

    if (c === ';') {
      flush()
      i += 1
      continue
    }

    if (c === '\n') line += 1
    else if (!/\s/.test(c)) begin()
    code += c
    bare += c
    i += 1
  }
  flush()
  return { statements, comments: allComments }
}

const ID = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_$]*))?`

/** `public.name` for an unqualified or quoted name; other schemas kept. */
export function qualify(raw) {
  const name = raw.replace(/"/g, '').toLowerCase()
  return name.includes('.') ? name : `public.${name}`
}

const flat = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim()

/** Split on commas outside parentheses. */
function topLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Object names in a list like `a, public.b(text, int), "C"`. */
function namesIn(list) {
  return topLevel(list.replace(/\b(cascade|restrict)\b/g, ''))
    .map((part) => part.replace(/\(.*$/, '').trim())
    .filter(Boolean)
    .map(qualify)
}

const gateCheck = (key) => new RegExp(String.raw`app_change_gate\s*\(\s*'${key}'\s*\)`, 'i')

/** `where key = '<key>'`: an update of one gate's row and no other. */
const gateKeyCheck = (key) => new RegExp(String.raw`\bwhere key = '${key}'\s*$`, 'i')

// ── The rules ───────────────────────────────────────────────────────────────

/**
 * What one statement breaks, if anything, and what it creates. `file` holds
 * what this migration created so far and its gate; `known` is the inventory.
 */
function classify(s, code, file, known) {
  const found = []
  const fail = (rule, what, extra = {}) => found.push({ rule, what, ...extra })
  const isNew = (name) => file.created.has(name)
  const exists = (name) => !isNew(name)

  let m

  // ── Creating ──
  if (
    (m = new RegExp(
      String.raw`^create (?:or replace )?(?:temp |temporary |unlogged )?table (if not exists )?(${ID})`,
    ).exec(s))
  ) {
    const name = qualify(m[2])
    if (!known.tables.has(name)) {
      file.created.add(name)
      file.tables.add(name)
    }
    return found
  }

  if (
    (m = new RegExp(
      String.raw`^create (or replace )?(?:materialized )?view (?:if not exists )?(${ID})`,
    ).exec(s))
  ) {
    const name = qualify(m[2])
    if (known.views.has(name) && !isNew(name)) {
      if (!sameGate(known.views.get(name), file)) {
        fail('view-change', `replaces the view \`${name}\``, { object: name })
      }
    } else {
      file.created.add(name)
      file.views.set(name, file.gate)
    }
    return found
  }

  if (
    (m = new RegExp(String.raw`^create (or replace )?(?:function|procedure) (${ID})\s*\(`).exec(s))
  ) {
    const name = qualify(m[2])
    if (known.functions.has(name) && !isNew(name)) {
      if (!sameGate(known.functions.get(name), file)) {
        fail(
          'function-change',
          m[1]
            ? `replaces the function \`${name}\``
            : `adds an overload of the function \`${name}\``,
          { object: name },
        )
      }
    } else {
      file.created.add(name)
      file.functions.set(name, file.gate)
    }
    return found
  }

  if (
    (m = new RegExp(
      String.raw`^create (?:or replace )?(?:constraint )?trigger (\S+) .*? on (${ID}) .*?execute (?:function|procedure) (${ID})\s*\(`,
    ).exec(s))
  ) {
    const table = qualify(m[2])
    if (exists(table)) {
      const fn = qualify(m[3])
      const body = file.bodies.get(fn) ?? known.bodies.get(fn)
      if (!file.gate) {
        fail(
          'trigger-ungated',
          `adds the trigger \`${m[1]}\` to the existing table \`${table}\` in a migration that declares no change gate`,
        )
      } else if (!body || !gateCheck(file.gate).test(body)) {
        fail(
          'trigger-ungated',
          `adds the trigger \`${m[1]}\` to the existing table \`${table}\`, and its function \`${fn}\` ${body ? `never checks \`app_change_gate('${file.gate}')\`` : 'is not defined in a migration after the baseline'}`,
          { gate: file.gate },
        )
      }
    }
    file.created.add(qualify(m[1]))
    return found
  }

  if ((m = new RegExp(String.raw`^create policy (\S+) on (${ID})(.*)$`).exec(s))) {
    const table = qualify(m[2])
    if (exists(table)) {
      if (/\bas restrictive\b/.test(m[3])) {
        fail(
          'policy-ungated',
          `adds the restrictive policy \`${m[1]}\` to the existing table \`${table}\``,
          { gate: file.gate },
        )
      } else if (!file.gate) {
        fail(
          'policy-ungated',
          `adds the policy \`${m[1]}\` to the existing table \`${table}\` in a migration that declares no change gate`,
        )
      } else if (!gateCheck(file.gate).test(code)) {
        fail(
          'policy-ungated',
          `adds the policy \`${m[1]}\` to the existing table \`${table}\` without checking \`app_change_gate('${file.gate}')\``,
          { gate: file.gate },
        )
      }
    }
    return found
  }

  if (
    (m = new RegExp(
      String.raw`^create (unique )?index (?:concurrently )?(?:if not exists )?(?:(${ID}) )?on (?:only )?(${ID})`,
    ).exec(s))
  ) {
    const table = qualify(m[3])
    if (m[1] && exists(table)) {
      fail('constraint', `adds a unique index to the existing table \`${table}\``)
    }
    if (m[2]) file.created.add(qualify(m[2]))
    return found
  }

  if (
    (m = new RegExp(
      String.raw`^create (?:type|domain|sequence|schema|extension|publication) (?:if not exists )?(${ID})`,
    ).exec(s))
  ) {
    file.created.add(qualify(m[1]))
    return found
  }

  // ── Removing ──
  if (
    (m =
      /^drop (materialized view|view|table|function|procedure|routine|trigger|policy|index|type|domain|sequence|schema|extension|publication|aggregate|rule|event trigger) (?:concurrently )?(?:if exists )?(.*)$/.exec(
        s,
      ))
  ) {
    const kind = m[1]
    if (kind === 'trigger' || kind === 'policy' || kind === 'rule') {
      const on = new RegExp(String.raw`^(\S+) on (${ID})`).exec(m[2])
      if (on && exists(qualify(on[2]))) {
        fail('drop', `drops the ${kind} \`${on[1]}\` on the existing table \`${qualify(on[2])}\``)
      }
      return found
    }
    const names = namesIn(m[2])
    const old = names.filter(exists)
    if (old.length > 0)
      fail('drop', `drops the ${kind} ${old.map((name) => `\`${name}\``).join(', ')}`)
    for (const name of names) forget(name, known)
    return found
  }

  // ── Changing tables ──
  if ((m = new RegExp(String.raw`^alter table (?:if exists )?(?:only )?(${ID}) (.*)$`).exec(s))) {
    const table = qualify(m[1])
    if (isNew(table)) return found
    for (const action of topLevel(m[2])) {
      let a
      if (/^rename to /.test(action) || /^set schema /.test(action)) {
        fail('rename', `renames the table \`${table}\``)
        const to = /^rename to (\S+)/.exec(action)
        if (to) {
          known.tables.delete(table)
          known.tables.add(qualify(to[1]))
        }
      } else if (/^rename /.test(action)) {
        fail('rename', `renames a column or constraint of \`${table}\`: \`${action}\``)
      } else if (
        /^add (?:constraint|check|unique|primary key|foreign key|exclude)\b/.test(action)
      ) {
        fail('constraint', `adds a constraint to the existing table \`${table}\``)
      } else if (
        (a = new RegExp(String.raw`^add (?:column )?(?:if not exists )?(${ID})\s*(.*)$`).exec(
          action,
        ))
      ) {
        const column = a[1].replace(/"/g, '')
        if (/\bnot null\b/.test(a[2]) && !/\b(default|generated)\b/.test(a[2])) {
          fail('column-not-null', `adds \`${table}.${column}\` as \`not null\` with no default`)
        }
        if (!file.addedColumns.has(table)) file.addedColumns.set(table, new Set())
        file.addedColumns.get(table).add(column)
      } else if (/^drop (?:column|constraint)\b/.test(action)) {
        fail('drop', `drops from the existing table \`${table}\`: \`${action}\``)
      } else if ((a = /^alter (?:column )?(\S+) (.*)$/.exec(action))) {
        if (
          !/^(drop not null|set statistics|set storage|set compression|set \(|reset \()/.test(a[2])
        ) {
          fail(
            'column-change',
            `changes the existing column \`${table}.${a[1].replace(/"/g, '')}\`: \`${a[2]}\``,
          )
        }
      } else if (/^(enable|disable|force|no force) row level security/.test(action)) {
        fail('policy-change', `switches Row-Level Security on the existing table \`${table}\``)
      } else if (/^(enable|disable) (?:always |replica )?trigger\b/.test(action)) {
        fail(
          'trigger-change',
          `${action.split(' ')[0]}s a trigger on the existing table \`${table}\``,
        )
      }
    }
    return found
  }

  // ── Changing functions, views, policies, triggers, types ──
  if ((m = new RegExp(String.raw`^alter (?:function|procedure|routine) (${ID})`).exec(s))) {
    const name = qualify(m[1])
    if (exists(name) && !sameGate(known.functions.get(name), file)) {
      fail('function-change', `alters the function \`${name}\``, { object: name })
    }
    return found
  }
  if ((m = new RegExp(String.raw`^alter (?:materialized )?view (?:if exists )?(${ID})`).exec(s))) {
    const name = qualify(m[1])
    if (exists(name) && !sameGate(known.views.get(name), file)) {
      fail('view-change', `alters the view \`${name}\``, { object: name })
    }
    return found
  }
  if ((m = new RegExp(String.raw`^alter policy (\S+) on (${ID})`).exec(s))) {
    if (exists(qualify(m[2])))
      fail('policy-change', `alters the policy \`${m[1]}\` on \`${qualify(m[2])}\``)
    return found
  }
  if ((m = new RegExp(String.raw`^alter trigger (\S+) on (${ID})`).exec(s))) {
    if (exists(qualify(m[2])))
      fail('rename', `renames the trigger \`${m[1]}\` on \`${qualify(m[2])}\``)
    return found
  }
  if ((m = new RegExp(String.raw`^alter (?:type|domain) (${ID}) (.*)$`).exec(s))) {
    const name = qualify(m[1])
    if (isNew(name) || /^add value\b/.test(m[2])) return found
    if (/^rename\b/.test(m[2])) fail('rename', `renames in the type \`${name}\``)
    else fail('column-change', `changes the type \`${name}\`: \`${m[2]}\``)
    return found
  }
  if ((m = /^alter publication (\S+) (add|drop|set) /.exec(s))) {
    if (m[2] !== 'add')
      fail(
        'publication',
        `${m[2] === 'drop' ? 'removes tables from' : 'replaces the tables of'} the publication \`${m[1]}\``,
      )
    return found
  }

  // ── Privileges ──
  if ((m = /^revoke (.*?) on (.*?) from /.exec(s))) {
    const target = m[2]
    if (
      /^all (tables|functions|sequences|routines|procedures) in schema /.test(target) ||
      /^schema /.test(target)
    ) {
      fail('revoke', `revokes on \`${target}\``)
      return found
    }
    const list = target.replace(
      /^(table|function|procedure|routine|sequence|type|domain|view) /,
      '',
    )
    const old = namesIn(list).filter(exists)
    if (old.length > 0)
      fail('revoke', `revokes \`${m[1]}\` on ${old.map((name) => `\`${name}\``).join(', ')}`)
    return found
  }

  // ── Data ──
  if ((m = new RegExp(String.raw`^insert into (${ID})`).exec(s))) {
    const table = qualify(m[1])
    if (exists(table) && !DECLARATION_TABLES.has(table))
      fail('data', `inserts into the existing table \`${table}\``)
    return found
  }
  if (
    (m = new RegExp(
      String.raw`^update (?:only )?(${ID})(?: (?:as )?[a-z_]\w*)? set (.*?)(?: where | from | returning |$)`,
    ).exec(s))
  ) {
    const table = qualify(m[1])
    if (exists(table)) {
      const added = file.addedColumns.get(table) ?? new Set()
      const columns = topLevel(m[2]).map((assignment) =>
        assignment.split('=')[0].trim().replace(/"/g, ''),
      )
      // A contract migration retires its gate: `retired_at`, and off with it.
      if (
        file.contract &&
        table === 'public.change_gates' &&
        columns.every((column) => column === 'retired_at' || column === 'enabled') &&
        gateKeyCheck(file.gate).test(code)
      ) {
        return found
      }
      const others = columns.filter((column) => !added.has(column))
      if (others.length > 0) {
        fail(
          'data',
          `updates ${others.map((column) => `\`${table}.${column}\``).join(', ')}, which this migration did not add`,
        )
      }
    }
    return found
  }
  if (
    (m = new RegExp(
      String.raw`^(?:delete from|truncate(?: table)?|merge into|copy) (?:only )?(${ID})`,
    ).exec(s))
  ) {
    const table = qualify(m[1])
    if (exists(table)) fail('data', `${s.split(' ')[0]}s rows of the existing table \`${table}\``)
    return found
  }
  if (/^with\b/.test(s) && /\b(update \S+ set|delete from|insert into)\b/.test(s)) {
    fail('data', 'moves data through a `with` query')
    return found
  }

  return found
}

/** Scheduled jobs, wherever they are called from. */
function cronFindings(code, file, known) {
  const found = []
  for (const match of code.matchAll(/cron\.schedule\s*\(\s*'([^']+)'/gi)) {
    const job = match[1]
    if (known.cronJobs.has(job) && !file.cronJobs.has(job)) {
      found.push({ rule: 'cron', what: `reschedules the existing job \`${job}\`` })
    }
    file.cronJobs.add(job)
  }
  if (/cron\.(unschedule|alter_job)\s*\(/i.test(code)) {
    found.push({ rule: 'cron', what: 'unschedules or alters a scheduled job' })
  }
  return found
}

function sameGate(owner, file) {
  return Boolean(owner) && owner === file.gate
}

function forget(name, known) {
  known.tables.delete(name)
  known.views.delete(name)
  known.functions.delete(name)
}

/** PL/pgSQL around a statement in a `do` block. */
const CONTROL =
  /^(?:<<\w+>> |declare\b.*?\bbegin |begin |if\b.*?\bthen |elsif\b.*?\bthen |else |loop |for\b.*?\bloop |foreach\b.*?\bloop |while\b.*?\bloop |end if |end loop |end |exception when\b.*?\bthen |when\b.*?\bthen )/

/** Findings for one statement, a `do` block's included, each with a line. */
function lintStatement(statement, file, known) {
  const s = flat(statement.bare)
  const code = flat(statement.code)

  // Remember each function's body, for a later trigger's gate check.
  const fn = new RegExp(
    String.raw`^create (?:or replace )?(?:function|procedure) (${ID})\s*\(`,
  ).exec(s)
  if (fn && statement.bodies[0])
    file.bodies.set(qualify(fn[1]), statement.bodies[0].text.toLowerCase())

  if (/^do\b/.test(s)) {
    const found = []
    for (const body of statement.bodies) {
      for (const inner of splitStatements(body.text, body.line).statements) {
        found.push(...lintDynamic(inner, file, known))
      }
    }
    return found
  }

  return [
    ...classify(s, code, file, known).map((finding) => ({ ...finding, line: statement.line })),
    ...cronFindings(statement.code, file, known).map((finding) => ({
      ...finding,
      line: statement.line,
    })),
  ]
}

/** A statement inside a `do` block, where strings may be SQL being executed. */
function lintDynamic(statement, file, known) {
  let s = flat(statement.code)
  for (let control = CONTROL.exec(s); control; control = CONTROL.exec(s))
    s = s.slice(control[0].length)
  if (!s || s === 'end') return []

  const executed = /^execute '((?:[^']|'')*)'/.exec(s)
  if (executed) {
    const sql = executed[1].replace(/''/g, "'")
    return splitStatements(sql, statement.line).statements.flatMap((inner) =>
      lintStatement(inner, file, known),
    )
  }

  const bare = s.replace(/'(?:[^']|'')*'/g, "''")
  return [
    ...classify(bare, s, file, known).map((finding) => ({ ...finding, line: statement.line })),
    ...cronFindings(statement.code, file, known).map((finding) => ({
      ...finding,
      line: statement.line,
    })),
  ]
}

// ── Headers and exceptions ──────────────────────────────────────────────────

function readHeader(comments) {
  const header = { gates: [], contracts: [], emergency: null, problems: [] }
  for (const { line, text } of comments) {
    const body = text.replace(/^--\s?/, '')
    let m
    if ((m = /^\s*change-gate:\s*(\S*)/.exec(body))) {
      if (!GATE_KEY.test(m[1]))
        header.problems.push({ line, what: `names no valid gate key: \`${text.trim()}\`` })
      else header.gates.push(m[1])
    } else if ((m = /^\s*release:\s*contract\b\s*(\S*)/.exec(body))) {
      if (!GATE_KEY.test(m[1]))
        header.problems.push({ line, what: `names no valid gate key: \`${text.trim()}\`` })
      else header.contracts.push(m[1])
    } else if ((m = /^\s*release:\s*emergency\b\s*(.*)$/.exec(body))) {
      if (m[1].trim().length < MIN_REASON) {
        header.problems.push({
          line,
          what: `gives an emergency reason under ${MIN_REASON} characters`,
        })
      } else {
        header.emergency = { line, reason: m[1].trim() }
      }
    } else if (/^\s*release:/.test(body)) {
      header.problems.push({
        line,
        what: `is not a release declaration this lint knows: \`${text.trim()}\``,
      })
    }
  }
  if (new Set(header.gates).size > 1) {
    header.problems.push({
      line: 1,
      what: `declares more than one change gate: ${[...new Set(header.gates)].join(', ')}`,
    })
  }
  if (header.gates.length > 0 && header.contracts.length > 0) {
    header.problems.push({ line: 1, what: 'is both a gate’s on path and a contract migration' })
  }
  return header
}

/** `-- release-lint: allow <rules> — <reason>`, with its reason's continuation lines. */
function readExceptions(comments) {
  const exceptions = []
  let open = null
  for (const { line, text } of comments) {
    const body = text.replace(/^--\s?/, '').trim()
    const directive = /^release-lint:\s*(.*)$/.exec(body)
    if (directive) {
      const allow = /^allow\s+([a-z-]+(?:\s*,\s*[a-z-]+)*)\s*(?:—|–|--|-|:)?\s*(.*)$/.exec(
        directive[1],
      )
      open = {
        line,
        rules: allow ? allow[1].split(/\s*,\s*/) : [],
        reason: allow ? allow[2] : '',
        malformed: !allow,
        lastLine: line,
      }
      exceptions.push(open)
    } else if (
      open &&
      line === open.lastLine + 1 &&
      body &&
      !/^(change-gate|release):/.test(body)
    ) {
      open.reason = `${open.reason} ${body}`.trim()
      open.lastLine = line
    } else {
      open = null
    }
  }
  return exceptions
}

// ── The whole directory ─────────────────────────────────────────────────────

const stampOf = (name) => name.split('_')[0]

/**
 * Lint every migration after the baseline against everything before it.
 *
 * @param {{ name: string, source: string }[]} files in any order
 * @param {{ baseline?: string, retired?: readonly string[] }} options — `retired`
 *   is `RETIRED_CHANGE_GATES`: a contract migration may retire only a key the code
 *   has already moved there (D11 step 11).
 * @returns {{ findings: Finding[], exceptions: object[], emergencies: object[], contracts: object[], linted: string[] }}
 */
export function lintMigrations(files, { baseline = BASELINE, retired = [] } = {}) {
  const known = {
    tables: new Set(),
    views: new Map(),
    functions: new Map(),
    bodies: new Map(),
    cronJobs: new Set(),
  }
  const report = { findings: [], exceptions: [], emergencies: [], contracts: [], linted: [] }
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name))

  for (const { name, source } of ordered) {
    const inventory = stampOf(name) <= baseline
    const { statements, comments } = splitStatements(source)
    const header = inventory
      ? { gates: [], contracts: [], emergency: null, problems: [] }
      : readHeader(comments)
    const file = {
      gate: header.gates[0] ?? header.contracts[0] ?? null,
      created: new Set(),
      tables: new Set(),
      views: new Map(),
      functions: new Map(),
      bodies: new Map(),
      addedColumns: new Map(),
      cronJobs: new Set(),
      contract: header.contracts.length > 0,
    }
    const contract = file.contract
    for (const key of new Set(header.contracts)) {
      if (!retired.includes(key)) {
        header.problems.push({
          line: 1,
          what: `retires \`${key}\`, which \`src/change-gates/gates.ts\` has not moved to RETIRED_CHANGE_GATES; the code retires a gate before its contract migration does`,
        })
      }
    }

    const findings = []
    for (const problem of header.problems) findings.push({ rule: 'header', ...problem })

    for (const statement of statements) {
      const raised = lintStatement(statement, file, known)
      if (inventory || header.emergency) continue

      const admitted = raised.filter((finding) => !(contract && CONTRACT_ADMITS.has(finding.rule)))
      const exceptions = readExceptions(statement.comments)
      for (const exception of exceptions) {
        const unknown = exception.rules.filter(
          (rule) => !RULES[rule] || rule === 'header' || rule === 'exception',
        )
        if (exception.malformed || unknown.length > 0) {
          findings.push({
            rule: 'exception',
            line: exception.line,
            what: exception.malformed
              ? 'is not of the form `allow <rule> — <reason>`'
              : `names no rule this lint has: ${unknown.join(', ')}`,
          })
          continue
        }
        if (exception.reason.length < MIN_REASON) {
          findings.push({
            rule: 'exception',
            line: exception.line,
            what: `gives a reason under ${MIN_REASON} characters`,
          })
          continue
        }
        const covered = admitted.filter((finding) => exception.rules.includes(finding.rule))
        const unused = exception.rules.filter(
          (rule) => !covered.some((finding) => finding.rule === rule),
        )
        if (unused.length > 0) {
          findings.push({
            rule: 'exception',
            line: exception.line,
            what: `allows ${unused.join(', ')}, but the statement below breaks no such rule`,
          })
        }
        exception.used = covered
        report.exceptions.push({
          file: name,
          line: exception.line,
          rules: exception.rules,
          reason: exception.reason,
        })
      }
      for (const finding of admitted) {
        const excepted = exceptions.some(
          (exception) =>
            !exception.malformed &&
            exception.reason.length >= MIN_REASON &&
            exception.rules.includes(finding.rule),
        )
        if (!excepted) findings.push(finding)
      }
    }

    // What this migration created is what exists for the next.
    for (const table of file.tables) known.tables.add(table)
    for (const [view, gate] of file.views) if (!known.views.has(view)) known.views.set(view, gate)
    for (const [fn, gate] of file.functions)
      if (!known.functions.has(fn)) known.functions.set(fn, gate)
    for (const [fn, body] of file.bodies) known.bodies.set(fn, body)
    for (const job of file.cronJobs) known.cronJobs.add(job)

    if (inventory) continue
    report.linted.push(name)
    if (header.emergency) report.emergencies.push({ file: name, ...header.emergency })
    if (contract) report.contracts.push({ file: name, gate: header.contracts[0] })
    for (const finding of findings) report.findings.push({ file: name, ...finding })
  }
  return report
}

/** One failure, as an agent should read it: what, where, why, instead, where to read more. */
export function formatFinding(finding, directory = 'supabase/migrations') {
  const rule = RULES[finding.rule]
  return [
    `✗ ${directory}/${finding.file}:${finding.line}  [${finding.rule}]  This statement ${finding.what}.`,
    `    Why: ${rule.why}`,
    `    Instead: ${rule.instead(finding)}`,
    `    See ${DOCS}`,
  ].join('\n')
}

const migrationsDir = () => fileURLToPath(new URL('../supabase/migrations', import.meta.url))
const gatesFile = () => fileURLToPath(new URL('../src/change-gates/gates.ts', import.meta.url))

/** The keys in `RETIRED_CHANGE_GATES`, read from the TypeScript source. */
export function retiredGates(source) {
  const list = /RETIRED_CHANGE_GATES[^=]*=\s*\[([\s\S]*?)\]/.exec(source)
  if (!list) throw new Error('src/change-gates/gates.ts declares no RETIRED_CHANGE_GATES')
  return [...list[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((match) => match[1])
}

function main() {
  const dir = migrationsDir()
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, source: readFileSync(resolve(dir, name), 'utf8') }))
  const report = lintMigrations(files, {
    retired: retiredGates(readFileSync(gatesFile(), 'utf8')),
  })

  for (const emergency of report.emergencies) {
    console.log(
      `!!! EMERGENCY  supabase/migrations/${emergency.file}:${emergency.line} admits everything: ${emergency.reason}`,
    )
  }
  for (const contract of report.contracts) {
    console.log(`·   contract    supabase/migrations/${contract.file} retires \`${contract.gate}\``)
  }
  for (const exception of report.exceptions) {
    console.log(
      `·   exception   supabase/migrations/${exception.file}:${exception.line} allows ${exception.rules.join(', ')}: ${exception.reason}`,
    )
  }

  if (report.findings.length === 0) {
    console.log(`Every migration after ${BASELINE} only adds (${report.linted.length} checked).`)
    return
  }
  for (const finding of report.findings) process.stderr.write(`${formatFinding(finding)}\n\n`)
  process.stderr.write(
    `${report.findings.length} migration finding(s). A migration stays published whatever the app turns off, so it must leave every published build working.\n`,
  )
  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
