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
  boundary: '2026-09-15T22:30:00.000Z', // 2026-09-16 04:00 Asia/Kolkata
  oldLabel: 'Kanchrapara',
  currentLabel: 'Kalyani Counter 2',
  incidentBundleChecksum: '69108a1995fc35bc934bf661e57c3f4147beee63403789eabbca0771d56c7e07',
  financeBundleChecksum: '81c8f2e075dfbbc3bd3eef8f2684dbfa698b1ffe9b56c55d3d32fde038b5c515',
  confirmation: 'REALIGN-2026-09-16-DEVICE-HISTORY',
})

function parseArgs(argv) {
  const [mode, ...rest] = argv
  if (!['plan', 'capture', 'apply', 'verify', 'rollback'].includes(mode)) {
    throw new Error(
      'Usage: repair-kalyani-device-history-boundary.mjs <plan|capture|apply|verify|rollback> [options]',
    )
  }
  const args = { mode }
  for (let index = 0; index < rest.length; index += 2) {
    const option = rest[index]
    const value = rest[index + 1]
    if (!option?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Invalid option near ${option ?? '<end>'}`)
    }
    args[option.slice(2)] = value
  }
  for (const key of [
    'environment',
    'project-ref',
    'incident-before-image',
    'finance-before-image',
  ]) {
    if (!args[key]) throw new Error(`--${key} is required`)
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
  if (args.mode === 'capture' && !args['out-dir']) throw new Error('--out-dir is required')
  if (['apply', 'verify', 'rollback'].includes(args.mode) && !args['boundary-bundle']) {
    throw new Error('--boundary-bundle is required')
  }
  if (
    ['apply', 'rollback'].includes(args.mode) &&
    args.environment === 'production' &&
    args.confirm !== FROZEN.confirmation
  ) {
    throw new Error(`Production ${args.mode} requires --confirm ${FROZEN.confirmation}`)
  }
  return args
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

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const integer = (value, name) => {
  const parsed = Number(value)
  assert(Number.isSafeInteger(parsed), `${name} is not a safe integer`)
  return parsed
}
const instant = (value) => new Date(value).toISOString()

async function checkedJson(file, expectedChecksum, label) {
  const absolute = path.resolve(file)
  const raw = await readFile(absolute, 'utf8')
  const recorded = (await readFile(`${absolute}.sha256`, 'ascii')).trim().split(/\s+/)[0]
  assert(sha256(raw) === recorded, `${label} checksum does not match`)
  if (expectedChecksum) assert(recorded === expectedChecksum, `${label} is not the frozen bundle`)
  return { value: JSON.parse(raw), checksum: recorded }
}

async function inputs(args) {
  const incident = await checkedJson(
    args['incident-before-image'],
    FROZEN.incidentBundleChecksum,
    'Incident before-image',
  )
  const finance = await checkedJson(
    args['finance-before-image'],
    FROZEN.financeBundleChecksum,
    'Finance before-image',
  )
  const device = incident.value.rows?.counter_devices?.[0]
  assert(device?.label === FROZEN.oldLabel, 'Incident bundle does not identify the old device')
  assert(
    finance.value.safe?.observation?.expectedPaise === 522000 &&
      finance.value.safe?.observation?.derivedExpectedPaise === 697000,
    'Finance bundle does not describe the reviewed drawer correction',
  )
  return {
    deviceId: device.id,
    incidentChecksum: incident.checksum,
    financeChecksum: finance.checksum,
  }
}

async function loadBoundaryBundle(args) {
  return checkedJson(args['boundary-bundle'], null, 'Boundary before-image')
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
    application_name: `repair-kalyani-device-history-boundary/${args.mode}`,
  })
  await client.connect()
  if (args.environment === 'production') await client.query('set role postgres')
  await client.query("set timezone='UTC'")
  return client
}

async function compute(client, frozen) {
  const deviceResult = await client.query(
    `select d.id,d.outlet_id,d.label,d.removed_at,o.name outlet_name
       from public.counter_devices d join public.outlets o on o.id=d.outlet_id
      where d.id=$1`,
    [frozen.deviceId],
  )
  assert(deviceResult.rowCount === 1, 'Reviewed tablet is missing')
  const device = deviceResult.rows[0]

  const historyResult = await client.query(
    `select h.id,h.device_id,h.outlet_id,h.label,h.valid_from,h.valid_to,o.name outlet_name
       from public.counter_device_history h join public.outlets o on o.id=h.outlet_id
      where h.device_id=$1 order by h.valid_from,h.id`,
    [frozen.deviceId],
  )

  const timelineResult = await client.query(
    `with events as (
       select 'bill' kind,b.business_date,b.paid_at event_at
         from public.bills b where b.counter_device_id=$1
       union all
       select 'order',o.business_date,o.ordered_at from public.orders o where o.device_id=$1
       union all
       select 'shift',s.business_date,s.opened_at from public.counter_shifts s where s.device_id=$1
     )
     select max(event_at) filter(where business_date<$2::date) last_prior,
            min(event_at) filter(where business_date=$2::date) first_incident,
            count(*) filter(where business_date<$2::date and event_at>=$3::timestamptz)::int prior_at_or_after_boundary,
            count(*) filter(where business_date=$2::date and kind='bill')::int incident_bills,
            count(*) filter(where business_date=$2::date and kind='order')::int incident_orders,
            count(*) filter(where business_date=$2::date and kind='shift')::int incident_shifts
       from events`,
    [frozen.deviceId, FROZEN.businessDate, FROZEN.boundary],
  )

  const labelsResult = await client.query(
    `select
       (select count(*)::int from public.bills b join public.counter_device_history h
          on h.device_id=b.counter_device_id and h.valid_from<=b.paid_at
         and (h.valid_to is null or b.paid_at<h.valid_to)
        where b.counter_device_id=$1 and h.label=$2) old_bills,
       (select count(*)::int from public.bills b join public.counter_device_history h
          on h.device_id=b.counter_device_id and h.valid_from<=b.paid_at
         and (h.valid_to is null or b.paid_at<h.valid_to)
        where b.counter_device_id=$1 and h.label=$3) current_bills,
       (select count(*)::int from public.bills b join public.counter_device_history h
          on h.device_id=b.counter_device_id and h.valid_from<=b.paid_at
         and (h.valid_to is null or b.paid_at<h.valid_to)
        where b.counter_device_id=$1 and b.business_date=$4::date and h.label=$3) incident_current_bills,
       (select count(*)::int from public.orders o join public.counter_device_history h
          on h.device_id=o.device_id and h.valid_from<=o.ordered_at
         and (h.valid_to is null or o.ordered_at<h.valid_to)
        where o.device_id=$1 and h.label=$2) old_orders,
       (select count(*)::int from public.orders o join public.counter_device_history h
          on h.device_id=o.device_id and h.valid_from<=o.ordered_at
         and (h.valid_to is null or o.ordered_at<h.valid_to)
        where o.device_id=$1 and h.label=$3) current_orders,
       (select count(*)::int from public.orders o join public.counter_device_history h
          on h.device_id=o.device_id and h.valid_from<=o.ordered_at
         and (h.valid_to is null or o.ordered_at<h.valid_to)
        where o.device_id=$1 and o.business_date=$4::date and h.label=$3) incident_current_orders,
       (select count(*)::int from public.counter_device_history a
          join public.counter_device_history b on a.device_id=b.device_id and a.id<b.id
           and a.valid_from<coalesce(b.valid_to,'infinity'::timestamptz)
           and b.valid_from<coalesce(a.valid_to,'infinity'::timestamptz)
        where a.device_id=$1) overlap_count`,
    [frozen.deviceId, FROZEN.oldLabel, FROZEN.currentLabel, FROZEN.businessDate],
  )

  const financeResult = await client.query(
    `with target as (
       select id from public.outlets where name='Kalyani'
     ), source as (
       select id from public.outlets where name='Kanchrapara'
     ), payments as (
       select p.bill_id,sum(p.amount_paise)::bigint total,
              coalesce(sum(p.amount_paise) filter(where p.method='cash'),0)::bigint cash,
              coalesce(sum(p.amount_paise) filter(where p.method='upi'),0)::bigint upi
         from public.effective_bill_payments p group by p.bill_id
     ), incident as (
       select count(*)::int bills,sum(b.total_paise)::bigint total,
              sum(p.total)::bigint payments,sum(p.cash)::bigint cash,sum(p.upi)::bigint upi,
              count(*) filter(where p.total is distinct from b.total_paise)::int mismatches
         from public.bills b join payments p on p.bill_id=b.id
        where b.outlet_id=(select id from target) and b.business_date=$1::date
     ), expenses as (
       select count(*)::int rows,coalesce(sum(e.amount_paise),0)::bigint total
         from public.effective_expenses e
        where e.outlet_id=(select id from target) and e.business_date=$1::date
     ), observation as (
       select d.* from public.drawer_observations d
        where d.outlet_id=(select id from target) order by d.counted_at desc limit 1
     )
     select i.*,e.rows expense_rows,e.total expense_total,
            o.counted_total_paise,o.expected_paise,o.difference_paise,
            (select coalesce(sum(c.amount_paise),0)::bigint from public.drawer_cash_out c
              where c.observation_id=o.id) collected_paise,
            (select last_number from public.bill_number_counters where outlet_id=(select id from target)) target_counter,
            (select last_number from public.bill_number_counters where outlet_id=(select id from source)) source_counter
       from incident i cross join expenses e cross join observation o`,
    [FROZEN.businessDate],
  )

  const timeline = timelineResult.rows[0]
  const labels = labelsResult.rows[0]
  const finance = financeResult.rows[0]
  const safe = {
    change: 'repair-kalyani-device-history-boundary',
    boundary: FROZEN.boundary,
    boundaryIst: '2026-09-16 04:00:00',
    incidentBundleChecksum: frozen.incidentChecksum,
    financeBundleChecksum: frozen.financeChecksum,
    device: { label: device.label, outlet: device.outlet_name, active: device.removed_at === null },
    history: historyResult.rows.map((row) => ({
      label: row.label,
      outlet: row.outlet_name,
      validFrom: instant(row.valid_from),
      validTo: row.valid_to ? instant(row.valid_to) : null,
    })),
    timeline: {
      lastPrior: instant(timeline.last_prior),
      firstIncident: instant(timeline.first_incident),
      priorAtOrAfterBoundary: integer(timeline.prior_at_or_after_boundary, 'prior events'),
      incidentBills: integer(timeline.incident_bills, 'incident bills'),
      incidentOrders: integer(timeline.incident_orders, 'incident orders'),
      incidentShifts: integer(timeline.incident_shifts, 'incident shifts'),
    },
    labels: Object.fromEntries(
      Object.entries(labels).map(([key, value]) => [key, integer(value, key)]),
    ),
    finance: Object.fromEntries(
      Object.entries(finance).map(([key, value]) => [key, integer(value, key)]),
    ),
  }
  return { safe, device, history: historyResult.rows }
}

function assertFinance(plan) {
  const f = plan.safe.finance
  assert(f.bills === 37 && f.total === 906000 && f.payments === 906000, 'Incident totals drifted')
  assert(f.cash === 213000 && f.upi === 693000 && f.mismatches === 0, 'Payment split drifted')
  assert(f.expense_rows === 5 && f.expense_total === 38000, 'Incident expenses drifted')
  assert(
    f.counted_total_paise === 520000 &&
      f.expected_paise === 697000 &&
      f.difference_paise === -177000 &&
      f.collected_paise === 500000,
    'Drawer facts drifted',
  )
  assert(f.target_counter === 1061 && f.source_counter === 778, 'Bill counters drifted')
}

function assertCommon(plan) {
  assert(plan.safe.device.label === FROZEN.currentLabel, 'Current device label drifted')
  assert(
    plan.safe.device.outlet === 'Kalyani' && plan.safe.device.active,
    'Current device authority drifted',
  )
  assert(plan.history.length === 2, 'Expected exactly two device-history intervals')
  assert(plan.safe.timeline.priorAtOrAfterBoundary === 0, 'A prior-day event crosses the boundary')
  assert(
    new Date(plan.safe.timeline.lastPrior) < new Date(FROZEN.boundary) &&
      new Date(FROZEN.boundary) < new Date(plan.safe.timeline.firstIncident),
    'The 04:00 IST boundary is not inside the empty event interval',
  )
  assert(
    plan.safe.timeline.incidentBills === 37 &&
      plan.safe.timeline.incidentOrders === 39 &&
      plan.safe.timeline.incidentShifts === 1,
    'Incident event counts drifted',
  )
  assert(plan.safe.labels.overlap_count === 0, 'Device-history intervals overlap')
  assertFinance(plan)
}

function assertBefore(plan) {
  assertCommon(plan)
  const [oldInterval, currentInterval] = plan.history
  assert(
    oldInterval.label === FROZEN.oldLabel && oldInterval.outlet_name === 'Kanchrapara',
    'Old interval identity drifted',
  )
  assert(
    currentInterval.label === FROZEN.currentLabel && currentInterval.outlet_name === 'Kalyani',
    'Current interval identity drifted',
  )
  assert(oldInterval.valid_to && currentInterval.valid_to === null, 'History endpoints drifted')
  assert(
    instant(oldInterval.valid_to) === instant(currentInterval.valid_from),
    'Current history boundary is discontinuous',
  )
  assert(
    new Date(oldInterval.valid_to) > new Date(FROZEN.boundary),
    'History is already at or before target',
  )
  const l = plan.safe.labels
  assert(
    l.old_bills === 778 && l.current_bills === 0 && l.incident_current_bills === 0,
    'Before-state bill labels drifted',
  )
  assert(
    l.old_orders === 829 && l.current_orders === 0 && l.incident_current_orders === 0,
    'Before-state order labels drifted',
  )
}

function assertAfter(plan) {
  assertCommon(plan)
  const [oldInterval, currentInterval] = plan.history
  assert(instant(oldInterval.valid_to) === FROZEN.boundary, 'Old interval does not end at cutover')
  assert(
    instant(currentInterval.valid_from) === FROZEN.boundary,
    'Current interval does not start at cutover',
  )
  assert(currentInterval.valid_to === null, 'Current interval unexpectedly closed')
  const l = plan.safe.labels
  assert(
    l.old_bills === 741 && l.current_bills === 37 && l.incident_current_bills === 37,
    'After-state bill labels are wrong',
  )
  assert(
    l.old_orders === 790 && l.current_orders === 39 && l.incident_current_orders === 39,
    'After-state order labels are wrong',
  )
}

function exactHistory(actual, expected) {
  return canonical(actual) === canonical(expected)
}

async function capture(args, client, frozen) {
  const root = path.resolve(args['out-dir'])
  const repo = path.resolve(process.cwd())
  const relative = path.relative(repo, root)
  assert(
    relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    'Backup directory must be outside the repository',
  )
  const plan = await compute(client, frozen)
  assertBefore(plan)
  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    planDigest: sha256(canonical(plan.safe)),
    safe: plan.safe,
    rows: { history: plan.history },
  }
  const raw = `${JSON.stringify(payload)}\n`
  const checksum = sha256(raw)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const file = path.join(root, 'before-image.json')
  await writeFile(file, raw, { encoding: 'utf8', mode: 0o600 })
  await chmod(file, 0o600)
  await writeFile(`${file}.sha256`, `${checksum}  before-image.json\n`, {
    encoding: 'ascii',
    mode: 0o600,
  })
  return { mode: 'capture', planDigest: payload.planDigest, checksum, path: file, plan: plan.safe }
}

async function apply(args, client, frozen, boundaryBundle) {
  await client.query('begin')
  try {
    await client.query("set local lock_timeout='5s'")
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended('repair-kalyani-device-history-boundary',0))",
    )
    await client.query('select 1 from public.counter_devices where id=$1 for update', [
      frozen.deviceId,
    ])
    await client.query(
      'select 1 from public.counter_device_history where device_id=$1 order by valid_from,id for update',
      [frozen.deviceId],
    )
    const before = await compute(client, frozen)
    assertBefore(before)
    assert(
      exactHistory(before.history, boundaryBundle.value.rows.history),
      'Locked history differs from the captured before-image',
    )
    assert(
      sha256(canonical(before.safe)) === boundaryBundle.value.planDigest,
      'Fresh plan digest differs from captured plan',
    )
    const [oldInterval, currentInterval] = before.history
    const oldUpdate = await client.query(
      'update public.counter_device_history set valid_to=$1 where id=$2',
      [FROZEN.boundary, oldInterval.id],
    )
    assert(oldUpdate.rowCount === 1, 'Old interval update changed the wrong row count')
    const currentUpdate = await client.query(
      'update public.counter_device_history set valid_from=$1 where id=$2',
      [FROZEN.boundary, currentInterval.id],
    )
    assert(currentUpdate.rowCount === 1, 'Current interval update changed the wrong row count')
    const after = await compute(client, frozen)
    assertAfter(after)
    await client.query('commit')
    return { mode: 'apply', planDigest: boundaryBundle.value.planDigest, labels: after.safe.labels }
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function verify(client, frozen, boundaryBundle) {
  await client.query('begin read only')
  try {
    const plan = await compute(client, frozen)
    assertAfter(plan)
    await client.query('rollback')
    return {
      mode: 'verify',
      planDigest: boundaryBundle.value.planDigest,
      boundary: FROZEN.boundary,
      labels: plan.safe.labels,
      finance: plan.safe.finance,
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function rollback(args, client, frozen, boundaryBundle) {
  await client.query('begin')
  try {
    await client.query("set local lock_timeout='5s'")
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended('repair-kalyani-device-history-boundary',0))",
    )
    await client.query('select 1 from public.counter_devices where id=$1 for update', [
      frozen.deviceId,
    ])
    await client.query(
      'select 1 from public.counter_device_history where device_id=$1 order by valid_from,id for update',
      [frozen.deviceId],
    )
    const current = await compute(client, frozen)
    assertAfter(current)
    const [capturedOld, capturedCurrent] = boundaryBundle.value.rows.history
    const currentUpdate = await client.query(
      'update public.counter_device_history set valid_from=$1 where id=$2',
      [capturedCurrent.valid_from, capturedCurrent.id],
    )
    assert(currentUpdate.rowCount === 1, 'Current interval rollback changed the wrong row count')
    const oldUpdate = await client.query(
      'update public.counter_device_history set valid_to=$1 where id=$2',
      [capturedOld.valid_to, capturedOld.id],
    )
    assert(oldUpdate.rowCount === 1, 'Old interval rollback changed the wrong row count')
    const restored = await compute(client, frozen)
    assertBefore(restored)
    assert(
      exactHistory(restored.history, boundaryBundle.value.rows.history),
      'Rollback was not exact',
    )
    await client.query('commit')
    return { mode: 'rollback', planDigest: boundaryBundle.value.planDigest }
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const frozen = await inputs(args)
  const client = await connect(args)
  try {
    if (args.mode === 'plan') {
      await client.query('begin read only')
      const plan = await compute(client, frozen)
      assertBefore(plan)
      await client.query('rollback')
      console.log(
        JSON.stringify(
          { mode: 'plan', digest: sha256(canonical(plan.safe)), plan: plan.safe },
          null,
          2,
        ),
      )
      return
    }
    if (args.mode === 'capture') {
      await client.query('begin read only')
      const result = await capture(args, client, frozen)
      await client.query('rollback')
      console.log(JSON.stringify(result, null, 2))
      return
    }
    const boundaryBundle = await loadBoundaryBundle(args)
    const result =
      args.mode === 'apply'
        ? await apply(args, client, frozen, boundaryBundle)
        : args.mode === 'verify'
          ? await verify(client, frozen, boundaryBundle)
          : await rollback(args, client, frozen, boundaryBundle)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`)
  process.exitCode = 1
})
