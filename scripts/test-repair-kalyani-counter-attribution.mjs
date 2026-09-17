#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import pg from 'pg'

const { Client } = pg
const OPERATOR = path.resolve('scripts/repair-kalyani-counter-attribution.mjs')
const COMMON = [
  '--environment',
  'scratch',
  '--project-ref',
  'local',
  '--business-date',
  '2026-09-16',
  '--source',
  'skpa',
  '--target',
  'skalyani',
]
const CONFIRMATION = 'MOVE-2026-09-16-SKPA-TO-SKALYANI'
const INJECTIONS = [
  'after-guards-disabled',
  'after-menu',
  'after-orders',
  'after-payments',
  'after-later-bills',
  'after-later-commands',
  'after-bills',
  'after-commands',
  'after-expenses',
  'after-shift',
  'after-counters',
  'after-device',
  'before-guard-restore',
  'after-guard-restore',
]

function argsFrom(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value) throw new Error('Expected --before-image and --template')
    result[key.slice(2)] = value
  }
  return result
}

function databaseUrl(base, database) {
  const url = new URL(base)
  url.pathname = `/${database}`
  return url.toString()
}

async function runOperator(url, argv, { succeeds, contains } = {}) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [OPERATOR, ...argv], {
      cwd: process.cwd(),
      env: { ...process.env, SHAWARMANIA_DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), 30_000)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
  const didSucceed = result.code === 0
  if (succeeds !== undefined && didSucceed !== succeeds) {
    throw new Error(
      `Operator ${didSucceed ? 'succeeded' : 'failed'} unexpectedly: ${result.stderr}`,
    )
  }
  if (contains && !`${result.stdout}\n${result.stderr}`.includes(contains)) {
    throw new Error(`Operator result did not contain ${JSON.stringify(contains)}`)
  }
  return result
}

