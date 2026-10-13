import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  BASELINE,
  RULES,
  formatFinding,
  lintMigrations,
  retiredGates,
  splitStatements,
} from './check-migrations.mjs'

/**
 * `lint:migrations` (a-release-can-be-switched-off, design D8): every rule has a
 * migration it fails and one it passes, #74's migration fails it, and this
 * change's own migration passes it.
 */

const BASE = `
create table public.bills (id uuid primary key, total_paise integer not null, note text);
create table public.orders (id uuid primary key);
create or replace function public.ring_bill(p_total integer) returns uuid
language plpgsql as $$ begin insert into public.bills (total_paise) values (p_total); return null; end $$;
create view public.bill_totals as select sum(total_paise) from public.bills;
create policy bills_select on public.bills for select to authenticated using (true);
create trigger bills_guard before update on public.bills for each row execute function public.ring_bill();
select cron.schedule('nightly-tidy', '0 0 * * *', $$select 1$$);
`

const AFTER = '20991231000000'

/** Lint one migration after an inventory that holds BASE. */
function lint(source, retired = ['dish-ticks']) {
  return lintMigrations(
    [
      { name: '20990101000000_base.sql', source: BASE },
      { name: `${AFTER}_change.sql`, source },
    ],
    { baseline: '20990101000000', retired },
  )
}

const rules = (source) => lint(source).findings.map((finding) => finding.rule)

