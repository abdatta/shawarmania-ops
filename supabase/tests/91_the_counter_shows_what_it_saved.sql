-- The counter shows what it saved (the-counter-shows-what-it-saved, design D7):
-- the `instant-saves` gate exists off, and runs only while both of #74's gates
-- are on. The on path adds nothing else to the database.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select * from no_plan();

select is((select enabled from public.change_gates where key = 'instant-saves'), false,
  'instant-saves is declared off');
select is((select code from public.change_gates where key = 'instant-saves'), 'IS',
  'its code is IS');
select is((select change_number from public.change_gates where key = 'instant-saves'), null::integer,
  'it carries no roadmap number: a correction, not a roadmap change');
select results_eq(
  $$select depends_on from public.change_gate_dependencies
     where gate_key = 'instant-saves' order by depends_on$$,
  $$values ('dish-ticks'::text), ('kitchen-ready')$$,
  'it depends on both of #74''s gates');

-- Off by default, as production is when this reaches it.
update public.change_gates set enabled = false where key in ('dish-ticks', 'kitchen-ready');

select throws_ok($$select public.change_gate_force('instant-saves', true, 'pgTAP')$$, '22023', null,
  'it cannot turn on while dish-ticks and kitchen-ready are off');
select lives_ok($$select public.change_gate_force('dish-ticks', true, 'pgTAP')$$, 'dish-ticks on');
select throws_ok($$select public.change_gate_force('instant-saves', true, 'pgTAP')$$, '22023', null,
  'nor with dish-ticks on and kitchen-ready off');
select lives_ok($$select public.change_gate_force('kitchen-ready', true, 'pgTAP')$$, 'kitchen-ready on');
select lives_ok($$select public.change_gate_force('instant-saves', true, 'pgTAP')$$,
  'it turns on once both are on');
select is(public.app_change_gate('instant-saves'), true, 'the database reads it on');

select lives_ok($$select public.change_gate_force('kitchen-ready', false, 'pgTAP')$$, 'kitchen-ready off');
select is((select enabled from public.change_gates where key = 'instant-saves'), false,
  'turning kitchen-ready off turns it off too');
select is(public.app_change_gate('instant-saves'), false, 'and the database reads it off');

select * from finish();
rollback;
