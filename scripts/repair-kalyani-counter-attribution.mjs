#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import pg from 'pg'

const { Client } = pg

const FROZEN = Object.freeze({
  projectRef: 'iefcidjbfnmsiqithqbj',
  businessDate: '2026-09-16',
  sourceCode: 'skpa',
  targetCode: 'skalyani',
  sourceBillMin: 742,
  sourceBillMax: 778,
  sourceCounter: 778,
  targetCounterBeforeIncident: 989,
  targetBillMin: 990,
  targetBillMax: 1026,
  laterBusinessDate: '2026-09-17',
  laterBillMin: 990,
  laterBillMax: 1024,
  targetCounterBeforeRepair: 1024,
  shiftedLaterBillMin: 1027,
  shiftedLaterBillMax: 1061,
  targetCounterAfterRepair: 1061,
  stagingBillBase: 1000000000,
  orderCounter: 39,
  deviceLabel: 'Kalyani Counter 2',
  confirmation: 'MOVE-2026-09-16-SKPA-TO-SKALYANI',
})

const EXPECTED = Object.freeze({
  bills: 37,
  billItems: 43,
  payments: 41,
  orders: 39,
  paidOrders: 37,
  cancelledOrders: 2,
  orderItems: 45,
  commands: 115,
  publicLinks: 37,
  expenses: 5,
  billTotalPaise: 906000,
  cashPaise: 213000,
  upiPaise: 693000,
  expensePaise: 38000,
  earlierSourceBills: 741,
  earlierDeviceShifts: 33,
  laterBills: 35,
  laterBillItems: 40,
  laterPayments: 37,
  laterPublicLinks: 35,
  laterCommandsWithBill: 36,
  laterCorrections: 1,
  laterCorrectionAllocations: 1,
  laterTotalPaise: 753000,
})

const ALIASES = new Map([
  ['Classic Chicken Shawarma  [S]\u000011000', 'Classic Chicken Shawarma  [SAAJ]'],
  ['Chicken Shawarma Salad\u000020000', 'Shawarma Salad'],
])

const MUTATION_TRIGGERS = Object.freeze([
  ['bills', 'bills_append_only'],
  ['bill_items', 'bill_items_immutable'],
  ['bill_payments', 'bill_payments_immutable'],
  ['orders', 'orders_guard'],
  ['order_items', 'order_items_guard'],
  ['expenses', 'expenses_guarded'],
  ['expenses', 'expenses_set_updated_at'],
])

// The closed set reviewed from the production schema. `captureCatalog` records
// every relation guard around it, so a newly added FK/policy/trigger/function
// changes the plan digest instead of becoming an invisible dependency.
const INCIDENT_CATALOG_TABLES = Object.freeze([
  'aggregator_dismissed_duplicates',
  'assignments',
  'bill_discounts',
  'bill_items',
  'bill_number_counters',
  'bill_payment_correction_allocations',
  'bill_payment_corrections',
  'bill_payments',
  'bill_public_link_views',
  'bill_public_links',
  'billing_attribution_reviews',
  'billing_commands',
  'billing_end_of_day_confirmations',
  'bills',
  'counter_device_setup_codes',
  'counter_devices',
  'counter_shift_requests',
  'counter_shifts',
  'drawer_cash_out',
  'drawer_observation_adjustments',
  'drawer_observations',
  'drawer_reconciliation_acknowledgements',
  'expenses',
  'inventory_items',
  'inventory_movements',
  'menu_categories',
  'menu_items',
  'order_discounts',
  'order_items',
  'order_number_counters',
  'orders',
  'outlets',
  'profiles',
  'shifts',
])

const FAILURE_INJECTION_POINTS = Object.freeze([
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
])

function parseArgs(argv) {
  const [mode, ...rest] = argv
  if (!['plan', 'apply', 'verify', 'rollback'].includes(mode)) {
    throw new Error(
      'Usage: repair-kalyani-counter-attribution.mjs <plan|apply|verify|rollback> [options]',
    )
  }
  const values = { mode }
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = rest[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    values[key] = value
    index += 1
  }
  return values
}

function requireFrozenArgs(args) {
  for (const key of ['environment', 'project-ref', 'business-date', 'source', 'target']) {
    if (!args[key]) throw new Error(`--${key} is required`)
  }
  if (args['business-date'] !== FROZEN.businessDate) {
    throw new Error(
      `Refusing business date ${args['business-date']}; only ${FROZEN.businessDate} is reviewed`,
    )
  }
  if (args.source !== FROZEN.sourceCode || args.target !== FROZEN.targetCode) {
    throw new Error(`Refusing unreviewed outlet pair ${args.source} -> ${args.target}`)
  }
  if (!['scratch', 'production'].includes(args.environment)) {
    throw new Error('--environment must be scratch or production')
  }
  if (args.environment === 'production' && args['project-ref'] !== FROZEN.projectRef) {
    throw new Error('The production project reference does not match the reviewed project')
  }
  if (args.environment === 'scratch' && args['project-ref'] !== 'local') {
    throw new Error('Scratch runs require --project-ref local')
  }
  if (args['inject-failure']) {
    if (args.environment !== 'scratch') throw new Error('Failure injection is scratch-only')
    if (!FAILURE_INJECTION_POINTS.includes(args['inject-failure'])) {
      throw new Error(`Unknown failure injection point: ${args['inject-failure']}`)
    }
  }
}

function injectFailure(selected, point) {
  if (selected === point) throw new Error(`Injected scratch failure at ${point}`)
}