/** [rule, a migration that breaks it, one that keeps it]. */
const CASES = [
  [
    'drop',
    'drop table public.bills;',
    'create table public.scratch (id int); drop table public.scratch;',
  ],
  [
    'drop',
    'alter table public.bills drop column note;',
    'alter table public.bills add column tip_paise integer;',
  ],
  [
    'drop',
    'drop function public.ring_bill(integer);',
    'create function public.helper() returns int language sql as $$ select 1 $$; drop function public.helper();',
  ],
  [
    'drop',
    'drop policy bills_select on public.bills;',
    'create table public.t (id int); create policy p on public.t using (true); drop policy p on public.t;',
  ],
  [
    'rename',
    'alter table public.bills rename column note to memo;',
    'alter table public.bills add column memo text;',
  ],
  [
    'rename',
    'alter table public.bills rename to receipts;',
    'create table public.receipts (id uuid);',
  ],
  [
    'column-change',
    'alter table public.bills alter column note type varchar(40);',
    'alter table public.bills alter column note drop not null;',
  ],
  [
    'column-change',
    "alter table public.bills alter column note set default '';",
    "alter table public.bills add column memo text default '';",
  ],
  [
    'column-not-null',
    'alter table public.bills add column tip_paise integer not null;',
    'alter table public.bills add column tip_paise integer not null default 0;',
  ],
  [
    'constraint',
    'alter table public.bills add constraint total_positive check (total_paise > 0);',
    'create table public.t (n int, constraint n_positive check (n > 0));',
  ],
  [
    'constraint',
    'create unique index bills_note_unique on public.bills (note);',
    'create index bills_note_idx on public.bills (note);',
  ],
  [
    'function-change',
    'create or replace function public.ring_bill(p_total integer) returns uuid language sql as $$ select null::uuid $$;',
    'create function public.ring_bill_v2(p_total integer) returns uuid language sql as $$ select null::uuid $$;',
  ],
  [
    'function-change',
    'create function public.ring_bill(p_total integer, p_note text) returns uuid language sql as $$ select null::uuid $$;',
    'create or replace function public.ring_bill_v2(p_total integer, p_note text) returns uuid language sql as $$ select null::uuid $$;',
  ],
  [
    'function-change',
    'alter function public.ring_bill(integer) security definer;',
    'create function public.f() returns int language sql as $$ select 1 $$; alter function public.f() security definer;',
  ],
  [
    'view-change',
    'create or replace view public.bill_totals as select 1;',
    'create view public.bill_totals_v2 as select 1;',
  ],
  [
    'trigger-ungated',
    'create trigger bills_stamp before insert on public.bills for each row execute function public.ring_bill();',
    'create table public.t (id int); create trigger t_stamp before insert on public.t for each row execute function public.ring_bill();',
  ],
  [
    'trigger-change',
    'alter table public.bills disable trigger bills_guard;',
    'create table public.t (id int); alter table public.t disable trigger all;',
  ],
  [
    'policy-ungated',
    'create policy bills_more on public.bills for select using (true);',
    'create table public.t (id int); create policy t_select on public.t using (true);',
  ],
  [
    'policy-change',
    'alter policy bills_select on public.bills using (false);',
    'create table public.t (id int); create policy p on public.t using (true); alter policy p on public.t using (false);',
  ],
  [
    'policy-change',
    'alter table public.bills disable row level security;',
    'create table public.t (id int); alter table public.t enable row level security;',
  ],
  [
    'revoke',
    'revoke execute on function public.ring_bill(integer) from authenticated;',
    'create function public.f() returns int language sql as $$ select 1 $$; revoke execute on function public.f() from public, anon;',
  ],
  [
    'revoke',
    'revoke all on public.bills from authenticated;',
    'grant select on public.bills to authenticated;',
  ],
  [
    'data',
    'update public.bills set total_paise = 0;',
    'alter table public.bills add column tip_paise integer; update public.bills set tip_paise = 0;',
  ],
  [
    'data',
    'delete from public.bills where note is null;',
    "insert into public.change_gates (key) values ('a-gate');",
  ],
  [
    'data',
    'insert into public.bills (id, total_paise) values (gen_random_uuid(), 1);',
    'create table public.t (id int); insert into public.t values (1);',
  ],
  [
    'data',
    'do $$ begin update public.bills set note = null; end $$;',
    'do $$ begin if exists (select 1 from pg_publication) then alter publication supabase_realtime add table public.bills; end if; end $$;',
  ],
  [
    'data',
    "do $$ begin execute 'delete from public.bills'; end $$;",
    "do $$ begin raise notice 'tidy'; end $$;",
  ],
  [
    'publication',
    'alter publication supabase_realtime drop table public.bills;',
    'alter publication supabase_realtime add table public.orders;',
  ],
  [
    'cron',
    "select cron.schedule('nightly-tidy', '5 0 * * *', $$select 2$$);",
    "select cron.schedule('nightly-tidy-v2', '5 0 * * *', $$select 2$$);",
  ],
  [
    'cron',
    "select cron.unschedule('nightly-tidy');",
    "select cron.schedule('a-new-job', '0 1 * * *', $$select 1$$);",
  ],
  [
    'header',
    '-- change-gate: Dish Ticks\ncreate table public.t (id int);',
    '-- change-gate: dish-ticks\ncreate table public.t (id int);',
  ],
  [
    'header',
    '-- change-gate: a\n-- change-gate: b\ncreate table public.t (id int);',
    '-- change-gate: a\n-- change-gate: a\ncreate table public.t (id int);',
  ],
  [
    'header',
    '-- release: emergency too short\ndrop table public.bills;',
    '-- release: emergency the owner authorised restoring the counter on 2026-10-17\ndrop table public.bills;',
  ],
  [
    'exception',
    '-- release-lint: allow drop — short\ndrop table public.bills;',
    '-- release-lint: allow drop — the owner agreed; nothing has read it since #12\ndrop table public.bills;',
  ],
  [
    'exception',
    '-- release-lint: allow revoke — a reason that is certainly long enough\ndrop table public.bills;',
    '-- release-lint: allow drop — a reason that is certainly long enough\ndrop table public.bills;',
  ],
  [
    'exception',
    '-- release-lint: allow everything — a reason that is certainly long enough\ndrop table public.bills;',
    '-- release-lint: allow drop, constraint — widens the check; old builds never write the new value\nalter table public.bills drop constraint c, add constraint c check (total_paise >= 0);',
  ],
]

