import { readFileSync } from 'node:fs'

// Operational helper for this explicitly authorized production incident.
// Credentials are read in memory and never printed or written to the repository.
const mode = process.argv[2]
const envFile = process.argv[3]
if (!['read', 'rehearse', 'apply', 'cancel-open'].includes(mode) || !envFile) {
  throw new Error('Usage: node scripts/rollback74-production.mjs MODE ENV_FILE')
}
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      return match ? [[match[1], match[2].trim().replace(/^(['"])(.*)\1$/, '$2')]] : []
    }),
)
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20261017000000_restore_counter_before_dish_ticks.sql',
    import.meta.url,
  ),
  'utf8',
)
const names = [
  'billing_order_guard',
  'create_billing_order',
  'revise_billing_order',
  'pay_billing_now',
  'prepare_billing_order',
  'kitchen_visible_lines',
  'kitchen_same_lines',
  'kitchen_board',
  'counter_kitchen_marks',
  'kitchen_acknowledge',
]
const quotedNames = names.map((name) => `'${name}'`).join(',')
const catalog = `select p.proname,pg_get_functiondef(p.oid) definition,p.proacl::text acl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (${quotedNames}) order by p.proname`
const financial = `select count(*) bills,sum(total_paise) total_paise,
  md5(string_agg(id::text||':'||status::text||':'||total_paise::text,',' order by id)) fingerprint
  from public.bills`
const inspect = `select jsonb_build_object('observed_at',now(),
  'read_only',current_setting('transaction_read_only'),
  'financial',(select to_jsonb(f) from (${financial}) f),
  'functions',(select jsonb_agg(to_jsonb(c)) from (${catalog}) c),
    'operator',(select jsonb_agg(jsonb_build_object('id',p.id,'active',p.is_active))
    from public.profiles p where p.full_name='Abhishek Datta' and exists
    (select 1 from public.assignments a where a.person_id=p.id and a.role='super_admin' and a.ended_on is null)),
  'migration',(select count(*) from supabase_migrations.schema_migrations where version='20261017000000')) as result`
const checks = `select jsonb_build_object('observed_at',now(),
  'create',public.create_billing_order(),'revise',public.revise_billing_order(),
  'pay_now',public.pay_billing_now(),'prepare',public.prepare_billing_order(),
  'board_has_ready_logic',(select position('kitchen_readies' in prosrc)>0 from pg_proc where oid='public.kitchen_board()'::regprocedure),
  'revision_has_dish_locks',(select position('dish_line_locked' in prosrc)>0 from pg_proc where oid='public.revise_billing_order(uuid,integer,text,timestamptz,uuid,jsonb)'::regprocedure),
  'financial',(select to_jsonb(f) from (${financial}) f)) as result`
let query = inspect
if (mode === 'rehearse' || mode === 'apply') {
  const escaped = migration.replaceAll("'", "''")
  query = `begin; ${migration}
    ${
      mode === 'apply'
        ? `insert into supabase_migrations.schema_migrations(version,name,statements)
      values ('20261017000000','restore_counter_before_dish_ticks',array['${escaped}']);`
        : ''
    }
    ${checks}; ${mode === 'apply' ? 'commit' : 'rollback'};`
}
if (mode === 'cancel-open') {
  query = `begin; set local lock_timeout='5s'; set local statement_timeout='20s';
    do $incident$
    declare actor uuid; o record; payload jsonb; response jsonb;
    begin
      select p.id into strict actor from public.profiles p
        where p.full_name='Abhishek Datta' and p.is_active and exists
        (select 1 from public.assignments a where a.person_id=p.id and a.role='super_admin' and a.ended_on is null);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
      if not public.app_account_active() or not public.app_is_owner() then
        raise exception 'Incident operator must be an active owner';
      end if;
      for o in select id from public.orders where status='open'
        and created_at>='2026-10-12T10:02:58Z' order by id for update loop
        payload:=jsonb_build_object('orderId',o.id,'reason','Owner-authorized cancellation during emergency rollback of #74');
        response:=public.manager_cancel_billing_order(gen_random_uuid(),4,
          public.billing_payload_hash(payload),clock_timestamp(),null,payload);
        if response->>'status'<>'accepted' then raise exception 'Cancellation refused: %',response->>'status'; end if;
      end loop;
    end $incident$;
    select jsonb_build_object('remaining_open_since_release',(select count(*) from public.orders where status='open' and created_at>='2026-10-12T10:02:58Z'),
      'financial',(select to_jsonb(f) from (${financial}) f)) as result; commit;`
}
const response = await fetch(
  'https://api.supabase.com/v1/projects/iefcidjbfnmsiqithqbj/database/query',
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, read_only: mode === 'read' }),
  },
)
const result = await response.json()
console.log(JSON.stringify({ mode, status: response.status, data: result }, null, 2))
if (!response.ok) process.exitCode = 1