function canonical(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function integer(value, name) {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error(`${name} was not an integer`)
  return result
}

function dateText(value, name) {
  if (typeof value === 'string') return value
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${name} is not a PostgreSQL date`)
  }
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function assertEqual(actual, expected, name) {
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function connect(args) {
  const connectionString = process.env.SHAWARMANIA_DATABASE_URL
  if (!connectionString) throw new Error('SHAWARMANIA_DATABASE_URL is required')
  const parsed = new URL(connectionString)
  if (
    args.environment === 'production' &&
    !parsed.hostname.includes(FROZEN.projectRef) &&
    !decodeURIComponent(parsed.username).includes(FROZEN.projectRef)
  ) {
    throw new Error('Database URL does not name the reviewed production project')
  }
  const client = new Client({
    connectionString,
    ssl: args.environment === 'production' ? { rejectUnauthorized: false } : false,
    application_name: `repair-kalyani-counter-attribution/${args.mode}`,
  })
  await client.connect()
  if (args.environment === 'production') await client.query('set role postgres')
  await client.query("set timezone = 'UTC'")
  return client
}

async function one(client, text, values = []) {
  const result = await client.query(text, values)
  if (result.rowCount !== 1) throw new Error(`Expected one row, got ${result.rowCount}`)
  return result.rows[0]
}

async function hashRows(client, table, whereSql, values, excluded = [], orderBy = 'id') {
  const excludedSql = excluded.map((column) => ` - '${column.replaceAll("'", "''")}'`).join('')
  const row = await one(
    client,
    `select encode(extensions.digest(convert_to(coalesce(string_agg((to_jsonb(t)${excludedSql})::text, '' order by t.${orderBy}), ''), 'UTF8'), 'sha256'), 'hex') hash
       from public.${table} t where ${whereSql}`,
    values,
  )
  return row.hash
}

async function hashCommandRows(client, whereSql, values, { excludeOutlet = false } = {}) {
  const outletExclusion = excludeOutlet ? " - 'outlet_id'" : ''
  const row = await one(
    client,
    `select encode(extensions.digest(convert_to(coalesce(string_agg(
       (((to_jsonb(c)${outletExclusion}) - 'result') ||
         jsonb_build_object('result',c.result - 'billNumber'))::text,
       '' order by c.id), ''), 'UTF8'), 'sha256'), 'hex') hash
       from public.billing_commands c where ${whereSql}`,
    values,
  )
  return row.hash
}

async function tableExists(client, name) {
  return (await one(client, `select to_regclass($1) is not null as present`, [`public.${name}`]))
    .present
}

async function captureCatalog(client) {
  const tables = [...INCIDENT_CATALOG_TABLES]
  const relations = (
    await client.query(
      `select c.relname table_name,c.relrowsecurity,c.relforcerowsecurity
         from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind in ('r','p') and c.relname=any($1::text[])
        order by c.relname`,
      [tables],
    )
  ).rows
  assertEqual(relations.length, tables.length, 'incident catalog table count')
  const triggers = (
    await client.query(
      `select c.relname table_name,t.tgname,t.tgenabled,
              pg_get_triggerdef(t.oid,true) definition
         from pg_trigger t join pg_class c on c.oid=t.tgrelid
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and not t.tgisinternal
          and c.relname=any($1::text[])
        order by c.relname,t.tgname`,
      [tables],
    )
  ).rows
  const constraints = (
    await client.query(
      `select c.conname,n.nspname source_schema,src.relname source_table,
              rn.nspname referenced_schema,ref.relname referenced_table,
              c.contype,c.condeferrable,c.condeferred,
              pg_get_constraintdef(c.oid,true) definition
         from pg_constraint c
         join pg_class src on src.oid=c.conrelid
         join pg_namespace n on n.oid=src.relnamespace
         left join pg_class ref on ref.oid=c.confrelid
         left join pg_namespace rn on rn.oid=ref.relnamespace
        where n.nspname='public'
          and (src.relname=any($1::text[])
               or (rn.nspname='public' and ref.relname=any($1::text[])))
        order by src.relname,c.conname`,
      [tables],
    )
  ).rows
  const policies = (
    await client.query(
      `select tablename,policyname,permissive,roles,cmd,qual,with_check
         from pg_policies
        where schemaname='public' and tablename=any($1::text[])
        order by tablename,policyname`,
      [tables],
    )
  ).rows
  const indexes = (
    await client.query(
      `select tablename,indexname,indexdef from pg_indexes
        where schemaname='public' and tablename=any($1::text[])
        order by tablename,indexname`,
      [tables],
    )
  ).rows
  const views = (
    await client.query(
      `select schemaname,viewname,definition from pg_views v
        where schemaname='public'
          and exists(select 1 from unnest($1::text[]) t(name)
                      where position(t.name in lower(v.definition))>0)
        order by viewname`,
      [tables],
    )
  ).rows
  const functions = (
    await client.query(
      `with f as (
         select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
                pg_get_functiondef(p.oid) definition
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.prokind in ('f','p')
       )
       select nspname,proname,arguments,definition from f
        where exists(select 1 from unnest($1::text[]) t(name)
                      where position(t.name in lower(f.definition))>0)
        order by proname,arguments`,
      [tables],
    )
  ).rows
  return { relations, triggers, constraints, policies, indexes, views, functions }
}

async function assertCatalog(client, expected) {
  const actual = await captureCatalog(client)
  assertEqual(canonical(actual), canonical(expected), 'incident dependency catalog')
}

async function loadPlan(client) {
  const outlets = await client.query(
    `select id, code, name, is_active from public.outlets where code = any($1::text[]) order by code`,
    [[FROZEN.sourceCode, FROZEN.targetCode]],
  )
  assertEqual(outlets.rowCount, 2, 'reviewed outlet count')
  const source = outlets.rows.find((row) => row.code === FROZEN.sourceCode)
  const target = outlets.rows.find((row) => row.code === FROZEN.targetCode)
  assert(source && target, 'Reviewed outlets are missing')
  assert(target.is_active, 'Target outlet is inactive')

  const bills = await client.query(
    `select * from public.bills where outlet_id=$1 and business_date=$2::date
      and bill_number between $3 and $4 order by paid_at, created_at, id`,
    [source.id, FROZEN.businessDate, FROZEN.sourceBillMin, FROZEN.sourceBillMax],
  )
  assertEqual(bills.rowCount, EXPECTED.bills, 'incident bill count')
  assert(
    bills.rows.every((bill) => bill.status === 'settled' && bill.voided_at === null),
    'Bills are not all settled and unvoided',
  )
  const deviceIds = new Set(bills.rows.map((bill) => bill.counter_device_id))
  const shiftIds = new Set(bills.rows.map((bill) => bill.counter_shift_id))
  const operatorIds = new Set(bills.rows.map((bill) => bill.biller_profile_id))
  assertEqual(deviceIds.size, 1, 'incident device cardinality')
  assertEqual(shiftIds.size, 1, 'incident shift cardinality')
  assertEqual(operatorIds.size, 1, 'incident operator cardinality')
  const deviceId = [...deviceIds][0]
  const shiftId = [...shiftIds][0]
  const operatorId = [...operatorIds][0]
  assert(shiftId, 'Incident bills have no counter shift')
  const billIds = bills.rows.map((bill) => bill.id)

  const totals = await one(
    client,
    `select count(*)::int bills,sum(total_paise)::bigint bill_total,min(bill_number)::int bill_min,max(bill_number)::int bill_max,count(*) filter(where discount_paise<>0)::int discounted from public.bills where id=any($1::uuid[])`,
    [billIds],
  )
  assertEqual(totals.bills, EXPECTED.bills, 'bill count')
  assertEqual(integer(totals.bill_total, 'bill total'), EXPECTED.billTotalPaise, 'bill total')
  assertEqual(totals.bill_min, FROZEN.sourceBillMin, 'source bill minimum')
  assertEqual(totals.bill_max, FROZEN.sourceBillMax, 'source bill maximum')
  assertEqual(totals.discounted, 0, 'discounted bill count')

  const children = await one(
    client,
    `select
    (select count(*) from public.bill_items where bill_id=any($1::uuid[]))::int bill_items,
    (select count(*) from public.bill_payments where bill_id=any($1::uuid[]))::int payments,
    (select coalesce(sum(amount_paise),0) from public.bill_payments where bill_id=any($1::uuid[]) and method='cash')::bigint cash,
    (select coalesce(sum(amount_paise),0) from public.bill_payments where bill_id=any($1::uuid[]) and method='upi')::bigint upi,
    (select count(*) from public.bill_public_links where bill_id=any($1::uuid[]))::int public_links`,
    [billIds],
  )
  assertEqual(children.bill_items, EXPECTED.billItems, 'bill item count')
  assertEqual(children.payments, EXPECTED.payments, 'payment count')
  assertEqual(integer(children.cash, 'cash'), EXPECTED.cashPaise, 'cash total')
  assertEqual(integer(children.upi, 'UPI'), EXPECTED.upiPaise, 'UPI total')
  assertEqual(children.public_links, EXPECTED.publicLinks, 'public link count')

  const orders = await client.query(
    `select * from public.orders where device_id=$1 and business_date=$2::date order by order_number,id`,
    [deviceId, FROZEN.businessDate],
  )
  assertEqual(orders.rowCount, EXPECTED.orders, 'order count')
  assertEqual(
    orders.rows.filter((order) => order.status === 'paid').length,
    EXPECTED.paidOrders,
    'paid orders',
  )
  assertEqual(
    orders.rows.filter((order) => order.status === 'cancelled').length,
    EXPECTED.cancelledOrders,
    'cancelled orders',
  )
  assert(
    orders.rows.every((order) => order.outlet_id === source.id),
    'An incident order is outside the source outlet',
  )
  assert(
    orders.rows.every((order, index) => Number(order.order_number) === index + 1),
    'Order numbers are not exactly 1-39',
  )
  assert(
    orders.rows.every((order) => Number(order.discount_paise) === 0),
    'An incident order has a discount',
  )
  const orderIds = orders.rows.map((order) => order.id)
  const orderItems = await client.query(
    `select * from public.order_items where order_id=any($1::uuid[]) order by id`,
    [orderIds],
  )
  assertEqual(orderItems.rowCount, EXPECTED.orderItems, 'order item count')
  const commands = await client.query(
    `select * from public.billing_commands where shift_id=$1 order by watermark`,
    [shiftId],
  )
  assertEqual(commands.rowCount, EXPECTED.commands, 'command count')
  assert(
    commands.rows.every(
      (command) => command.outlet_id === source.id && command.result_category === 'accepted',
    ),
    'Command scope/category drifted',
  )
  const expenses = await client.query(
    `select * from public.expenses where outlet_id=$1 and business_date=$2::date and recorded_by=$3 and voided_at is null order by id`,
    [source.id, FROZEN.businessDate, operatorId],
  )
  assertEqual(expenses.rowCount, EXPECTED.expenses, 'expense count')
  assertEqual(
    expenses.rows.reduce((sum, row) => sum + Number(row.amount_paise), 0),
    EXPECTED.expensePaise,
    'expense total',
  )

  // Kalyani legitimately traded after this incident was first reviewed. Those
  // later bills keep every identity and commercial fact, but move upward as a
  // complete contiguous block so the incident keeps its original insertion
  // point immediately after Kalyani bill 989.
  const laterBills = await client.query(
    `select * from public.bills
      where outlet_id=$1 and business_date=$2::date
        and bill_number between $3 and $4
      order by bill_number`,
    [target.id, FROZEN.laterBusinessDate, FROZEN.laterBillMin, FROZEN.laterBillMax],
  )
  assertEqual(laterBills.rowCount, EXPECTED.laterBills, 'later Kalyani bill count')
  assert(
    laterBills.rows.every(
      (bill, index) =>
        bill.status === 'settled' &&
        bill.voided_at === null &&
        Number(bill.bill_number) === FROZEN.laterBillMin + index,
    ),
    'Later Kalyani bills are not one contiguous settled, unvoided block',
  )
  const laterBillIds = laterBills.rows.map((bill) => bill.id)
  const laterStats = await one(
    client,
    `select
       count(*)::int bills,
       sum(total_paise)::bigint total_paise,
       count(distinct counter_shift_id)::int shifts,
       count(distinct counter_device_id)::int devices,
       (select count(*) from public.bill_items where bill_id=any($1::uuid[]))::int bill_items,
       (select count(*) from public.bill_payments where bill_id=any($1::uuid[]))::int payments,
       (select count(*) from public.bill_public_links where bill_id=any($1::uuid[]))::int public_links,
       (select count(*) from public.bill_discounts where bill_id=any($1::uuid[]))::int discounts,
       (select count(*) from public.bill_payment_corrections where bill_id=any($1::uuid[]))::int corrections,
       (select count(*) from public.bill_payment_correction_allocations a
          join public.bill_payment_corrections c on c.id=a.correction_id
         where c.bill_id=any($1::uuid[]))::int correction_allocations,
       (select count(*) from public.billing_attribution_reviews where bill_id=any($1::uuid[]))::int attribution_reviews
      from public.bills where id=any($1::uuid[])`,
    [laterBillIds],
  )
  for (const [name, expected] of [
    ['bills', EXPECTED.laterBills],
    ['bill_items', EXPECTED.laterBillItems],
    ['payments', EXPECTED.laterPayments],
    ['public_links', EXPECTED.laterPublicLinks],
    ['corrections', EXPECTED.laterCorrections],
    ['correction_allocations', EXPECTED.laterCorrectionAllocations],
    ['shifts', 1],
    ['devices', 1],
    ['discounts', 0],
    ['attribution_reviews', 0],
  ])
    assertEqual(laterStats[name], expected, `later Kalyani ${name}`)
  assertEqual(
    integer(laterStats.total_paise, 'later Kalyani total'),
    EXPECTED.laterTotalPaise,
    'later Kalyani total',
  )
  const laterCommands = await client.query(
    `select c.* from public.billing_commands c
      where c.result?'billId'
        and (c.result->>'billId')::uuid=any($1::uuid[])
      order by c.id`,
    [laterBillIds],
  )
  assertEqual(
    laterCommands.rowCount,
    EXPECTED.laterCommandsWithBill,
    'later Kalyani commands with bill',
  )
  assert(
    laterCommands.rows.every((command) => {
      const bill = laterBills.rows.find((candidate) => candidate.id === command.result.billId)
      return (
        bill &&
        command.outlet_id === target.id &&
        Number(command.result.billNumber) === Number(bill.bill_number)
      )
    }),
    'A later Kalyani command does not match its bill number',
  )
  const laterDeviceId = laterBills.rows[0].counter_device_id
  const laterShiftId = laterBills.rows[0].counter_shift_id
  const laterDevice = await one(client, `select * from public.counter_devices where id=$1`, [
    laterDeviceId,
  ])
  const laterShift = await one(client, `select * from public.counter_shifts where id=$1`, [
    laterShiftId,
  ])
  const laterServerWork = await one(
    client,
    `select greatest(
       (select max(received_at) from public.billing_commands where device_id=$1),
       (select max(synced_at) from public.bills where counter_device_id=$1)
     ) latest_server_work`,
    [laterDeviceId],
  )
  assertEqual(laterDevice.outlet_id, target.id, 'later Kalyani device outlet')
  assertEqual(laterShift.outlet_id, target.id, 'later Kalyani shift outlet')
  assertEqual(laterShift.device_id, laterDeviceId, 'later Kalyani shift device')
  assertEqual(
    dateText(laterShift.business_date, 'later Kalyani shift date'),
    FROZEN.laterBusinessDate,
    'later Kalyani shift date',
  )
  assertEqual(laterDevice.last_reported_unsent, 0, 'later Kalyani unresolved count')
  assert(
    laterDevice.last_reported_oldest_unresolved_at === null,
    'Later Kalyani device reports an unresolved oldest timestamp',
  )
  assert(
    laterDevice.last_seen_at &&
      new Date(laterDevice.last_seen_at) > new Date(laterServerWork.latest_server_work),
    'Later Kalyani stored zero report is not after latest server work',
  )
  const laterRequests = await one(
    client,
    `select count(*) filter(where resolution is null)::int pending
       from public.counter_shift_requests where device_id=$1`,
    [laterDeviceId],
  )
  assertEqual(laterRequests.pending, 0, 'later Kalyani pending shift requests')

  const state = await one(
    client,
    `select
    (select last_number from public.bill_number_counters where outlet_id=$1)::int source_counter,
    (select last_number from public.bill_number_counters where outlet_id=$2)::int target_counter,
    (select coalesce(max(bill_number),0) from public.bills where outlet_id=$2)::int target_existing_max,
    (select last_number from public.order_number_counters where outlet_id=$1 and business_date=$3::date)::int source_order_counter,
    (select last_number from public.order_number_counters where outlet_id=$2 and business_date=$3::date)::int target_order_counter,
    (select count(*) from public.bills where outlet_id=$1 and bill_number<$4)::int earlier_source_bills,
    (select count(*) from public.bills where outlet_id=$2 and business_date=$3::date)::int target_bills,
    (select count(*) from public.orders where outlet_id=$2 and business_date=$3::date)::int target_orders,
    (select count(*) from public.counter_shifts where device_id=$5 and id<>$6)::int earlier_device_shifts,
    (select count(*) from public.bills where outlet_id=any($7::uuid[]) and bill_number>=$8)::int staging_bills`,
    [
      source.id,
      target.id,
      FROZEN.businessDate,
      FROZEN.sourceBillMin,
      deviceId,
      shiftId,
      [source.id, target.id],
      FROZEN.stagingBillBase,
    ],
  )
  assertEqual(state.source_counter, FROZEN.sourceCounter, 'source bill counter')
  const targetCounter = integer(state.target_counter, 'target bill counter')
  assertEqual(targetCounter, FROZEN.targetCounterBeforeRepair, 'target bill counter')
  assertEqual(
    integer(state.target_existing_max, 'target existing bill maximum'),
    FROZEN.laterBillMax,
    'target existing bill maximum',
  )
  assertEqual(state.source_order_counter, FROZEN.orderCounter, 'source order counter')
  assert(
    state.target_order_counter === null || state.target_order_counter === 0,
    'target order counter is not empty',
  )
  assertEqual(state.earlier_source_bills, EXPECTED.earlierSourceBills, 'earlier source bills')
  assertEqual(state.target_bills, 0, 'target incident-date bills')
  assertEqual(state.target_orders, 0, 'target incident-date orders')
  assertEqual(state.earlier_device_shifts, EXPECTED.earlierDeviceShifts, 'earlier device shifts')
  assertEqual(state.staging_bills, 0, 'reserved staging-range bills')

  const device = await one(client, `select * from public.counter_devices where id=$1`, [deviceId])
  assertEqual(device.outlet_id, source.id, 'device current outlet')
  assert(
    device.session_proven_at !== null && device.removed_at === null,
    'Device is not proven and active',
  )
  assertEqual(device.last_reported_unsent, 0, 'device unresolved count')
  assert(
    device.last_reported_oldest_unresolved_at === null,
    'Device reports an unresolved oldest timestamp',
  )
  const shift = await one(client, `select * from public.counter_shifts where id=$1`, [shiftId])
  assertEqual(shift.outlet_id, source.id, 'shift outlet')
  assert(shift.ended_at === null, 'Incident shift is already ended')
  const timing = await one(
    client,
    `select greatest((select max(received_at) from public.billing_commands where shift_id=$1),(select max(synced_at) from public.bills where id=any($2::uuid[]))) latest_server_work`,
    [shiftId, billIds],
  )
  assert(
    device.last_seen_at && new Date(device.last_seen_at) > new Date(timing.latest_server_work),
    'Stored zero report is not after latest server work',
  )
  const assignment = await one(
    client,
    `select count(*)::int matches from public.assignments where person_id=$1 and role='biller' and ended_on is null and outlet_id=any($2::uuid[])`,
    [operatorId, [source.id, target.id]],
  )
  assertEqual(assignment.matches, 2, 'active Biller assignments')
  const requests = await one(
    client,
    `select count(*) filter(where resolution is null)::int pending,count(*) filter(where shift_id=$2)::int incident from public.counter_shift_requests where device_id=$1`,
    [deviceId, shiftId],
  )
  assertEqual(requests.pending, 0, 'pending shift requests')
  assertEqual(requests.incident, 1, 'incident shift request count')

  const legacy = await one(
    client,
    `select
       (select count(*) from public.bills where id=any($1::uuid[]) and shift_id is not null)::int bill_shift_refs,
       (select count(*) from public.shifts where counter_device_id=$2 and business_date=$3::date)::int shifts,
       (select count(*) from public.counter_device_setup_codes where consumed_device_id=$2)::int setup_codes`,
    [billIds, deviceId, FROZEN.businessDate],
  )
  assertEqual(legacy.bill_shift_refs, 0, 'legacy bill shift references')
  assertEqual(legacy.shifts, 0, 'legacy shifts on the incident date')
  assertEqual(legacy.setup_codes, 1, 'consumed setup-code rows for the device')

  const exclusions = {}
  for (const table of [
    'bill_discounts',
    'order_discounts',
    'bill_payment_corrections',
    'billing_attribution_reviews',
  ]) {
    if (!(await tableExists(client, table))) continue
    const key = table === 'order_discounts' ? 'order_id' : 'bill_id'
    const ids = table === 'order_discounts' ? orderIds : billIds
    const count = (
      await one(
        client,
        `select count(*)::int count from public.${table} where ${key}=any($1::uuid[])`,
        [ids],
      )
    ).count
    exclusions[table] = count
    assertEqual(count, 0, `${table} count`)
  }
  const correctionAllocations = (
    await one(
      client,
      `select count(*)::int count
         from public.bill_payment_correction_allocations a
         join public.bill_payment_corrections c on c.id=a.correction_id
        where c.bill_id=any($1::uuid[])`,
      [billIds],
    )
  ).count
  exclusions.bill_payment_correction_allocations = correctionAllocations
  assertEqual(correctionAllocations, 0, 'bill payment correction allocation count')
  const eod = (
    await one(
      client,
      `select count(*)::int count from public.billing_end_of_day_confirmations where shift_id=$1`,
      [shiftId],
    )
  ).count
  exclusions.billing_end_of_day_confirmations = eod
  assertEqual(eod, 0, 'end-of-day confirmations')

  const sideEffects = await one(
    client,
    `select
       (select count(*) from public.aggregator_dismissed_duplicates d
         where d.expense_a=any($1::uuid[]) or d.expense_b=any($1::uuid[]))::int aggregator_expense_links,
       (select count(*) from public.drawer_cash_out x join public.outlets o on o.id=x.outlet_id
         where x.outlet_id=any($2::uuid[]) and public.app_business_date(x.occurred_at,o.business_day_cutover)=$3::date)::int drawer_cash_out,
       (select count(*) from public.drawer_observations x join public.outlets o on o.id=x.outlet_id
         where x.outlet_id=any($2::uuid[]) and public.app_business_date(x.counted_at,o.business_day_cutover)=$3::date)::int drawer_observations,
       (select count(*) from public.drawer_observation_adjustments x join public.outlets o on o.id=x.outlet_id
         where x.outlet_id=any($2::uuid[]) and public.app_business_date(x.adjusted_at,o.business_day_cutover)=$3::date)::int drawer_adjustments,
       (select count(*) from public.drawer_reconciliation_acknowledgements x join public.outlets o on o.id=x.outlet_id
         where x.outlet_id=any($2::uuid[]) and public.app_business_date(x.acknowledged_at,o.business_day_cutover)=$3::date)::int drawer_acknowledgements,
       (select count(*) from public.inventory_movements x
         where x.outlet_id=any($2::uuid[]) and x.business_date=$3::date)::int inventory_movements`,
    [expenses.rows.map((row) => row.id), [source.id, target.id], FROZEN.businessDate],
  )
  for (const [name, count] of Object.entries(sideEffects)) {
    exclusions[name] = count
    assertEqual(count, 0, `${name} count`)
  }
  exclusions.legacy_bill_shift_refs = legacy.bill_shift_refs
  exclusions.legacy_shifts = legacy.shifts

  const sold = await client.query(
    `select distinct item_name,unit_price_paise::bigint price from (select item_name,unit_price_paise from public.bill_items where bill_id=any($1::uuid[]) union select item_name,unit_price_paise from public.order_items where order_id=any($2::uuid[])) sold order by item_name,unit_price_paise`,
    [billIds, orderIds],
  )
  assertEqual(sold.rowCount, 14, 'distinct incident menu products')
  const menu = []
  for (const item of sold.rows) {
    const price = integer(item.price, 'menu price')
    const targetName = ALIASES.get(`${item.item_name}\u0000${price}`) ?? item.item_name
    const candidates = await client.query(
      `select id,name,price_paise from public.menu_items where outlet_id=$1 and name=$2 and price_paise=$3 and is_active and is_available`,
      [target.id, targetName, price],
    )
    assertEqual(candidates.rowCount, 1, `target menu mapping for ${item.item_name}`)
    menu.push({ sourceName: item.item_name, price, targetName, targetId: candidates.rows[0].id })
  }
  assertEqual(
    menu.filter((entry) => entry.sourceName !== entry.targetName).length,
    2,
    'approved aliases',
  )
  const numberMapping = bills.rows.map((bill, index) => ({
    id: bill.id,
    number: FROZEN.targetBillMin + index,
  }))
  assertEqual(numberMapping.at(-1).number, FROZEN.targetBillMax, 'target bill maximum')
  const laterNumberMapping = laterBills.rows.map((bill) => ({
    id: bill.id,
    number: Number(bill.bill_number) + EXPECTED.bills,
  }))
  assertEqual(
    laterNumberMapping[0].number,
    FROZEN.shiftedLaterBillMin,
    'shifted later bill minimum',
  )
  assertEqual(
    laterNumberMapping.at(-1).number,
    FROZEN.shiftedLaterBillMax,
    'shifted later bill maximum',
  )
  const hashes = {
    bills: await hashRows(
      client,
      'bills',
      'id=any($1::uuid[])',
      [billIds],
      ['outlet_id', 'bill_number'],
    ),
    billItems: await hashRows(
      client,
      'bill_items',
      'bill_id=any($1::uuid[])',
      [billIds],
      ['menu_item_id', 'item_name'],
    ),
    payments: await hashRows(
      client,
      'bill_payments',
      'bill_id=any($1::uuid[])',
      [billIds],
      ['outlet_id'],
    ),
    orders: await hashRows(client, 'orders', 'id=any($1::uuid[])', [orderIds], ['outlet_id']),
    orderItems: await hashRows(
      client,
      'order_items',
      'order_id=any($1::uuid[])',
      [orderIds],
      ['menu_item_id', 'item_name'],
    ),
    commands: await hashCommandRows(client, 'shift_id=$1', [shiftId], {
      excludeOutlet: true,
    }),
    expenses: await hashRows(
      client,
      'expenses',
      'id=any($1::uuid[])',
      [expenses.rows.map((row) => row.id)],
      ['outlet_id'],
    ),
    publicLinks: await hashRows(
      client,
      'bill_public_links',
      'bill_id=any($1::uuid[])',
      [billIds],
      [],
      'bill_id',
    ),
    laterBills: await hashRows(
      client,
      'bills',
      'id=any($1::uuid[])',
      [laterBillIds],
      ['bill_number'],
    ),
    laterBillItems: await hashRows(client, 'bill_items', 'bill_id=any($1::uuid[])', [laterBillIds]),
    laterPayments: await hashRows(client, 'bill_payments', 'bill_id=any($1::uuid[])', [
      laterBillIds,
    ]),
    laterPublicLinks: await hashRows(
      client,
      'bill_public_links',
      'bill_id=any($1::uuid[])',
      [laterBillIds],
      [],
      'bill_id',
    ),
    laterCommands: await hashCommandRows(client, 'id=any($1::uuid[])', [
      laterCommands.rows.map((command) => command.id),
    ]),
    laterCorrections: await hashRows(
      client,
      'bill_payment_corrections',
      'bill_id=any($1::uuid[])',
      [laterBillIds],
    ),
    laterCorrectionAllocations: await hashRows(
      client,
      'bill_payment_correction_allocations',
      'correction_id in (select id from public.bill_payment_corrections where bill_id=any($1::uuid[]))',
      [laterBillIds],
      [],
      'correction_id',
    ),
    billMapping: sha256(canonical(numberMapping)),
    laterBillMapping: sha256(canonical(laterNumberMapping)),
    menuMapping: sha256(
      canonical(
        menu.map(({ sourceName, price, targetName }) => ({ sourceName, price, targetName })),
      ),
    ),
    deviceImmutable: sha256(
      canonical({
        id: device.id,
        setUpAt: device.set_up_at,
        setUpBy: device.set_up_by,
        sessionProvenAt: device.session_proven_at,
        proofExpiresAt: device.proof_expires_at,
        removedAt: device.removed_at,
      }),
    ),
  }
  const catalog = await captureCatalog(client)
  hashes.catalog = sha256(canonical(catalog))
  const safe = {
    change: 'repair-kalyani-counter-attribution',
    projectRef: FROZEN.projectRef,
    businessDate: FROZEN.businessDate,
    source: FROZEN.sourceCode,
    target: FROZEN.targetCode,
    counts: { ...EXPECTED },
    sourceBillRange: [FROZEN.sourceBillMin, FROZEN.sourceBillMax],
    targetBillRange: [FROZEN.targetBillMin, FROZEN.targetBillMax],
    shiftedLaterBillRange: [FROZEN.shiftedLaterBillMin, FROZEN.shiftedLaterBillMax],
    laterBusinessDate: FROZEN.laterBusinessDate,
    laterCounts: {
      bills: EXPECTED.laterBills,
      billItems: EXPECTED.laterBillItems,
      payments: EXPECTED.laterPayments,
      publicLinks: EXPECTED.laterPublicLinks,
      commandsWithBill: EXPECTED.laterCommandsWithBill,
      corrections: EXPECTED.laterCorrections,
      correctionAllocations: EXPECTED.laterCorrectionAllocations,
      totalPaise: EXPECTED.laterTotalPaise,
    },
    counters: {
      source: FROZEN.sourceCounter,
      target: targetCounter,
      targetBeforeIncident: FROZEN.targetCounterBeforeIncident,
      targetAfter: FROZEN.targetCounterAfterRepair,
    },
    menuProducts: menu.length,
    approvedAliases: menu
      .filter((entry) => entry.sourceName !== entry.targetName)
      .map(({ sourceName, targetName, price }) => ({ sourceName, targetName, price })),
    hashes,
    exclusions,
    storedZeroAfterServerWork: true,
    deviceState: { proven: true, removed: false, unresolved: 0 },
    shiftState: {
      ended: false,
      expiresAt: shift.expires_at,
      closeRule: 'earlier of stored expiry and apply transaction time',
    },
    activeBillerAssignments: 2,
    setupCodeRows: legacy.setup_codes,
    catalog: Object.fromEntries(Object.entries(catalog).map(([name, rows]) => [name, rows.length])),
  }
  return {
    safe,
    digest: sha256(canonical(safe)),
    internal: {
      source,
      target,
      bills: bills.rows,
      billIds,
      orders: orders.rows,
      orderIds,
      commands: commands.rows,
      laterBills: laterBills.rows,
      laterBillIds,
      laterCommands: laterCommands.rows,
      laterDevice,
      laterDeviceId,
      laterShiftId,
      laterShift,
      expenses: expenses.rows,
      device,
      deviceId,
      shift,
      shiftId,
      operatorId,
      menu,
      numberMapping,
      laterNumberMapping,
      catalog,
    },
  }
}

async function captureBeforeImage(client, plan, destination) {
  const workspace = path.resolve(process.cwd())
  const resolved = path.resolve(destination)
  if (resolved === workspace || resolved.startsWith(`${workspace}${path.sep}`))
    throw new Error('Before-image destination must be outside the repository')
  await mkdir(resolved, { recursive: true, mode: 0o700 })
  await chmod(resolved, 0o700).catch(() => undefined)
  const i = plan.internal
  const allBillIds = [...i.billIds, ...i.laterBillIds]
  const allCommandIds = [...i.commands, ...i.laterCommands].map((command) => command.id)
  const rows = {}
  const queries = {
    bills: [`select * from public.bills where id=any($1::uuid[]) order by id`, [allBillIds]],
    bill_items: [
      `select * from public.bill_items where bill_id=any($1::uuid[]) order by id`,
      [allBillIds],
    ],
    bill_payments: [
      `select * from public.bill_payments where bill_id=any($1::uuid[]) order by id`,
      [allBillIds],
    ],
    bill_public_links: [
      `select * from public.bill_public_links where bill_id=any($1::uuid[]) order by bill_id`,
      [allBillIds],
    ],
    bill_public_link_views: [
      `select * from public.bill_public_link_views where token=any($1::text[]) order by id`,
      [
        (
          await client.query(
            `select token from public.bill_public_links where bill_id=any($1::uuid[])`,
            [allBillIds],
          )
        ).rows.map((row) => row.token),
      ],
    ],
    bill_discounts: [
      `select * from public.bill_discounts where bill_id=any($1::uuid[]) order by id`,
      [allBillIds],
    ],
    bill_payment_corrections: [
      `select * from public.bill_payment_corrections where bill_id=any($1::uuid[]) order by id`,
      [allBillIds],
    ],
    bill_payment_correction_allocations: [
      `select a.* from public.bill_payment_correction_allocations a join public.bill_payment_corrections c on c.id=a.correction_id where c.bill_id=any($1::uuid[]) order by a.correction_id,a.method`,
      [allBillIds],
    ],
    billing_attribution_reviews: [
      `select * from public.billing_attribution_reviews where bill_id=any($1::uuid[]) order by id`,
      [allBillIds],
    ],
    orders: [`select * from public.orders where id=any($1::uuid[]) order by id`, [i.orderIds]],
    order_items: [
      `select * from public.order_items where order_id=any($1::uuid[]) order by id`,
      [i.orderIds],
    ],
    order_discounts: [
      `select * from public.order_discounts where order_id=any($1::uuid[]) order by id`,
      [i.orderIds],
    ],
    billing_commands: [
      `select * from public.billing_commands where id=any($1::uuid[]) order by id`,
      [allCommandIds],
    ],
    expenses: [
      `select * from public.expenses where id=any($1::uuid[]) order by id`,
      [i.expenses.map((row) => row.id)],
    ],
    counter_shifts: [`select * from public.counter_shifts where id=$1`, [i.shiftId]],
    counter_shift_requests: [
      `select * from public.counter_shift_requests where shift_id=$1 order by id`,
      [i.shiftId],
    ],
    billing_end_of_day_confirmations: [
      `select * from public.billing_end_of_day_confirmations where shift_id=$1 order by outlet_id,business_date,device_id`,
      [i.shiftId],
    ],
    counter_devices: [`select * from public.counter_devices where id=$1`, [i.deviceId]],
    counter_device_setup_codes: [
      `select * from public.counter_device_setup_codes where consumed_device_id=$1 order by id`,
      [i.deviceId],
    ],
    shifts: [
      `select * from public.shifts where counter_device_id=$1 and business_date=$2::date order by id`,
      [i.deviceId, FROZEN.businessDate],
    ],
    bill_number_counters: [
      `select * from public.bill_number_counters where outlet_id=any($1::uuid[]) order by outlet_id`,
      [[i.source.id, i.target.id]],
    ],
    order_number_counters: [
      `select * from public.order_number_counters where outlet_id=any($1::uuid[]) and business_date=$2::date order by outlet_id`,
      [[i.source.id, i.target.id], FROZEN.businessDate],
    ],
    assignments: [
      `select * from public.assignments where person_id=$1 and outlet_id=any($2::uuid[]) order by id`,
      [i.operatorId, [i.source.id, i.target.id]],
    ],
    menu_items: [
      `select * from public.menu_items where id=any($1::uuid[]) order by id`,
      [i.menu.map((entry) => entry.targetId)],
    ],
    aggregator_dismissed_duplicates: [
      `select * from public.aggregator_dismissed_duplicates where expense_a=any($1::uuid[]) or expense_b=any($1::uuid[]) order by id`,
      [i.expenses.map((row) => row.id)],
    ],
    drawer_cash_out: [
      `select x.* from public.drawer_cash_out x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($1::uuid[]) and public.app_business_date(x.occurred_at,o.business_day_cutover)=$2::date order by x.id`,
      [[i.source.id, i.target.id], FROZEN.businessDate],
    ],
    drawer_observations: [
      `select x.* from public.drawer_observations x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($1::uuid[]) and public.app_business_date(x.counted_at,o.business_day_cutover)=$2::date order by x.id`,
      [[i.source.id, i.target.id], FROZEN.businessDate],
    ],
    drawer_observation_adjustments: [
      `select x.* from public.drawer_observation_adjustments x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($1::uuid[]) and public.app_business_date(x.adjusted_at,o.business_day_cutover)=$2::date order by x.id`,
      [[i.source.id, i.target.id], FROZEN.businessDate],
    ],
    drawer_reconciliation_acknowledgements: [
      `select x.* from public.drawer_reconciliation_acknowledgements x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($1::uuid[]) and public.app_business_date(x.acknowledged_at,o.business_day_cutover)=$2::date order by x.id`,
      [[i.source.id, i.target.id], FROZEN.businessDate],
    ],
    inventory_movements: [
      `select * from public.inventory_movements where outlet_id=any($1::uuid[]) and business_date=$2::date order by id`,
      [[i.source.id, i.target.id], FROZEN.businessDate],
    ],
  }
  for (const [name, [text, values]] of Object.entries(queries))
    rows[name] = (await client.query(text, values)).rows
  const bundle = {
    version: 3,
    createdAt: new Date().toISOString(),
    planDigest: plan.digest,
    plan: plan.safe,
    rows,
    catalog: i.catalog,
  }
  const serialized = `${JSON.stringify(bundle)}\n`
  const checksum = sha256(serialized)
  const bundlePath = path.join(resolved, 'before-image.json')
  await writeFile(bundlePath, serialized, { encoding: 'utf8', mode: 0o600 })
  await writeFile(`${bundlePath}.sha256`, `${checksum}  before-image.json\n`, {
    encoding: 'ascii',
    mode: 0o600,
  })
  await writeFile(path.join(resolved, 'reversal.sql'), reversalSql(bundle, checksum), {
    encoding: 'utf8',
    mode: 0o600,
  })
  return { path: bundlePath, checksum }
}

function sqlJson(value) {
  return `$repair_json$${JSON.stringify(value)}$repair_json$::jsonb`
}
function disableGuardsSql() {
  return `${MUTATION_TRIGGERS.map(([t, g]) => `ALTER TABLE public.${t} DISABLE TRIGGER ${g};`).join('\n')}\nALTER TABLE public.bill_payments ALTER CONSTRAINT bill_payments_bill_outlet_fk DEFERRABLE INITIALLY DEFERRED;\nSET CONSTRAINTS ALL DEFERRED;`
}
function enableGuardsSql() {
  return `SET CONSTRAINTS ALL IMMEDIATE;\nALTER TABLE public.bill_payments ALTER CONSTRAINT bill_payments_bill_outlet_fk NOT DEFERRABLE;\n${MUTATION_TRIGGERS.map(([t, g]) => `ALTER TABLE public.${t} ENABLE TRIGGER ${g};`).join('\n')}`
}
function restoreRowsSql(r) {
  const stagedBills = r.bills.map((row, index) => ({
    id: row.id,
    number: FROZEN.stagingBillBase + index,
  }))
  return `
WITH r AS (SELECT * FROM jsonb_populate_recordset(NULL::public.bill_items, ${sqlJson(r.bill_items)})) UPDATE public.bill_items t SET menu_item_id=r.menu_item_id,item_name=r.item_name FROM r WHERE t.id=r.id;
WITH r AS (SELECT * FROM jsonb_populate_recordset(NULL::public.order_items, ${sqlJson(r.order_items)})) UPDATE public.order_items t SET menu_item_id=r.menu_item_id,item_name=r.item_name FROM r WHERE t.id=r.id;
WITH r AS (SELECT * FROM jsonb_populate_recordset(NULL::public.bill_payments, ${sqlJson(r.bill_payments)})) UPDATE public.bill_payments t SET outlet_id=r.outlet_id FROM r WHERE t.id=r.id;
WITH r AS (SELECT * FROM jsonb_to_recordset(${sqlJson(stagedBills)}) AS x(id uuid,number int)) UPDATE public.bills t SET bill_number=r.number FROM r WHERE t.id=r.id;
WITH r AS (SELECT * FROM jsonb_populate_recordset(NULL::public.bills, ${sqlJson(r.bills)})) UPDATE public.bills t SET outlet_id=r.outlet_id,bill_number=r.bill_number FROM r WHERE t.id=r.id;
WITH r AS (SELECT * FROM jsonb_populate_recordset(NULL::public.orders, ${sqlJson(r.orders)})) UPDATE public.orders t SET outlet_id=r.outlet_id FROM r WHERE t.id=r.id;
WITH r AS (SELECT * FROM jsonb_populate_recordset(NULL::public.billing_commands, ${sqlJson(r.billing_commands)})) UPDATE public.billing_commands t SET outlet_id=r.outlet_id,result=r.result FROM r WHERE t.id=r.id;
WITH r AS (SELECT * FROM jsonb_populate_recordset(NULL::public.expenses, ${sqlJson(r.expenses)})) UPDATE public.expenses t SET outlet_id=r.outlet_id,updated_at=r.updated_at FROM r WHERE t.id=r.id;
WITH r AS (SELECT * FROM jsonb_populate_recordset(NULL::public.counter_shift_requests, ${sqlJson(r.counter_shift_requests)})) UPDATE public.counter_shift_requests t SET outlet_id=r.outlet_id FROM r WHERE t.id=r.id;
WITH r AS (SELECT * FROM jsonb_populate_recordset(NULL::public.counter_shifts, ${sqlJson(r.counter_shifts)})) UPDATE public.counter_shifts t SET outlet_id=r.outlet_id,ended_at=r.ended_at,ended_reason=r.ended_reason FROM r WHERE t.id=r.id;
WITH r AS (SELECT * FROM jsonb_populate_recordset(NULL::public.counter_devices, ${sqlJson(r.counter_devices)})) UPDATE public.counter_devices t SET outlet_id=r.outlet_id,label=r.label FROM r WHERE t.id=r.id;`
}
function reversalSql(bundle, checksum) {
  return `-- Generated targeted reversal for repair-kalyani-counter-attribution\n-- Bundle SHA-256: ${checksum}\n-- Prefer rollback mode: it performs drift/refusal checks first.\nBEGIN;\nSET LOCAL lock_timeout='5s';\nSELECT pg_advisory_xact_lock(hashtextextended('repair-kalyani-counter-attribution',0));\n${disableGuardsSql()}\n${restoreRowsSql(bundle.rows)}\n${enableGuardsSql()}\nCOMMIT;\n`
}
async function disableGuards(client) {
  for (const [t, g] of MUTATION_TRIGGERS)
    await client.query(`alter table public.${t} disable trigger ${g}`)
  await client.query(
    `alter table public.bill_payments alter constraint bill_payments_bill_outlet_fk deferrable initially deferred`,
  )
  await client.query(`set constraints all deferred`)
}
async function enableGuards(client) {
  await client.query(`set constraints all immediate`)
  await client.query(
    `alter table public.bill_payments alter constraint bill_payments_bill_outlet_fk not deferrable`,
  )
  for (const [t, g] of MUTATION_TRIGGERS)
    await client.query(`alter table public.${t} enable trigger ${g}`)
}
async function assertGuards(client, catalog) {
  await assertCatalog(client, catalog)
}

function normalizeDatabaseRows(rows) {
  return JSON.parse(JSON.stringify(rows))
}

async function verifyRolledBack(client, bundle) {
  const r = bundle.rows
  const sourceId = r.counter_devices[0].outlet_id
  const targetId = r.bill_number_counters.find((row) => row.outlet_id !== sourceId).outlet_id
  const queries = {
    bills: [
      `select * from public.bills where id=any($1::uuid[]) order by id`,
      [r.bills.map((x) => x.id)],
    ],
    bill_items: [
      `select * from public.bill_items where id=any($1::uuid[]) order by id`,
      [r.bill_items.map((x) => x.id)],
    ],
    bill_payments: [
      `select * from public.bill_payments where id=any($1::uuid[]) order by id`,
      [r.bill_payments.map((x) => x.id)],
    ],
    bill_public_links: [
      `select * from public.bill_public_links where bill_id=any($1::uuid[]) order by bill_id`,
      [r.bill_public_links.map((x) => x.bill_id)],
    ],
    bill_public_link_views: [
      `select * from public.bill_public_link_views where token=any($1::text[]) order by id`,
      [r.bill_public_links.map((x) => x.token)],
    ],
    bill_discounts: [
      `select * from public.bill_discounts where bill_id=any($1::uuid[]) order by id`,
      [r.bills.map((x) => x.id)],
    ],
    bill_payment_corrections: [
      `select * from public.bill_payment_corrections where bill_id=any($1::uuid[]) order by id`,
      [r.bills.map((x) => x.id)],
    ],
    bill_payment_correction_allocations: [
      `select a.* from public.bill_payment_correction_allocations a join public.bill_payment_corrections c on c.id=a.correction_id where c.bill_id=any($1::uuid[]) order by a.correction_id,a.method`,
      [r.bills.map((x) => x.id)],
    ],
    billing_attribution_reviews: [
      `select * from public.billing_attribution_reviews where bill_id=any($1::uuid[]) order by id`,
      [r.bills.map((x) => x.id)],
    ],
    orders: [
      `select * from public.orders where id=any($1::uuid[]) order by id`,
      [r.orders.map((x) => x.id)],
    ],
    order_items: [
      `select * from public.order_items where id=any($1::uuid[]) order by id`,
      [r.order_items.map((x) => x.id)],
    ],
    order_discounts: [
      `select * from public.order_discounts where order_id=any($1::uuid[]) order by id`,
      [r.orders.map((x) => x.id)],
    ],
    billing_commands: [
      `select * from public.billing_commands where id=any($1::uuid[]) order by id`,
      [r.billing_commands.map((x) => x.id)],
    ],
    expenses: [
      `select * from public.expenses where id=any($1::uuid[]) order by id`,
      [r.expenses.map((x) => x.id)],
    ],
    counter_shifts: [
      `select * from public.counter_shifts where id=any($1::uuid[]) order by id`,
      [r.counter_shifts.map((x) => x.id)],
    ],
    counter_shift_requests: [
      `select * from public.counter_shift_requests where id=any($1::uuid[]) order by id`,
      [r.counter_shift_requests.map((x) => x.id)],
    ],
    billing_end_of_day_confirmations: [
      `select * from public.billing_end_of_day_confirmations where shift_id=any($1::uuid[]) order by outlet_id,business_date,device_id`,
      [r.counter_shifts.map((x) => x.id)],
    ],
    counter_devices: [
      `select * from public.counter_devices where id=any($1::uuid[]) order by id`,
      [r.counter_devices.map((x) => x.id)],
    ],
    counter_device_setup_codes: [
      `select * from public.counter_device_setup_codes where consumed_device_id=any($1::uuid[]) order by id`,
      [r.counter_devices.map((x) => x.id)],
    ],
    shifts: [
      `select * from public.shifts where counter_device_id=any($1::uuid[]) and business_date=$2::date order by id`,
      [r.counter_devices.map((x) => x.id), FROZEN.businessDate],
    ],
    assignments: [
      `select * from public.assignments where id=any($1::uuid[]) order by id`,
      [r.assignments.map((x) => x.id)],
    ],
    menu_items: [
      `select * from public.menu_items where id=any($1::uuid[]) order by id`,
      [r.menu_items.map((x) => x.id)],
    ],
    aggregator_dismissed_duplicates: [
      `select * from public.aggregator_dismissed_duplicates where expense_a=any($1::uuid[]) or expense_b=any($1::uuid[]) order by id`,
      [r.expenses.map((x) => x.id)],
    ],
    drawer_cash_out: [
      `select x.* from public.drawer_cash_out x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($1::uuid[]) and public.app_business_date(x.occurred_at,o.business_day_cutover)=$2::date order by x.id`,
      [[sourceId, targetId], FROZEN.businessDate],
    ],
    drawer_observations: [
      `select x.* from public.drawer_observations x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($1::uuid[]) and public.app_business_date(x.counted_at,o.business_day_cutover)=$2::date order by x.id`,
      [[sourceId, targetId], FROZEN.businessDate],
    ],
    drawer_observation_adjustments: [
      `select x.* from public.drawer_observation_adjustments x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($1::uuid[]) and public.app_business_date(x.adjusted_at,o.business_day_cutover)=$2::date order by x.id`,
      [[sourceId, targetId], FROZEN.businessDate],
    ],
    drawer_reconciliation_acknowledgements: [
      `select x.* from public.drawer_reconciliation_acknowledgements x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($1::uuid[]) and public.app_business_date(x.acknowledged_at,o.business_day_cutover)=$2::date order by x.id`,
      [[sourceId, targetId], FROZEN.businessDate],
    ],
    inventory_movements: [
      `select * from public.inventory_movements where outlet_id=any($1::uuid[]) and business_date=$2::date order by id`,
      [[sourceId, targetId], FROZEN.businessDate],
    ],
  }
  for (const [name, [text, values]] of Object.entries(queries)) {
    const actual = normalizeDatabaseRows((await client.query(text, values)).rows)
    assertEqual(canonical(actual), canonical(r[name]), `${name} rollback before-image`)
  }
  const counters = await one(
    client,
    `select (select last_number from public.bill_number_counters where outlet_id=$1)::int source_bill,(select last_number from public.bill_number_counters where outlet_id=$2)::int target_bill,(select last_number from public.order_number_counters where outlet_id=$1 and business_date=$3::date)::int source_order,(select last_number from public.order_number_counters where outlet_id=$2 and business_date=$3::date)::int target_order`,
    [sourceId, targetId, FROZEN.businessDate],
  )
  assertEqual(counters.source_bill, FROZEN.sourceCounter, 'rolled-back source bill high-water')
  assertEqual(
    counters.target_bill,
    bundle.plan.counters.targetAfter,
    'retained target bill high-water',
  )
  assertEqual(counters.source_order, FROZEN.orderCounter, 'rolled-back source order high-water')
  assertEqual(counters.target_order, FROZEN.orderCounter, 'retained target order high-water')
  return { rowsMatchBeforeImage: true, highWaterMarksRetained: true, counters }
}

async function loadBundle(file) {
  const resolved = path.resolve(file)
  const serialized = await readFile(resolved, 'utf8')
  const expected = (await readFile(`${resolved}.sha256`, 'ascii')).trim().split(/\s+/)[0]
  const actual = sha256(serialized)
  assertEqual(actual, expected, 'before-image checksum')
  const bundle = JSON.parse(serialized)
  assertEqual(bundle.version, 3, 'before-image format version')
  assertEqual(bundle.planDigest, sha256(canonical(bundle.plan)), 'before-image plan digest')
  return { bundle, checksum: actual }
}
async function lockIncident(client, i) {
  await client.query(
    `select pg_advisory_xact_lock(hashtextextended('repair-kalyani-counter-attribution',0))`,
  )
  // Freeze every table that can add or change a row in either bill graph while
  // the locked plan is re-read. Reads remain available; counter writes wait and
  // would then allocate from the committed 1061 high-water.
  await client.query(`lock table
    public.bills,
    public.bill_items,
    public.bill_payments,
    public.bill_public_links,
    public.bill_discounts,
    public.bill_payment_corrections,
    public.bill_payment_correction_allocations,
    public.billing_attribution_reviews,
    public.billing_commands,
    public.orders,
    public.order_items,
    public.order_discounts,
    public.expenses,
    public.counter_devices,
    public.counter_shifts,
    public.counter_shift_requests,
    public.bill_number_counters,
    public.order_number_counters,
    public.menu_items
    in share row exclusive mode`)
  await client.query(
    `select id from public.counter_devices where id=any($1::uuid[]) order by id for update`,
    [[i.deviceId, i.laterDeviceId]],
  )
  await client.query(
    `select id from public.counter_shifts where id=any($1::uuid[]) order by id for update`,
    [[i.shiftId, i.laterShiftId]],
  )
  await client.query(
    `select id from public.bills where id=any($1::uuid[]) order by id for update`,
    [[...i.billIds, ...i.laterBillIds]],
  )
  await client.query(
    `select id from public.billing_commands where id=any($1::uuid[]) order by id for update`,
    [[...i.commands, ...i.laterCommands].map((command) => command.id)],
  )
  await client.query(
    `select id from public.orders where id=any($1::uuid[]) order by id for update`,
    [i.orderIds],
  )
  await client.query(
    `select outlet_id from public.bill_number_counters where outlet_id=any($1::uuid[]) order by outlet_id for update`,
    [[i.source.id, i.target.id]],
  )
  await client.query(
    `select id from public.menu_items where id=any($1::uuid[]) order by id for update`,
    [i.menu.map((entry) => entry.targetId)],
  )
}

async function assertLaterCounterClosed(client, i) {
  const state = await one(
    client,
    `select
       count(*) filter(
         where ended_at is null and expires_at>statement_timestamp()
       )::int live_shifts,
       (select count(*) from public.counter_shift_requests
         where device_id=$1 and resolution is null)::int pending_requests
      from public.counter_shifts where device_id=$1`,
    [i.laterDeviceId],
  )
  assertEqual(state.live_shifts, 0, 'live later Kalyani shifts at apply')
  assertEqual(state.pending_requests, 0, 'pending later Kalyani shift requests at apply')
}

async function verifyRepaired(client, safe, bundleRows = null) {
  const outlets = await client.query(
    `select id,code from public.outlets where code=any($1::text[])`,
    [[FROZEN.sourceCode, FROZEN.targetCode]],
  )
  const source = outlets.rows.find((r) => r.code === FROZEN.sourceCode)
  const target = outlets.rows.find((r) => r.code === FROZEN.targetCode)
  assert(source && target, 'Reviewed outlets missing during verify')
  const [targetBillMin, targetBillMax] = safe.targetBillRange
  const bills = await client.query(
    `select * from public.bills where outlet_id=$1 and business_date=$2::date and bill_number between $3 and $4 order by bill_number`,
    [target.id, FROZEN.businessDate, targetBillMin, targetBillMax],
  )
  assertEqual(bills.rowCount, EXPECTED.bills, 'repaired bill count')
  assert(
    bills.rows.every((b, n) => Number(b.bill_number) === targetBillMin + n),
    'Target bill numbering drifted',
  )
  const billIds = bills.rows.map((r) => r.id)
  const [shiftedLaterBillMin, shiftedLaterBillMax] = safe.shiftedLaterBillRange
  const laterBills = await client.query(
    `select * from public.bills
      where outlet_id=$1 and business_date=$2::date
        and bill_number between $3 and $4
      order by bill_number`,
    [target.id, safe.laterBusinessDate, shiftedLaterBillMin, shiftedLaterBillMax],
  )
  assertEqual(laterBills.rowCount, safe.laterCounts.bills, 'shifted later bill count')
  assert(
    laterBills.rows.every(
      (bill, index) =>
        bill.status === 'settled' &&
        bill.voided_at === null &&
        Number(bill.bill_number) === shiftedLaterBillMin + index,
    ),
    'Shifted later bills are not one contiguous settled, unvoided block',
  )
  const laterBillIds = laterBills.rows.map((bill) => bill.id)
  const laterCounts = await one(
    client,
    `select
       count(*)::int bills,
       sum(total_paise)::bigint total_paise,
       (select count(*) from public.bill_items where bill_id=any($1::uuid[]))::int bill_items,
       (select count(*) from public.bill_payments where bill_id=any($1::uuid[]))::int payments,
       (select count(*) from public.bill_public_links where bill_id=any($1::uuid[]))::int public_links,
       (select count(*) from public.bill_discounts where bill_id=any($1::uuid[]))::int discounts,
       (select count(*) from public.bill_payment_corrections where bill_id=any($1::uuid[]))::int corrections,
       (select count(*) from public.bill_payment_correction_allocations a
          join public.bill_payment_corrections c on c.id=a.correction_id
          where c.bill_id=any($1::uuid[]))::int correction_allocations,
       (select count(*) from public.billing_attribution_reviews where bill_id=any($1::uuid[]))::int attribution_reviews
      from public.bills where id=any($1::uuid[])`,
    [laterBillIds],
  )
  for (const [name, expected] of [
    ['bills', safe.laterCounts.bills],
    ['bill_items', safe.laterCounts.billItems],
    ['payments', safe.laterCounts.payments],
    ['public_links', safe.laterCounts.publicLinks],
    ['corrections', safe.laterCounts.corrections],
    ['correction_allocations', safe.laterCounts.correctionAllocations],
    ['discounts', 0],
    ['attribution_reviews', 0],
  ])
    assertEqual(laterCounts[name], expected, `shifted later ${name}`)
  assertEqual(
    integer(laterCounts.total_paise, 'shifted later total'),
    safe.laterCounts.totalPaise,
    'shifted later total',
  )
  const laterCommands = await client.query(
    `select c.* from public.billing_commands c
      where c.result?'billId'
        and (c.result->>'billId')::uuid=any($1::uuid[])
      order by c.id`,
    [laterBillIds],
  )
  assertEqual(
    laterCommands.rowCount,
    safe.laterCounts.commandsWithBill,
    'shifted later commands with bill',
  )
  assert(
    laterCommands.rows.every((command) => {
      const bill = laterBills.rows.find((candidate) => candidate.id === command.result.billId)
      return (
        bill &&
        command.outlet_id === target.id &&
        Number(command.result.billNumber) === Number(bill.bill_number)
      )
    }),
    'A shifted later command does not match its bill number',
  )
  const deviceIds = new Set(bills.rows.map((r) => r.counter_device_id))
  const shiftIds = new Set(bills.rows.map((r) => r.counter_shift_id))
  assertEqual(deviceIds.size, 1, 'repaired device cardinality')
  assertEqual(shiftIds.size, 1, 'repaired shift cardinality')
  const deviceId = [...deviceIds][0]
  const shiftId = [...shiftIds][0]
  const orders = await client.query(
    `select * from public.orders where outlet_id=$1 and business_date=$2::date and device_id=$3 order by order_number`,
    [target.id, FROZEN.businessDate, deviceId],
  )
  assertEqual(orders.rowCount, EXPECTED.orders, 'repaired order count')
  const orderIds = orders.rows.map((r) => r.id)
  const expenses = await client.query(
    `select * from public.expenses where outlet_id=$1 and business_date=$2::date and voided_at is null order by id`,
    [target.id, FROZEN.businessDate],
  )
  assertEqual(expenses.rowCount, EXPECTED.expenses, 'repaired expense count')
  const counts = await one(
    client,
    `select (select count(*) from public.bill_items where bill_id=any($1::uuid[]))::int bill_items,(select count(*) from public.bill_payments where bill_id=any($1::uuid[]))::int payments,(select count(*) from public.order_items where order_id=any($2::uuid[]))::int order_items,(select count(*) from public.billing_commands where shift_id=$3 and outlet_id=$4)::int commands,(select count(*) from public.bills where outlet_id=$5 and business_date=$6::date)::int source_bills,(select count(*) from public.orders where outlet_id=$5 and business_date=$6::date and device_id=$7)::int source_orders,(select sum(total_paise) from public.bills where id=any($1::uuid[]))::bigint bill_total,(select coalesce(sum(amount_paise),0) from public.bill_payments where bill_id=any($1::uuid[]) and method='cash')::bigint cash,(select coalesce(sum(amount_paise),0) from public.bill_payments where bill_id=any($1::uuid[]) and method='upi')::bigint upi`,
    [billIds, orderIds, shiftId, target.id, source.id, FROZEN.businessDate, deviceId],
  )
  for (const [name, expected] of [
    ['bill_items', EXPECTED.billItems],
    ['payments', EXPECTED.payments],
    ['order_items', EXPECTED.orderItems],
    ['commands', EXPECTED.commands],
    ['source_bills', 0],
    ['source_orders', 0],
  ])
    assertEqual(counts[name], expected, name)
  assertEqual(integer(counts.bill_total, 'bill total'), EXPECTED.billTotalPaise, 'bill total')
  assertEqual(integer(counts.cash, 'cash'), EXPECTED.cashPaise, 'cash')
  assertEqual(integer(counts.upi, 'upi'), EXPECTED.upiPaise, 'upi')
  assert(
    bills.rows.every((bill) => bill.status === 'settled' && bill.voided_at === null),
    'Repaired bills are not all settled and unvoided',
  )
  assertEqual(
    orders.rows.filter((order) => order.status === 'paid').length,
    EXPECTED.paidOrders,
    'repaired paid orders',
  )
  assertEqual(
    orders.rows.filter((order) => order.status === 'cancelled').length,
    EXPECTED.cancelledOrders,
    'repaired cancelled orders',
  )
  const operatorIds = new Set(bills.rows.map((row) => row.biller_profile_id))
  assertEqual(operatorIds.size, 1, 'repaired operator cardinality')
  const operatorId = [...operatorIds][0]
  assert(
    expenses.rows.every((expense) => expense.recorded_by === operatorId),
    'A repaired expense belongs to a different operator',
  )
  const invariants = await one(
    client,
    `select
       (select count(*) from public.bill_discounts where bill_id=any($1::uuid[]))::int bill_discounts,
       (select count(*) from public.order_discounts where order_id=any($2::uuid[]))::int order_discounts,
       (select count(*) from public.bill_payment_corrections where bill_id=any($1::uuid[]))::int payment_corrections,
       (select count(*) from public.bill_payment_correction_allocations a join public.bill_payment_corrections c on c.id=a.correction_id where c.bill_id=any($1::uuid[]))::int correction_allocations,
       (select count(*) from public.billing_attribution_reviews where bill_id=any($1::uuid[]))::int attribution_reviews,
       (select count(*) from public.billing_end_of_day_confirmations where shift_id=$3)::int end_of_day,
       (select count(*) from public.bills where id=any($1::uuid[]) and shift_id is not null)::int legacy_bill_shift_refs,
       (select count(*) from public.shifts where counter_device_id=$4 and business_date=$5::date)::int legacy_shifts,
       (select count(*) from public.counter_device_setup_codes where consumed_device_id=$4)::int setup_codes,
       (select count(*) from public.assignments where person_id=$6 and role='biller' and ended_on is null and outlet_id=any($7::uuid[]))::int assignments,
       (select count(*) from public.bill_items bi join public.menu_items mi on mi.id=bi.menu_item_id where bi.bill_id=any($1::uuid[]) and (mi.outlet_id<>$8 or mi.name<>bi.item_name or mi.price_paise<>bi.unit_price_paise))::int bad_bill_menu,
       (select count(*) from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id where oi.order_id=any($2::uuid[]) and (mi.outlet_id<>$8 or mi.name<>oi.item_name or mi.price_paise<>oi.unit_price_paise))::int bad_order_menu,
       (select count(*) from public.billing_commands c join public.bills b on b.id=(c.result->>'billId')::uuid where c.shift_id=$3 and c.result?'billId' and c.result?'billNumber' and (c.result->>'billNumber')::int<>b.bill_number)::int bad_command_bill_numbers`,
    [
      billIds,
      orderIds,
      shiftId,
      deviceId,
      FROZEN.businessDate,
      operatorId,
      [source.id, target.id],
      target.id,
    ],
  )
  for (const name of [
    'bill_discounts',
    'order_discounts',
    'payment_corrections',
    'correction_allocations',
    'attribution_reviews',
    'end_of_day',
    'legacy_bill_shift_refs',
    'legacy_shifts',
    'bad_bill_menu',
    'bad_order_menu',
    'bad_command_bill_numbers',
  ])
    assertEqual(invariants[name], 0, name)
  assertEqual(invariants.setup_codes, safe.setupCodeRows, 'device setup-code rows')
  assertEqual(invariants.assignments, 2, 'active Biller assignments')

  const sideEffects = await one(
    client,
    `select
       (select count(*) from public.aggregator_dismissed_duplicates d where d.expense_a=any($1::uuid[]) or d.expense_b=any($1::uuid[]))::int aggregator_expense_links,
       (select count(*) from public.drawer_cash_out x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($2::uuid[]) and public.app_business_date(x.occurred_at,o.business_day_cutover)=$3::date)::int drawer_cash_out,
       (select count(*) from public.drawer_observations x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($2::uuid[]) and public.app_business_date(x.counted_at,o.business_day_cutover)=$3::date)::int drawer_observations,
       (select count(*) from public.drawer_observation_adjustments x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($2::uuid[]) and public.app_business_date(x.adjusted_at,o.business_day_cutover)=$3::date)::int drawer_adjustments,
       (select count(*) from public.drawer_reconciliation_acknowledgements x join public.outlets o on o.id=x.outlet_id where x.outlet_id=any($2::uuid[]) and public.app_business_date(x.acknowledged_at,o.business_day_cutover)=$3::date)::int drawer_acknowledgements,
       (select count(*) from public.inventory_movements x where x.outlet_id=any($2::uuid[]) and x.business_date=$3::date)::int inventory_movements`,
    [expenses.rows.map((row) => row.id), [source.id, target.id], FROZEN.businessDate],
  )
  for (const [name, count] of Object.entries(sideEffects)) assertEqual(count, 0, `${name} count`)
  const device = await one(client, `select * from public.counter_devices where id=$1`, [deviceId])
  assertEqual(device.outlet_id, target.id, 'repaired device outlet')
  assertEqual(device.label, FROZEN.deviceLabel, 'repaired device label')
  const shift = await one(client, `select * from public.counter_shifts where id=$1`, [shiftId])
  assertEqual(shift.outlet_id, target.id, 'repaired shift outlet')
  assert(
    shift.ended_at !== null && shift.ended_reason === 'day_finished',
    'Incident shift is not closed as day_finished',
  )
  assertEqual(
    new Date(shift.expires_at).toISOString(),
    new Date(bundleRows.counter_shifts[0].expires_at).toISOString(),
    'shift stored expiry',
  )
  assert(
    new Date(shift.ended_at).getTime() <= new Date(shift.expires_at).getTime(),
    'Incident shift ended after its stored expiry',
  )
  const counters = await one(
    client,
    `select (select last_number from public.bill_number_counters where outlet_id=$1)::int source,(select last_number from public.bill_number_counters where outlet_id=$2)::int target,(select last_number from public.order_number_counters where outlet_id=$1 and business_date=$3::date)::int source_order,(select last_number from public.order_number_counters where outlet_id=$2 and business_date=$3::date)::int target_order`,
    [source.id, target.id, FROZEN.businessDate],
  )
  assertEqual(counters.source, FROZEN.sourceCounter, 'source counter')
  assertEqual(counters.target, safe.counters.targetAfter, 'target counter')
  assertEqual(counters.source_order, FROZEN.orderCounter, 'source order counter')
  assertEqual(counters.target_order, FROZEN.orderCounter, 'target order counter')
  const hashes = {
    bills: await hashRows(
      client,
      'bills',
      'id=any($1::uuid[])',
      [billIds],
      ['outlet_id', 'bill_number'],
    ),
    billItems: await hashRows(
      client,
      'bill_items',
      'bill_id=any($1::uuid[])',
      [billIds],
      ['menu_item_id', 'item_name'],
    ),
    payments: await hashRows(
      client,
      'bill_payments',
      'bill_id=any($1::uuid[])',
      [billIds],
      ['outlet_id'],
    ),
    orders: await hashRows(client, 'orders', 'id=any($1::uuid[])', [orderIds], ['outlet_id']),
    orderItems: await hashRows(
      client,
      'order_items',
      'order_id=any($1::uuid[])',
      [orderIds],
      ['menu_item_id', 'item_name'],
    ),
    commands: await hashCommandRows(client, 'shift_id=$1', [shiftId], {
      excludeOutlet: true,
    }),
    expenses: await hashRows(
      client,
      'expenses',
      'id=any($1::uuid[])',
      [expenses.rows.map((r) => r.id)],
      ['outlet_id'],
    ),
    publicLinks: await hashRows(
      client,
      'bill_public_links',
      'bill_id=any($1::uuid[])',
      [billIds],
      [],
      'bill_id',
    ),
    laterBills: await hashRows(
      client,
      'bills',
      'id=any($1::uuid[])',
      [laterBillIds],
      ['bill_number'],
    ),
    laterBillItems: await hashRows(client, 'bill_items', 'bill_id=any($1::uuid[])', [laterBillIds]),
    laterPayments: await hashRows(client, 'bill_payments', 'bill_id=any($1::uuid[])', [
      laterBillIds,
    ]),
    laterPublicLinks: await hashRows(
      client,
      'bill_public_links',
      'bill_id=any($1::uuid[])',
      [laterBillIds],
      [],
      'bill_id',
    ),
    laterCommands: await hashCommandRows(client, 'id=any($1::uuid[])', [
      laterCommands.rows.map((command) => command.id),
    ]),
    laterCorrections: await hashRows(
      client,
      'bill_payment_corrections',
      'bill_id=any($1::uuid[])',
      [laterBillIds],
    ),
    laterCorrectionAllocations: await hashRows(
      client,
      'bill_payment_correction_allocations',
      'correction_id in (select id from public.bill_payment_corrections where bill_id=any($1::uuid[]))',
      [laterBillIds],
      [],
      'correction_id',
    ),
    billMapping: sha256(
      canonical(bills.rows.map((bill) => ({ id: bill.id, number: Number(bill.bill_number) }))),
    ),
    laterBillMapping: sha256(
      canonical(laterBills.rows.map((bill) => ({ id: bill.id, number: Number(bill.bill_number) }))),
    ),
  }
  for (const [name, value] of Object.entries(hashes))
    assertEqual(value, safe.hashes[name], `${name} stable hash`)
  if (bundleRows) {
    const original = bundleRows.counter_devices[0]
    assertEqual(device.id, original.id, 'device identity')
    assertEqual(
      new Date(device.session_proven_at).toISOString(),
      new Date(original.session_proven_at).toISOString(),
      'device session proof',
    )
    assertEqual(
      new Date(device.set_up_at).toISOString(),
      new Date(original.set_up_at).toISOString(),
      'device setup time',
    )
    assertEqual(device.set_up_by, original.set_up_by, 'device setup actor')
  }
  return {
    bills: EXPECTED.bills,
    shiftedLaterBills: safe.laterCounts.bills,
    orders: EXPECTED.orders,
    expenses: EXPECTED.expenses,
    billTotalPaise: EXPECTED.billTotalPaise,
    cashPaise: EXPECTED.cashPaise,
    upiPaise: EXPECTED.upiPaise,
    sourceCounter: counters.source,
    targetCounter: counters.target,
    deviceAtTarget: true,
    shiftClosed: true,
    stableHashes: hashes,
  }
}

async function applyRepair(client, plan, bundle, failureInjection) {
  const i = plan.internal
  let stage = 'begin transaction'
  await client.query('begin')
  try {
    stage = 'lock and recheck plan'
    await client.query("set local lock_timeout='5s'")
    await client.query("set local statement_timeout='60s'")
    await lockIncident(client, i)
    await assertLaterCounterClosed(client, i)
    assertEqual((await loadPlan(client)).digest, plan.digest, 'locked plan digest')
    await disableGuards(client)
    stage = 'mutate repaired graph'
    injectFailure(failureInjection, 'after-guards-disabled')
    for (const m of i.menu) {
      await client.query(
        `update public.bill_items set menu_item_id=$1,item_name=$2 where bill_id=any($3::uuid[]) and item_name=$4 and unit_price_paise=$5`,
        [m.targetId, m.targetName, i.billIds, m.sourceName, m.price],
      )
      await client.query(
        `update public.order_items set menu_item_id=$1,item_name=$2 where order_id=any($3::uuid[]) and item_name=$4 and unit_price_paise=$5`,
        [m.targetId, m.targetName, i.orderIds, m.sourceName, m.price],
      )
    }
    injectFailure(failureInjection, 'after-menu')
    await client.query(`update public.orders set outlet_id=$1 where id=any($2::uuid[])`, [
      i.target.id,
      i.orderIds,
    ])
    injectFailure(failureInjection, 'after-orders')
    await client.query(
      `update public.bill_payments set outlet_id=$1 where bill_id=any($2::uuid[])`,
      [i.target.id, i.billIds],
    )
    injectFailure(failureInjection, 'after-payments')
    // Vacate the old range before assigning final numbers. The unique
    // constraint is checked row-by-row, so a reserved high staging range makes
    // apply and rollback independent of PostgreSQL's update order.
    for (const [index, m] of i.laterNumberMapping.entries())
      await client.query(`update public.bills set bill_number=$1 where id=$2`, [
        FROZEN.stagingBillBase + index,
        m.id,
      ])
    for (const m of i.laterNumberMapping)
      await client.query(`update public.bills set bill_number=$1 where id=$2`, [m.number, m.id])
    injectFailure(failureInjection, 'after-later-bills')
    await client.query(
      `update public.billing_commands c
          set result=jsonb_set(c.result,'{billNumber}',to_jsonb(m.number),false)
         from jsonb_to_recordset($1::jsonb)m(id uuid,number int)
        where c.id=any($2::uuid[])
          and c.result?'billId'
          and (c.result->>'billId')::uuid=m.id`,
      [JSON.stringify(i.laterNumberMapping), i.laterCommands.map((command) => command.id)],
    )
    injectFailure(failureInjection, 'after-later-commands')
    for (const m of i.numberMapping)
      await client.query(`update public.bills set outlet_id=$1,bill_number=$2 where id=$3`, [
        i.target.id,
        m.number,
        m.id,
      ])
    injectFailure(failureInjection, 'after-bills')
    await client.query(
      `update public.billing_commands c set outlet_id=$1,result=case when c.result?'billNumber' then jsonb_set(c.result,'{billNumber}',to_jsonb(m.number),false) else c.result end from jsonb_to_recordset($2::jsonb)m(id uuid,number int) where c.shift_id=$3 and (not(c.result?'billId')or(c.result->>'billId')::uuid=m.id)`,
      [i.target.id, JSON.stringify(i.numberMapping), i.shiftId],
    )
    injectFailure(failureInjection, 'after-commands')
    await client.query(`update public.expenses set outlet_id=$1 where id=any($2::uuid[])`, [
      i.target.id,
      i.expenses.map((r) => r.id),
    ])
    injectFailure(failureInjection, 'after-expenses')
    await client.query(`update public.counter_shift_requests set outlet_id=$1 where shift_id=$2`, [
      i.target.id,
      i.shiftId,
    ])
    await client.query(
      `update public.counter_shifts set outlet_id=$1,ended_at=least(expires_at,statement_timestamp()),ended_reason='day_finished' where id=$2`,
      [i.target.id, i.shiftId],
    )
    injectFailure(failureInjection, 'after-shift')
    await client.query(`update public.bill_number_counters set last_number=$1 where outlet_id=$2`, [
      plan.safe.counters.targetAfter,
      i.target.id,
    ])
    await client.query(
      `insert into public.order_number_counters(outlet_id,business_date,last_number)values($1,$2::date,$3)on conflict(outlet_id,business_date)do update set last_number=excluded.last_number`,
      [i.target.id, FROZEN.businessDate, FROZEN.orderCounter],
    )
    injectFailure(failureInjection, 'after-counters')
    await client.query(`update public.counter_devices set outlet_id=$1,label=$2 where id=$3`, [
      i.target.id,
      FROZEN.deviceLabel,
      i.deviceId,
    ])
    injectFailure(failureInjection, 'after-device')
    injectFailure(failureInjection, 'before-guard-restore')
    stage = 'restore database guards'
    await enableGuards(client)
    injectFailure(failureInjection, 'after-guard-restore')
    stage = 'verify repaired graph'
    await assertGuards(client, bundle.catalog)
    const outcome = await verifyRepaired(client, plan.safe, bundle.rows)
    stage = 'commit repaired graph'
    await client.query('commit')
    return outcome
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
}
async function rollbackRepair(client, bundle) {
  await assertGuards(client, bundle.catalog)
  const verified = await verifyRepaired(client, bundle.plan, bundle.rows)
  const deviceId = bundle.rows.counter_devices[0].id
  const shiftId = bundle.rows.counter_shifts[0].id
  const sourceId = bundle.rows.counter_devices[0].outlet_id
  const targetId = bundle.rows.bill_number_counters.find((r) => r.outlet_id !== sourceId).outlet_id
  const drift = await one(
    client,
    `select (select count(*) from public.counter_shifts where device_id=$1 and id<>$2 and opened_at>(select ended_at from public.counter_shifts where id=$2))::int later_shifts,(select count(*) from public.bills where outlet_id=$3 and bill_number>$4)::int later_target_bills,(select count(*) from public.bills where outlet_id=$5 and bill_number>$6)::int later_source_bills`,
    [deviceId, shiftId, targetId, bundle.plan.counters.targetAfter, sourceId, FROZEN.sourceCounter],
  )
  assertEqual(drift.later_shifts, 0, 'later device shifts')
  assertEqual(drift.later_target_bills, 0, 'later target bills')
  assertEqual(drift.later_source_bills, 0, 'later source bills')
  await client.query('begin')
  try {
    await client.query("set local lock_timeout='5s'")
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended('repair-kalyani-counter-attribution',0))`,
    )
    await disableGuards(client)
    await client.query(restoreRowsSql(bundle.rows))
    await enableGuards(client)
    await assertGuards(client, bundle.catalog)
    const restored = await verifyRolledBack(client, bundle)
    await client.query('commit')
    return { ...verified, rolledBack: true, ...restored }
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  requireFrozenArgs(args)
  const client = await connect(args)
  try {
    if (args.mode === 'plan') {
      const plan = await loadPlan(client)
      const output = {
        mode: 'plan',
        environment: args.environment,
        digest: plan.digest,
        ...plan.safe,
      }
      if (args['write-before-image'])
        output.beforeImage = await captureBeforeImage(client, plan, args['write-before-image'])
      console.log(JSON.stringify(output, null, 2))
      return
    }
    if (args.mode === 'verify') {
      if (!args['before-image']) throw new Error('--before-image is required for verify')
      const { bundle } = await loadBundle(args['before-image'])
      await assertGuards(client, bundle.catalog)
      const result = await verifyRepaired(client, bundle.plan, bundle.rows)
      console.log(
        JSON.stringify(
          { mode: 'verify', environment: args.environment, planDigest: bundle.planDigest, result },
          null,
          2,
        ),
      )
      return
    }
    if (args.mode === 'apply') {
      if (!args.digest || !args.confirm || !args['before-image'])
        throw new Error('apply requires --digest, --confirm and --before-image')
      assertEqual(args.confirm, FROZEN.confirmation, 'confirmation phrase')
      const { bundle } = await loadBundle(args['before-image'])
      const plan = await loadPlan(client)
      assertEqual(plan.digest, args.digest, 'fresh plan digest')
      assertEqual(bundle.planDigest, args.digest, 'before-image plan digest')
      const result = await applyRepair(client, plan, bundle, args['inject-failure'])
      console.log(
        JSON.stringify(
          {
            mode: 'apply',
            environment: args.environment,
            planDigest: plan.digest,
            committed: true,
            result,
          },
          null,
          2,
        ),
      )
      return
    }
    if (!args['before-image']) throw new Error('--before-image is required for rollback')
    const { bundle, checksum } = await loadBundle(args['before-image'])
    if (args.digest) assertEqual(args.digest, bundle.planDigest, 'rollback plan digest')
    const result = await rollbackRepair(client, bundle)
    console.log(
      JSON.stringify(
        {
          mode: 'rollback',
          environment: args.environment,
          planDigest: bundle.planDigest,
          bundleChecksum: checksum,
          committed: true,
          result,
        },
        null,
        2,
      ),
    )
  } finally {
    await client.end()
  }
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown failure',
    }),
  )
  process.exitCode = 1
})