describe('every rule fails one migration and passes another', () => {
  it.each(CASES)('%s: %s', (rule, failing, passing) => {
    expect(rules(failing)).toContain(rule)
    expect(rules(passing)).toEqual([])
  })

  it('covers every rule the lint has', () => {
    expect(new Set(CASES.map(([rule]) => rule))).toEqual(new Set(Object.keys(RULES)))
  })
})

describe('a change gate admits its own on path', () => {
  it('a trigger on an existing table, when its function checks the declared gate', () => {
    const gated = `-- change-gate: dish-ticks
create function public.stamp_dish() returns trigger language plpgsql as $$
begin
  if not public.app_change_gate('dish-ticks') then return new; end if;
  return new;
end $$;
create trigger bills_stamp_dish before insert on public.bills for each row execute function public.stamp_dish();`
    expect(rules(gated)).toEqual([])
    expect(rules(gated.replace("'dish-ticks') then", "'other-gate') then"))).toEqual([
      'trigger-ungated',
    ])
  })

  it('a permissive policy on an existing table that checks the declared gate', () => {
    const gated = `-- change-gate: dish-ticks
create policy bills_kitchen on public.bills for select to authenticated
  using (public.app_change_gate('dish-ticks'));`
    expect(rules(gated)).toEqual([])
    expect(rules(gated.replace('for select', 'as restrictive for select'))).toEqual([
      'policy-ungated',
    ])
  })

  it('replacing a function an earlier migration of the same gate created, and nothing else', () => {
    const first = `-- change-gate: dish-ticks
create function public.dish_marks() returns int language sql as $$ select 1 $$;`
    const again = (gate) => `-- change-gate: ${gate}
create or replace function public.dish_marks() returns int language sql as $$ select 2 $$;`
    const run = (gate) =>
      lintMigrations(
        [
          { name: '20990101000000_base.sql', source: BASE },
          { name: '20990201000000_first.sql', source: first },
          { name: '20990301000000_again.sql', source: again(gate) },
        ],
        { baseline: '20990101000000' },
      ).findings.map((finding) => finding.rule)
    expect(run('dish-ticks')).toEqual([])
    expect(run('kitchen-ready')).toEqual(['function-change'])
  })

  it('a function created after the baseline with no gate is existing to every later migration', () => {
    const report = lintMigrations(
      [
        { name: '20990101000000_base.sql', source: BASE },
        {
          name: '20990201000000_machinery.sql',
          source: 'create function public.m() returns int language sql as $$ select 1 $$;',
        },
        {
          name: '20990301000000_later.sql',
          source:
            '-- change-gate: x\ncreate or replace function public.m() returns int language sql as $$ select 2 $$;',
        },
      ],
      { baseline: '20990101000000' },
    )
    expect(report.findings.map((finding) => finding.rule)).toEqual(['function-change'])
  })
})

describe('a contract migration retires; an emergency admits everything', () => {
  it('a contract may drop, rename, revoke and replace, and still moves no data', () => {
    const contract = `-- release: contract dish-ticks
drop function public.ring_bill(integer);
alter table public.bills rename column note to memo;
revoke all on public.bills from anon;`
    expect(rules(contract)).toEqual([])
    expect(lint(contract).contracts).toEqual([{ file: `${AFTER}_change.sql`, gate: 'dish-ticks' }])
    expect(rules(`${contract}\nupdate public.bills set total_paise = 0;`)).toEqual(['data'])
  })

  it('retires its own gate’s row, and no other', () => {
    const retire = (key) => `-- release: contract dish-ticks
update public.change_gates set retired_at = now(), enabled = false where key = '${key}';`
    expect(rules(retire('dish-ticks'))).toEqual([])
    expect(rules(retire('kitchen-ready'))).toEqual(['data'])
    expect(rules(retire('dish-ticks').replace('release: contract', 'change-gate:'))).toEqual([
      'data',
    ])
  })

  it('needs its key retired in the code first', () => {
    const report = lint('-- release: contract dish-ticks\ndrop table public.bills;', [])
    expect(report.findings).toEqual([
      expect.objectContaining({
        rule: 'header',
        what: expect.stringContaining('RETIRED_CHANGE_GATES'),
      }),
    ])
  })

  it('is printed, with its reason', () => {
    const report = lint(
      '-- release: emergency the owner authorised restoring the counter on 2026-10-17\ndrop table public.bills;',
    )
    expect(report.findings).toEqual([])
    expect(report.emergencies).toEqual([
      expect.objectContaining({
        reason: 'the owner authorised restoring the counter on 2026-10-17',
      }),
    ])
  })
})