async function main() {
  const args = argsFrom(process.argv.slice(2))
  if (!args['before-image'] || !args.template) {
    throw new Error(
      'Usage: test-repair-kalyani-counter-attribution.mjs --before-image PATH --template DB',
    )
  }
  const adminUrl = process.env.SHAWARMANIA_REPAIR_TEST_ADMIN_URL
  if (!adminUrl) throw new Error('SHAWARMANIA_REPAIR_TEST_ADMIN_URL is required')
  const parsed = new URL(adminUrl)
  if (!['127.0.0.1', 'localhost', 'host.docker.internal'].includes(parsed.hostname)) {
    throw new Error('The repair test harness only runs against a local PostgreSQL server')
  }
  if (!/^[a-zA-Z0-9_]+$/.test(args.template)) throw new Error('Unsafe template database name')
  const bundle = JSON.parse(await readFile(path.resolve(args['before-image']), 'utf8'))
  const digest = bundle.planDigest
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  let serial = 0

  const withClone = async (label, action, { closeLaterShift = true } = {}) => {
    serial += 1
    const name = `repair_attribution_${process.pid}_${serial}_${randomUUID().slice(0, 6)}`
    await admin.query(`create database ${name} template ${args.template}`)
    const url = databaseUrl(adminUrl, name)
    try {
      if (closeLaterShift) {
        const client = new Client({ connectionString: url })
        await client.connect()
        try {
          // Production apply is allowed only after this genuine Kalyani shift
          // expires. The scratch clock may still be earlier than 04:00 IST, so
          // close only the cloned row; the plan digest intentionally freezes
          // the bill graph rather than this operational expiry state.
          await client.query(`alter table public.counter_shifts disable trigger user`)
          await client.query(
            `update public.counter_shifts
                set ended_at=least(expires_at,statement_timestamp()),
                    ended_reason='day_finished'
              where id=(
                select distinct b.counter_shift_id
                  from public.bills b
                  join public.outlets o on o.id=b.outlet_id and o.code='skalyani'
                 where b.business_date=date '2026-09-17'
                   and b.bill_number between 990 and 1024
              )`,
          )
          await client.query(`alter table public.counter_shifts enable trigger user`)
        } finally {
          await client.end()
        }
      }
      await action(url)
      console.log(`PASS ${label}`)
    } finally {
      await admin.query(
        `select pg_terminate_backend(pid)
           from pg_stat_activity
          where datname=$1 and pid<>pg_backend_pid() and backend_type='client backend'`,
        [name],
      )
      await admin.query(`drop database if exists ${name}`)
    }
  }

  const applyArgsFor = (selectedDigest, selectedBeforeImage, extra = []) => [
    'apply',
    ...COMMON,
    '--digest',
    selectedDigest,
    '--confirm',
    CONFIRMATION,
    '--before-image',
    path.resolve(selectedBeforeImage),
    ...extra,
  ]
  const applyArgs = (extra = []) => applyArgsFor(digest, args['before-image'], extra)
  const plan = async (url) => {
    const result = await runOperator(url, ['plan', ...COMMON], { succeeds: true })
    return JSON.parse(result.stdout)
  }
  const expectOriginalPlan = async (url) => {
    const current = await plan(url)
    if (current.digest !== digest)
      throw new Error('Scratch state did not return to the original plan')
  }
  const mutate = async (url, sql) => {
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      await client.query(sql)
    } finally {
      await client.end()
    }
  }

  const expectShiftClosure = async (url, relation) => {
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      const result = await client.query(
        `select s.ended_at,s.expires_at
           from public.counter_shifts s
           join public.bills b on b.counter_shift_id=s.id
           join public.outlets o on o.id=b.outlet_id and o.code='skalyani'
          where b.business_date=date '2026-09-16' and b.bill_number=990`,
      )
      if (result.rowCount !== 1) throw new Error('repaired incident shift was not found')
      const ended = new Date(result.rows[0].ended_at).getTime()
      const expires = new Date(result.rows[0].expires_at).getTime()
      if (relation === 'before' && !(ended < expires))
        throw new Error('pre-expiry apply did not close at transaction time')
      if (relation === 'at' && ended !== expires)
        throw new Error('post-expiry apply did not cap the close at stored expiry')
    } finally {
      await client.end()
    }
  }

  const simulateNextOpening = async (url, repairedTargetCounter = 1061) => {
    const expectedNextBill = repairedTargetCounter + 1
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      const identity = await client.query(
        `select d.id device_id,d.outlet_id,target.id target_id,source.id source_id,
                b.biller_profile_id operator_id,
                (select business_day_cutover from public.outlets where id=target.id) cutover,
                (select last_number from public.bill_number_counters where outlet_id=target.id)::int target_counter,
                (select last_number from public.bill_number_counters where outlet_id=source.id)::int source_counter
           from public.counter_devices d
           join public.outlets target on target.code='skalyani'
           join public.outlets source on source.code='skpa'
           join public.bills b on b.counter_device_id=d.id
          where d.label='Kalyani Counter 2'
          order by b.bill_number desc
          limit 1`,
      )
      if (identity.rowCount !== 1) throw new Error('rehearsal device identity was not found')
      const row = identity.rows[0]
      if (row.target_counter !== repairedTargetCounter || row.source_counter !== 778)
        throw new Error('rehearsal high-water marks were not at the repaired values')

      const operator = await client.query(`select lower(email) email from auth.users where id=$1`, [
        row.operator_id,
      ])
      if (operator.rowCount !== 1) throw new Error('rehearsal operator login was not found')
      const username = operator.rows[0].email.replace(/@login\.shawarmania\.invalid$/, '')
      const codeHash = `rehearsal-${randomUUID()}`
      const request = await client.query(
        `select * from public.request_counter_shift($1,$2,$3,$4::interval)`,
        [row.device_id, username, codeHash, '2 minutes'],
      )
      if (request.rows[0]?.status !== 'ok')
        throw new Error(`rehearsal shift request failed: ${request.rows[0]?.status}`)
      const confirmed = await client.query(
        `select * from public.confirm_counter_shift($1,$2,$3,3)`,
        [row.operator_id, request.rows[0].request_id, codeHash],
      )
      if (confirmed.rows[0]?.status !== 'ok')
        throw new Error(
          `rehearsal shift confirmation failed: ${JSON.stringify({ request: request.rows[0], confirmed: confirmed.rows[0], detail: (await client.query('select id,device_id,person_id,requested_username,code_hash,expires_at,resolution,attempts,now() now from public.counter_shift_requests where id=$1', [request.rows[0].request_id])).rows[0], eligible: (await client.query('select public.app_may_hold_counter_shift($1,$2) ok', [row.operator_id, row.target_id])).rows[0] })}`,
        )
      const shiftId = confirmed.rows[0].shift_id

      const createdAt = new Date().toISOString()
      const businessDate = (
        await client.query(
          `select public.app_business_date($1::timestamptz,business_day_cutover)::text business_date
             from public.outlets where id=$2`,
          [createdAt, row.target_id],
        )
      ).rows[0].business_date
      const menu = (
        await client.query(
          `select id,name,price_paise from public.menu_items
            where outlet_id=$1 and is_active and is_available
            order by id limit 1`,
          [row.target_id],
        )
      ).rows[0]
      if (!menu) throw new Error('rehearsal target menu is empty')
      const billId = randomUUID()
      const commandId = randomUUID()
      const lineId = randomUUID()
      const payload = {
        billId,
        businessDate,
        paymentBusinessDate: businessDate,
        customerId: null,
        customerName: null,
        customerPhone: null,
        subtotalPaise: Number(menu.price_paise),
        discountPaise: 0,
        taxPaise: 0,
        roundingPaise: 0,
        totalPaise: Number(menu.price_paise),
        pricingMode: 'no_tax',
        discounts: [],
        payments: [{ method: 'cash', amountPaise: Number(menu.price_paise) }],
        lines: [
          {
            id: lineId,
            menuItemId: menu.id,
            itemName: menu.name,
            unitPricePaise: Number(menu.price_paise),
            quantity: 1,
            lineTotalPaise: Number(menu.price_paise),
            discountPaise: 0,
            discountPercentBp: null,
            categoryName: null,
          },
        ],
      }
      const hash = (
        await client.query(`select public.billing_payload_hash($1::jsonb) hash`, [payload])
      ).rows[0].hash
      await client.query(
        `select set_config('request.jwt.claims',jsonb_build_object('sub',$1::text,'role','authenticated')::text,false)`,
        [row.device_id],
      )
      // Invoke the same security-definer RPC with a device JWT claim. The
      // postgres connection is intentional in this database-only rehearsal:
      // it supplies the service boundary while auth.uid() still resolves to
      // the repaired tablet, and no browser or outlet hardware is involved.
      const paid = await client.query(
        `select public.pay_billing_now($1,$2,$3,$4::timestamptz,$5,$6::jsonb) result`,
        [commandId, 2, hash, createdAt, shiftId, payload],
      )
      const result = paid.rows[0]?.result
      if (result?.status !== 'accepted' || Number(result.billNumber) !== expectedNextBill)
        throw new Error(
          `rehearsal first bill was not ${expectedNextBill}: ${JSON.stringify({
            result,
            shiftId,
            hash,
            context: (
              await client.query(
                'select public.billing_device_context($1,$2::timestamptz) context',
                [shiftId, createdAt],
              )
            ).rows[0].context,
            envelope: (
              await client.query(
                "select public.billing_envelope_error($1,2,$2,$3::timestamptz,$4::jsonb,array['billId','businessDate','paymentBusinessDate','customerId','customerName','customerPhone','subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','payments','lines'],array['roundingPaise','discounts']) error",
                [commandId, hash, createdAt, payload],
              )
            ).rows[0].error,
            serverHash: (
              await client.query('select public.billing_payload_hash($1::jsonb) hash', [payload])
            ).rows[0].hash,
            keys: (
              await client.query(
                "select public.billing_payload_has_keys($1::jsonb,array['billId','businessDate','paymentBusinessDate','customerId','customerName','customerPhone','subtotalPaise','discountPaise','taxPaise','totalPaise','pricingMode','payments','lines','roundingPaise','discounts']) ok",
                [payload],
              )
            ).rows[0].ok,
            totals: (
              await client.query('select public.billing_validate_totals($1::jsonb) ok', [payload])
            ).rows[0].ok,
            discounts: (
              await client.query('select public.billing_validate_discounts($1::jsonb) ok', [
                payload,
              ])
            ).rows[0].ok,
            lines: (
              await client.query('select public.billing_validate_lines($1::jsonb,$2)', [
                JSON.stringify(payload.lines),
                row.target_id,
              ])
            ).rows[0].ok,
            payments: (
              await client.query('select public.billing_validate_payments($1::jsonb,$2) ok', [
                JSON.stringify(payload.payments),
                payload.totalPaise,
              ])
            ).rows[0].ok,
          })}`,
        )
      const landed = await client.query(
        `select b.bill_number,b.outlet_id,b.counter_device_id,b.counter_shift_id,
                (select last_number from public.bill_number_counters where outlet_id=$1)::int target_counter,
                (select last_number from public.bill_number_counters where outlet_id=$2)::int source_counter
           from public.bills b where b.id=$3`,
        [row.target_id, row.source_id, billId],
      )
      const bill = landed.rows[0]
      if (
        !bill ||
        Number(bill.bill_number) !== expectedNextBill ||
        bill.outlet_id !== row.target_id ||
        bill.counter_device_id !== row.device_id ||
        bill.counter_shift_id !== shiftId ||
        bill.target_counter !== expectedNextBill ||
        bill.source_counter !== 778
      )
        throw new Error(`rehearsal bill landed incorrectly: ${JSON.stringify(bill)}`)
      return { billNumber: Number(bill.bill_number), sourceCounter: bill.source_counter }
    } finally {
      await client.end()
    }
  }
  const expectPlanRefusal = async (label, sql, contains) => {
    await withClone(label, async (url) => {
      await mutate(url, sql)
      await runOperator(url, ['plan', ...COMMON], { succeeds: false, contains })
    })
  }

  try {
    await withClone('exact apply / verify / rollback', async (url) => {
      await expectOriginalPlan(url)
      await runOperator(url, applyArgs(), { succeeds: true })
      await runOperator(
        url,
        ['verify', ...COMMON, '--before-image', path.resolve(args['before-image'])],
        {
          succeeds: true,
        },
      )
      await runOperator(
        url,
        ['rollback', ...COMMON, '--before-image', path.resolve(args['before-image'])],
        {
          succeeds: true,
        },
      )
    })

    await withClone('cutover before stored expiry', async (url) => {
      await mutate(
        url,
        `update public.counter_shifts
            set expires_at=statement_timestamp()+interval '15 minutes'
          where id=(select counter_shift_id from public.bills b join public.outlets o on o.id=b.outlet_id and o.code='skpa' where b.business_date=date '2026-09-16' and b.bill_number=742)`,
      )
      const destination = await mkdtemp(path.join(tmpdir(), 'shawarmania-repair-before-expiry-'))
      try {
        const planned = await runOperator(
          url,
          ['plan', ...COMMON, '--write-before-image', destination],
          { succeeds: true },
        )
        const output = JSON.parse(planned.stdout)
        await runOperator(url, applyArgsFor(output.digest, output.beforeImage.path), {
          succeeds: true,
        })
        await expectShiftClosure(url, 'before')
      } finally {
        await rm(destination, { recursive: true, force: true })
      }
    })

    await withClone('cutover at or after stored expiry', async (url) => {
      await runOperator(url, applyArgs(), { succeeds: true })
      await expectShiftClosure(url, 'at')
    })

    await withClone('next opening and first bill', async (url) => {
      await runOperator(url, applyArgs(), { succeeds: true })
      const result = await simulateNextOpening(url)
      if (result.billNumber !== 1062 || result.sourceCounter !== 778)
        throw new Error(`next-opening assertions failed: ${JSON.stringify(result)}`)
    })

    await withClone(
      'live later Kalyani shift blocks apply',
      async (url) => {
        await mutate(
          url,
          `alter table public.counter_shifts disable trigger user;
           update public.counter_shifts
              set ended_at=null,ended_reason=null,expires_at=statement_timestamp()+interval '15 minutes'
            where id=(select distinct counter_shift_id from public.bills where outlet_id=(select id from public.outlets where code='skalyani') and business_date=date '2026-09-17' and bill_number between 990 and 1024);
           alter table public.counter_shifts enable trigger user`,
        )
        await runOperator(url, applyArgs(), {
          succeeds: false,
          contains: 'live later Kalyani shifts at apply',
        })
        await expectOriginalPlan(url)
      },
      { closeLaterShift: false },
    )

    await withClone('all mutation-group failures are atomic', async (url) => {
      for (const point of INJECTIONS) {
        await runOperator(url, applyArgs(['--inject-failure', point]), {
          succeeds: false,
          contains: `Injected scratch failure at ${point}`,
        })
        await expectOriginalPlan(url)
      }
    })

    const incidentBill = `(select b.id from public.bills b join public.outlets o on o.id=b.outlet_id and o.code='skpa' where b.business_date=date '2026-09-16' and b.bill_number between 742 and 778 order by b.bill_number limit 1)`
    const incidentDevice = `(select b.counter_device_id from public.bills b where b.id=${incidentBill})`
    const incidentShift = `(select b.counter_shift_id from public.bills b where b.id=${incidentBill})`
    const incidentOperator = `(select b.biller_profile_id from public.bills b where b.id=${incidentBill})`
    const sourceOutlet = `(select id from public.outlets where code='skpa')`
    const targetOutlet = `(select id from public.outlets where code='skalyani')`

    await expectPlanRefusal(
      'bill count drift',
      `alter table public.bills disable trigger bills_append_only; update public.bills set bill_number=900 where id=${incidentBill}`,
      'incident bill count',
    )
    await expectPlanRefusal(
      'money drift',
      `alter table public.bills disable trigger bills_append_only; alter table public.bills disable trigger bills_payment_total_guard; update public.bills set rounding_paise=rounding_paise+100,total_paise=total_paise+100 where id=${incidentBill}`,
      'bill total',
    )
    await expectPlanRefusal(
      'second device',
      `alter table public.bills disable trigger bills_append_only; update public.bills set counter_device_id=(select id from public.counter_devices where id<>${incidentDevice} limit 1) where id=${incidentBill}`,
      'incident device cardinality',
    )
    await expectPlanRefusal(
      'second shift',
      `alter table public.bills disable trigger bills_append_only; update public.bills set counter_shift_id=(select id from public.counter_shifts where id<>${incidentShift} limit 1) where id=${incidentBill}`,
      'incident shift cardinality',
    )
    await expectPlanRefusal(
      'second operator',
      `alter table public.bills disable trigger bills_append_only; update public.bills set biller_profile_id=(select person_id from public.assignments where role='biller' and ended_on is null and person_id<>${incidentOperator} limit 1) where id=${incidentBill}`,
      'incident operator cardinality',
    )
    await expectPlanRefusal(
      'target-day trade',
      `alter table public.bills disable trigger bills_append_only; update public.bills set business_date=date '2026-09-16' where id=(select id from public.bills where outlet_id=${targetOutlet} order by bill_number desc limit 1)`,
      'later Kalyani bill count',
    )
    await expectPlanRefusal(
      'target counter behind an existing bill',
      `update public.bill_number_counters set last_number=988 where outlet_id=${targetOutlet}`,
      'target bill counter',
    )
    await expectPlanRefusal(
      'later Kalyani bill gap',
      `alter table public.bills disable trigger bills_append_only; update public.bills set bill_number=1200 where outlet_id=${targetOutlet} and business_date=date '2026-09-17' and bill_number=990`,
      'later Kalyani bill count',
    )
    await expectPlanRefusal(
      'later Kalyani void appeared',
      `alter table public.bills disable trigger bills_append_only; update public.bills set status='void',voided_at=now(),voided_by=biller_profile_id,void_reason='scratch refusal test' where outlet_id=${targetOutlet} and business_date=date '2026-09-17' and bill_number=990`,
      'Later Kalyani bills are not one contiguous settled, unvoided block',
    )
    await expectPlanRefusal(
      'later Kalyani command number drift',
      `update public.billing_commands set result=jsonb_set(result,'{billNumber}','9999'::jsonb,false) where id=(select c.id from public.billing_commands c join public.bills b on b.id=(c.result->>'billId')::uuid where b.outlet_id=${targetOutlet} and b.business_date=date '2026-09-17' and b.bill_number between 990 and 1024 limit 1)`,
      'A later Kalyani command does not match its bill number',
    )
    await expectPlanRefusal(
      'missing menu mapping',
      `update public.menu_items set is_available=false where id=(select mi.id from public.menu_items mi where mi.outlet_id=${targetOutlet} and exists(select 1 from public.bill_items bi where bi.bill_id in (select id from public.bills where outlet_id=${sourceOutlet} and business_date=date '2026-09-16' and bill_number between 742 and 778) and bi.item_name=mi.name and bi.unit_price_paise=mi.price_paise) limit 1)`,
      'target menu mapping',
    )
    await expectPlanRefusal(
      'price-changed menu mapping',
      `alter table public.menu_items disable trigger menu_items_above_active_discounts; update public.menu_items set price_paise=price_paise+1 where id=(select mi.id from public.menu_items mi where mi.outlet_id=${targetOutlet} and exists(select 1 from public.bill_items bi where bi.bill_id in (select id from public.bills where outlet_id=${sourceOutlet} and business_date=date '2026-09-16' and bill_number between 742 and 778) and bi.item_name=mi.name and bi.unit_price_paise=mi.price_paise) limit 1)`,
      'target menu mapping',
    )
    await expectPlanRefusal(
      'nonzero unresolved work',
      `update public.counter_devices set last_reported_unsent=1,last_reported_oldest_unresolved_at=now() where id=${incidentDevice}`,
      'device unresolved count',
    )
    await expectPlanRefusal(
      'heartbeat before server work',
      `update public.counter_devices set last_seen_at=timestamp with time zone '2000-01-01 00:00:00+00' where id=${incidentDevice}`,
      'Stored zero report is not after latest server work',
    )
    await expectPlanRefusal(
      'later accepted server work',
      `update public.billing_commands set received_at=now() where id=(select id from public.billing_commands where shift_id=${incidentShift} order by watermark desc limit 1)`,
      'Stored zero report is not after latest server work',
    )
    await expectPlanRefusal(
      'assignment drift',
      `update public.assignments set ended_on=current_date where person_id=${incidentOperator} and role='biller' and outlet_id=${targetOutlet} and ended_on is null`,
      'active Biller assignments',
    )
    await expectPlanRefusal(
      'discount appeared',
      `alter table public.bill_discounts disable trigger user; insert into public.bill_discounts(bill_id,outlet_id,basis,value_paise,amount_paise) select id,outlet_id,'amount',1,1 from public.bills where id=${incidentBill}`,
      'bill_discounts count',
    )
    await expectPlanRefusal(
      'payment correction appeared',
      `alter table public.bill_payment_corrections disable trigger bill_payment_corrections_command_insert; insert into public.bill_payment_corrections(command_id,bill_id,outlet_id,device_id,shift_id,actor_id,revision,client_created_at) select c.id,b.id,b.outlet_id,b.counter_device_id,b.counter_shift_id,b.biller_profile_id,1,now() from public.bills b join public.billing_commands c on c.shift_id=b.counter_shift_id where b.id=${incidentBill} order by c.watermark limit 1`,
      'bill_payment_corrections count',
    )

    await withClone('wrong digest and project', async (url) => {
      await runOperator(
        url,
        applyArgs().map((value) => (value === digest ? '0'.repeat(64) : value)),
        {
          succeeds: false,
          contains: 'fresh plan digest',
        },
      )
      await runOperator(
        url,
        ['plan', ...COMMON.map((value) => (value === 'local' ? 'not-local' : value))],
        {
          succeeds: false,
          contains: 'Scratch runs require --project-ref local',
        },
      )
      await expectOriginalPlan(url)
    })

    await withClone('lock contention', async (url) => {
      const lock = new Client({ connectionString: url })
      await lock.connect()
      await lock.query('begin')
      await lock.query(
        `select pg_advisory_xact_lock(hashtextextended('repair-kalyani-counter-attribution',0))`,
      )
      try {
        await runOperator(url, applyArgs(), { succeeds: false, contains: 'lock timeout' })
      } finally {
        await lock.query('rollback')
        await lock.end()
      }
      await expectOriginalPlan(url)
    })

    await withClone('unsafe rollback', async (url) => {
      await runOperator(url, applyArgs(), { succeeds: true })
      await mutate(
        url,
        `update public.counter_devices set label='Changed after repair' where label='Kalyani Counter 2'`,
      )
      await runOperator(
        url,
        ['rollback', ...COMMON, '--before-image', path.resolve(args['before-image'])],
        {
          succeeds: false,
          contains: 'repaired device label',
        },
      )
    })
  } finally {
    await admin.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