describe('exceptions', () => {
  it('cover only the statement directly below them, and are reported', () => {
    const source = `-- release-lint: allow drop — closes a read reported 2026-11-02;
-- applying it to old builds is the point
drop policy bills_select on public.bills;
drop table public.orders;`
    const report = lint(source)
    expect(report.findings.map((finding) => [finding.rule, finding.line])).toEqual([['drop', 4]])
    expect(report.exceptions).toEqual([
      {
        file: `${AFTER}_change.sql`,
        line: 1,
        rules: ['drop'],
        reason: 'closes a read reported 2026-11-02; applying it to old builds is the point',
      },
    ])
  })
})

describe('reading SQL', () => {
  it('reads the tombstones from the gate declarations', () => {
    const declared = `export const RETIRED_CHANGE_GATES: readonly string[] = [
  'probe', // 'not-this'
  'old-one',
]`
    expect(retiredGates(declared)).toEqual(['probe', 'old-one'])
    expect(retiredGates('export const RETIRED_CHANGE_GATES: readonly string[] = []')).toEqual([])
  })

  it('ignores prose, strings and function bodies', () => {
    const source = `-- We never drop table public.bills, and this comment says so.
/* nor do we update public.bills set anything */
comment on table public.bills is 'drop table public.bills is forbidden';
create function public.write_path() returns void language plpgsql as $$
begin
  update public.bills set note = 'run time, not migration time';
  delete from public.bills where false;
end $$;`
    expect(rules(source)).toEqual([])
  })

  it('splits on semicolons outside strings, bodies and comments, and keeps line numbers', () => {
    const { statements } = splitStatements("select 'a;b';\n-- c;\nselect $x$ ; $x$;\n\nselect 1;")
    expect(statements.map((statement) => statement.line)).toEqual([1, 3, 5])
  })

  it('names the finding’s line, rule, why, instead and the docs', () => {
    const [finding] = lint(
      '\n\ncreate or replace function public.ring_bill(p integer) returns uuid language sql as $$ select null::uuid $$;',
    ).findings
    const text = formatFinding(finding)
    expect(text).toContain(`supabase/migrations/${AFTER}_change.sql:3  [function-change]`)
    expect(text).toContain('Why: published builds call this function')
    expect(text).toContain('Create `public.ring_bill_v2(...)`')
    expect(text).toContain('docs/RELEASES.md#migrations-only-add')
  })
})

describe('the real migrations', () => {
  const dir = resolve(process.cwd(), 'supabase/migrations')
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, source: readFileSync(resolve(dir, name), 'utf8') }))

  it('pass after the baseline, this change’s own migration among them', () => {
    const gates = readFileSync(resolve(process.cwd(), 'src/change-gates/gates.ts'), 'utf8')
    const report = lintMigrations(files, { retired: retiredGates(gates) })
    expect(report.linted).toContain('20261018000000_change_gates.sql')
    expect(report.findings).toEqual([])
    expect(BASELINE).toBe('20261017000000')
  })

  it('fail #74, at the function the published counter called', () => {
    const report = lintMigrations(
      files.filter((file) => file.name <= '20261016010000_the_kitchen_reports_ready_food.sql'),
      { baseline: '20261015000000' },
    )
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        file: '20261016010000_the_kitchen_reports_ready_food.sql',
        line: 209,
        rule: 'function-change',
        object: 'public.counter_kitchen_marks',
      }),
    )
  })
})
