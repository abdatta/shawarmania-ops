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
  currentLabel: 'Kalyani Counter 2',
  oldLabel: 'Kanchrapara',
  incidentBills: 37,
  incidentCashPaise: 213000,
  incidentCashExpensesPaise: 38000,
  expectedDeltaPaise: 175000,
  originalBundleChecksum: '69108a1995fc35bc934bf661e57c3f4147beee63403789eabbca0771d56c7e07',
  countedPaise: 520000,
  collectedPaise: 500000,
  expectedBeforePaise: 522000,
  differenceBeforePaise: -2000,
  expectedAfterPaise: 697000,
  differenceAfterPaise: -177000,
  confirmation: 'RECONCILE-2026-09-16-FINANCE-HISTORY',
})

function parseArgs(argv) {
  const [mode, ...rest] = argv
  if (!['plan', 'capture', 'apply', 'verify', 'rollback'].includes(mode)) {
    throw new Error(
      'Usage: repair-kalyani-finance-and-device-history.mjs <plan|capture|apply|verify|rollback> [options]',
    )
  }
  const args = { mode }
  for (let i = 0; i < rest.length; i += 2) {
    const token = rest[i]
    const value = rest[i + 1]
    if (!token?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Invalid option near ${token ?? '<end>'}`)
    }
    args[token.slice(2)] = value
  }
  for (const key of ['environment', 'project-ref', 'original-before-image']) {
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
  if (['apply', 'verify', 'rollback'].includes(args.mode) && !args['followup-bundle']) {
    throw new Error('--followup-bundle is required')
  }
  if (args['fail-after']) {
    if (args.mode !== 'apply' || args.environment !== 'scratch') {
      throw new Error('--fail-after is allowed only for scratch apply rehearsals')
    }
    if (!['history', 'observation'].includes(args['fail-after'])) {
      throw new Error('--fail-after must be history or observation')
    }
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
const number = (value, name) => {
  const parsed = Number(value)
  assert(Number.isSafeInteger(parsed), `${name} is not a safe integer`)
  return parsed
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
    application_name: `repair-kalyani-finance-device-history/${args.mode}`,
  })
  await client.connect()
  if (args.environment === 'production') await client.query('set role postgres')
  await client.query("set timezone='UTC'")
  return client
}

async function originalBundle(args) {
  const file = path.resolve(args['original-before-image'])
  const raw = await readFile(file, 'utf8')
  const checksumFile = `${file}.sha256`
  const recorded = (await readFile(checksumFile, 'ascii')).trim().split(/\s+/)[0]
  assert(sha256(raw) === recorded, 'Original before-image checksum does not match')
  assert(
    recorded === FROZEN.originalBundleChecksum,
    'Original before-image is not the frozen bundle',
  )
  const bundle = JSON.parse(raw)
  assert(bundle.version === 3, 'Only the reviewed version-3 incident bundle is accepted')
  assert(bundle.plan?.businessDate === FROZEN.businessDate, 'Original bundle business date drifted')
  const device = bundle.rows?.counter_devices?.[0]
  assert(device?.label === FROZEN.oldLabel, 'Original device label is not the reviewed old label')
  const incidentBills = bundle.rows.bills.filter((bill) => bill.outlet_id === device.outlet_id)
  assert(incidentBills.length === FROZEN.incidentBills, 'Original incident bill set drifted')
  return {
    checksum: recorded,
    device,
    incidentBillIds: incidentBills.map((bill) => bill.id),
    incidentExpenseIds: bundle.rows.expenses.map((expense) => expense.id),
  }
}

async function drawerTerms(client, outletId, observation) {
  return (
    await client.query(
      `select
         (select count(*) from public.bills b
           join public.effective_bill_payments ep on ep.bill_id=b.id
          where b.outlet_id=$1 and b.status='settled' and ep.method='cash'
            and b.paid_at>$2 and b.paid_at<=$3)::int receipt_rows,
         coalesce((select sum(ep.amount_paise) from public.bills b
           join public.effective_bill_payments ep on ep.bill_id=b.id
          where b.outlet_id=$1 and b.status='settled' and ep.method='cash'
            and b.paid_at>$2 and b.paid_at<=$3),0)::bigint receipts,
         (select count(*) from public.effective_expenses e
          where e.outlet_id=$1 and e.is_cash
            and coalesce(e.occurred_at,e.created_at)>$2
            and coalesce(e.occurred_at,e.created_at)<=$3)::int expense_rows,
         coalesce((select sum(e.amount_paise) from public.effective_expenses e
          where e.outlet_id=$1 and e.is_cash
            and coalesce(e.occurred_at,e.created_at)>$2
            and coalesce(e.occurred_at,e.created_at)<=$3),0)::bigint expenses,
         (select count(*) from public.drawer_cash_out x
          where x.outlet_id=$1 and x.occurred_at>$2 and x.occurred_at<=$3
            and x.observation_id is distinct from $4)::int cash_out_rows,
         coalesce((select sum(x.amount_paise) from public.drawer_cash_out x
          where x.outlet_id=$1 and x.occurred_at>$2 and x.occurred_at<=$3
            and x.observation_id is distinct from $4),0)::bigint cash_out`,
      [outletId, observation.previous_at, observation.counted_at, observation.id],
    )
  ).rows[0]
}

function expectedDrawerPaise(observation, terms) {
  return (
    number(observation.opening_paise, 'opening') +
    number(terms.receipts, 'receipts') -
    number(terms.expenses, 'expenses') -
    number(terms.cash_out, 'cash out')
  )
}

async function compute(client, original, boundary) {
  const device = (
    await client.query(
      `select d.*,o.code outlet_code from public.counter_devices d
       join public.outlets o on o.id=d.outlet_id where d.id=$1`,
      [original.device.id],
    )
  ).rows[0]
  assert(device, 'Transferred device is missing')
  assert(device.label === FROZEN.currentLabel, 'Current device label drifted')
  assert(device.outlet_id !== original.device.outlet_id, 'Device is not transferred')

  const history = (
    await client.query(
      `select * from public.counter_device_history where device_id=$1 order by valid_from`,
      [device.id],
    )
  ).rows
  const event = (
    await client.query(
      `select greatest(
         coalesce((select max(paid_at) from public.bills where counter_device_id=$1),'-infinity'),
         coalesce((select max(ordered_at) from public.orders where device_id=$1),'-infinity'),
         coalesce((select max(opened_at) from public.counter_shifts where device_id=$1),'-infinity')
       ) last_event`,
      [device.id],
    )
  ).rows[0]
  assert(
    new Date(event.last_event) < new Date(boundary),
    'A device event reaches the proposed split',
  )

  const facts = (
    await client.query(
      `select min(at) first_at,max(at) last_at from (
         select paid_at at from public.bills where id=any($1::uuid[])
         union all
         select coalesce(occurred_at,created_at) from public.effective_expenses
          where id=any($2::uuid[])
       ) f`,
      [original.incidentBillIds, original.incidentExpenseIds],
    )
  ).rows[0]
  assert(facts.first_at && facts.last_at, 'Incident finance facts are incomplete')

  const observation = (
    await client.query(
      `with ordered as (
         select d.*,lag(d.counted_at) over(partition by d.outlet_id order by d.counted_at) previous_at
           from public.drawer_observations d where d.outlet_id=$1
       )
       select * from ordered
        where previous_at < $2 and counted_at >= $3
        order by counted_at limit 1`,
      [device.outlet_id, facts.first_at, facts.last_at],
    )
  ).rows[0]
  assert(observation, 'No one drawer observation contains every moved finance fact')
  assert(!observation.is_legacy_imprecise, 'Affected observation is legacy-imprecise')

  const terms = await drawerTerms(client, device.outlet_id, observation)
  const derivedExpected = expectedDrawerPaise(observation, terms)
  const derivedDifference = number(observation.counted_total_paise, 'counted') - derivedExpected

  const safe = {
    change: 'repair-kalyani-finance-and-device-history',
    originalBundleChecksum: original.checksum,
    businessDate: FROZEN.businessDate,
    boundary,
    device: {
      oldLabel: original.device.label,
      currentLabel: device.label,
      lastEventBeforeBoundary: new Date(event.last_event).toISOString(),
      historyRows: history.length,
    },
    observation: {
      countedPaise: number(observation.counted_total_paise, 'counted'),
      expectedPaise: number(observation.expected_paise, 'expected'),
      differencePaise: number(observation.difference_paise, 'difference'),
      derivedExpectedPaise: derivedExpected,
      derivedDifferencePaise: derivedDifference,
      deltaPaise: derivedExpected - number(observation.expected_paise, 'expected'),
      intervalComponents: {
        receiptRows: number(terms.receipt_rows, 'receipt rows'),
        receiptsPaise: number(terms.receipts, 'receipts'),
        expenseRows: number(terms.expense_rows, 'expense rows'),
        expensesPaise: number(terms.expenses, 'expenses'),
        cashOutRows: number(terms.cash_out_rows, 'cash-out rows'),
        cashOutPaise: number(terms.cash_out, 'cash out'),
      },
    },
  }
  return { safe, device, history, observation, derivedExpected, derivedDifference }
}

function assertBefore(plan) {
  assert(plan.history.length === 1, 'Expected one generic device-history row before split')
  const h = plan.history[0]
  assert(h.valid_to === null, 'Generic device-history row is not current')
  assert(
    h.outlet_id === plan.device.outlet_id && h.label === plan.device.label,
    'Generic history drifted',
  )
  assert(
    new Date(h.valid_from).toISOString() === new Date(plan.device.set_up_at).toISOString(),
    'Generic history does not start at setup',
  )
  const o = plan.safe.observation
  assert(o.countedPaise === FROZEN.countedPaise, 'Counted cash drifted')
  assert(o.expectedPaise === FROZEN.expectedBeforePaise, 'Stored expected cash drifted')
  assert(o.differencePaise === FROZEN.differenceBeforePaise, 'Stored difference drifted')
  assert(o.derivedExpectedPaise === FROZEN.expectedAfterPaise, 'Derived expected cash drifted')
  assert(o.derivedDifferencePaise === FROZEN.differenceAfterPaise, 'Derived difference drifted')
  assert(o.deltaPaise === FROZEN.expectedDeltaPaise, 'Expected drawer delta drifted')
}

async function loadFollowup(args) {
  const file = path.resolve(args['followup-bundle'])
  const raw = await readFile(file, 'utf8')
  const recorded = (await readFile(`${file}.sha256`, 'ascii')).trim().split(/\s+/)[0]
  assert(sha256(raw) === recorded, 'Follow-up bundle checksum does not match')
  return { ...JSON.parse(raw), checksum: recorded }
}

async function capture(args, client, original) {
  const root = path.resolve(args['out-dir'])
  const repo = path.resolve(process.cwd())
  const relativeToRepo = path.relative(repo, root)
  assert(
    relativeToRepo === '..' ||
      relativeToRepo.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToRepo),
    'Backup directory must be outside the repository',
  )
  const boundary = new Date().toISOString()
  const plan = await compute(client, original, boundary)
  assertBefore(plan)
  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    planDigest: sha256(canonical(plan.safe)),
    safe: plan.safe,
    rows: { observation: plan.observation, history: plan.history },
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

async function apply(args, client, original, bundle) {
  await client.query('begin')
  try {
    await client.query("set local lock_timeout='5s'")
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended('repair-kalyani-finance-device-history',0))",
    )
    await client.query('select 1 from public.counter_devices where id=$1 for update', [
      original.device.id,
    ])
    await client.query('select 1 from public.drawer_observations where id=$1 for update', [
      bundle.rows.observation.id,
    ])
    await client.query('select 1 from public.counter_device_history where id=$1 for update', [
      bundle.rows.history[0].id,
    ])
    const plan = await compute(client, original, bundle.safe.boundary)
    assertBefore(plan)
    assert(
      canonical(plan.observation) === canonical(bundle.rows.observation),
      'Locked drawer observation differs from the captured before-image',
    )
    assert(
      canonical(plan.history) === canonical(bundle.rows.history),
      'Locked device history differs from the captured before-image',
    )
    assert(
      sha256(canonical(plan.safe)) === bundle.planDigest,
      'Fresh plan digest differs from captured plan',
    )

    const currentHistory = plan.history[0]
    await client.query('update public.counter_device_history set valid_from=$1 where id=$2', [
      bundle.safe.boundary,
      currentHistory.id,
    ])
    await client.query(
      `insert into public.counter_device_history(device_id,outlet_id,label,valid_from,valid_to)
       values($1,$2,$3,$4,$5)`,
      [
        plan.device.id,
        original.device.outlet_id,
        original.device.label,
        plan.device.set_up_at,
        bundle.safe.boundary,
      ],
    )
    if (args['fail-after'] === 'history') {
      throw new Error('Injected scratch failure after history mutation')
    }
    await client.query(
      `update public.drawer_observations set expected_paise=$1,difference_paise=$2 where id=$3`,
      [plan.derivedExpected, plan.derivedDifference, plan.observation.id],
    )
    if (args['fail-after'] === 'observation') {
      throw new Error('Injected scratch failure after observation mutation')
    }
    await client.query('commit')
    return {
      mode: 'apply',
      planDigest: bundle.planDigest,
      expectedPaise: plan.derivedExpected,
      differencePaise: plan.derivedDifference,
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function verify(client, original, bundle) {
  const observation = (
    await client.query(
      `with ordered as (
         select d.*,lag(d.counted_at) over(partition by d.outlet_id order by d.counted_at) previous_at
           from public.drawer_observations d
       ) select * from ordered where id=$1`,
      [bundle.rows.observation.id],
    )
  ).rows[0]
  assert(
    number(observation.expected_paise, 'expected') === FROZEN.expectedAfterPaise,
    'Expected cash is not repaired',
  )
  assert(
    number(observation.difference_paise, 'difference') === FROZEN.differenceAfterPaise,
    'Difference is not repaired',
  )
  assert(
    number(observation.counted_total_paise, 'counted') === FROZEN.countedPaise,
    'Physical count changed',
  )
  const collection = (
    await client.query(
      `select count(*)::int rows,coalesce(sum(amount_paise),0)::bigint paise
         from public.drawer_cash_out where observation_id=$1 and kind='collection'`,
      [observation.id],
    )
  ).rows[0]
  assert(collection.rows === 1, 'The affected observation collection row changed')
  assert(
    number(collection.paise, 'collection') === FROZEN.collectedPaise,
    'The physical collection amount changed',
  )
  const history = (
    await client.query(
      'select * from public.counter_device_history where device_id=$1 order by valid_from',
      [original.device.id],
    )
  ).rows
  assert(history.length === 2, 'Transferred device does not have exactly two identity intervals')
  assert(
    history[0].outlet_id === original.device.outlet_id &&
      history[0].label === original.device.label,
    'Old identity interval is wrong',
  )
  assert(
    new Date(history[0].valid_to).toISOString() === new Date(bundle.safe.boundary).toISOString(),
    'Old identity boundary drifted',
  )
  assert(
    history[1].label === FROZEN.currentLabel && history[1].valid_to === null,
    'Current identity interval is wrong',
  )
  const currentDevice = (
    await client.query('select outlet_id,label from public.counter_devices where id=$1', [
      original.device.id,
    ])
  ).rows[0]
  assert(
    currentDevice?.label === FROZEN.currentLabel &&
      history[1].outlet_id === currentDevice.outlet_id,
    'Current device row and identity interval disagree',
  )
  const verifiedTerms = await drawerTerms(client, currentDevice.outlet_id, observation)
  const verifiedExpected = expectedDrawerPaise(observation, verifiedTerms)
  assert(verifiedExpected === FROZEN.expectedAfterPaise, 'Canonical drawer interval drifted')
  assert(
    number(observation.counted_total_paise, 'counted') - verifiedExpected ===
      FROZEN.differenceAfterPaise,
    'Canonical drawer interval no longer produces the stored difference',
  )
  const oldLabels = await client.query(
    `select count(*)::int rows,count(*) filter(where h.label=$2)::int correctly_labelled
       from public.bills b join lateral(
         select label from public.counter_device_history h where h.device_id=b.counter_device_id
          and h.valid_from<=b.paid_at and (h.valid_to is null or b.paid_at<h.valid_to)
          order by h.valid_from desc limit 1) h on true
      where b.counter_device_id=$1 and b.paid_at<$3`,
    [original.device.id, original.device.label, bundle.safe.boundary],
  )
  assert(
    oldLabels.rows[0].rows === oldLabels.rows[0].correctly_labelled,
    'An old bill resolves the wrong label',
  )
  const oldOrderLabels = await client.query(
    `select count(*)::int rows,count(*) filter(where h.label=$2)::int correctly_labelled
       from public.orders o join lateral(
         select label from public.counter_device_history h where h.device_id=o.device_id
          and h.valid_from<=o.ordered_at and (h.valid_to is null or o.ordered_at<h.valid_to)
          order by h.valid_from desc limit 1) h on true
      where o.device_id=$1 and o.ordered_at<$3`,
    [original.device.id, original.device.label, bundle.safe.boundary],
  )
  assert(
    oldOrderLabels.rows[0].rows === oldOrderLabels.rows[0].correctly_labelled,
    'An old order resolves the wrong label',
  )

  const finance = (
    await client.query(
      `with incident_bills as (
         select b.* from public.bills b where b.id=any($1::uuid[])
       ), incident_payments as (
         select ep.* from public.effective_bill_payments ep
          where ep.bill_id=any($1::uuid[])
       ), later_bills as (
         select b.* from public.bills b
          where b.outlet_id=$3 and b.business_date=date '2026-09-17'
       ), later_payments as (
         select ep.* from public.effective_bill_payments ep
          join later_bills b on b.id=ep.bill_id
       )
       select
         (select count(*) from incident_bills)::int incident_bills,
         (select coalesce(sum(total_paise),0) from incident_bills)::bigint incident_total,
         (select coalesce(sum(amount_paise),0) from incident_payments)::bigint incident_payments,
         (select coalesce(sum(amount_paise) filter(where method='cash'),0)
            from incident_payments)::bigint incident_cash,
         (select coalesce(sum(amount_paise) filter(where method='upi'),0)
            from incident_payments)::bigint incident_upi,
         (select count(*) from incident_bills where outlet_id<>$3)::int incident_wrong_outlet,
         (select count(*) from public.effective_expenses where id=any($2::uuid[]))::int incident_expenses,
         (select coalesce(sum(amount_paise),0) from public.effective_expenses
            where id=any($2::uuid[]))::bigint incident_expense_total,
         (select count(*) from public.effective_expenses
            where id=any($2::uuid[]) and (outlet_id<>$3 or not is_cash))::int incident_bad_expense,
         (select count(*) from later_bills)::int later_bills,
         (select coalesce(sum(total_paise),0) from later_bills)::bigint later_total,
         (select coalesce(sum(amount_paise),0) from later_payments)::bigint later_payments,
         (select coalesce(sum(amount_paise) filter(where method='cash'),0)
            from later_payments)::bigint later_cash,
         (select coalesce(sum(amount_paise) filter(where method='upi'),0)
            from later_payments)::bigint later_upi,
         (select min(bill_number) from later_bills)::int later_first,
         (select max(bill_number) from later_bills)::int later_last,
         (select count(*) from incident_bills b where b.total_paise<>(
            select coalesce(sum(p.amount_paise),0)
              from incident_payments p where p.bill_id=b.id))::int incident_mismatches,
         (select count(*) from later_bills b where b.total_paise<>(
            select coalesce(sum(p.amount_paise),0)
              from later_payments p where p.bill_id=b.id))::int later_mismatches`,
      [original.incidentBillIds, original.incidentExpenseIds, history[1].outlet_id],
    )
  ).rows[0]
  const expectedFinance = {
    incident_bills: 37,
    incident_total: 906000,
    incident_payments: 906000,
    incident_cash: 213000,
    incident_upi: 693000,
    incident_wrong_outlet: 0,
    incident_expenses: 5,
    incident_expense_total: 38000,
    incident_bad_expense: 0,
    later_bills: 35,
    later_total: 753000,
    later_payments: 753000,
    later_cash: 256000,
    later_upi: 497000,
    later_first: 1027,
    later_last: 1061,
    incident_mismatches: 0,
    later_mismatches: 0,
  }
  for (const [key, expected] of Object.entries(expectedFinance)) {
    assert(number(finance[key], key) === expected, `${key} finance proof drifted`)
  }
  return {
    mode: 'verify',
    planDigest: bundle.planDigest,
    observation: {
      countedPaise: FROZEN.countedPaise,
      expectedPaise: FROZEN.expectedAfterPaise,
      differencePaise: FROZEN.differenceAfterPaise,
      collectedPaise: FROZEN.collectedPaise,
    },
    finance: expectedFinance,
    historyIntervals: 2,
    historicalBillsLabelled: oldLabels.rows[0].rows,
    historicalOrdersLabelled: oldOrderLabels.rows[0].rows,
  }
}

async function rollback(client, original, bundle) {
  await client.query('begin')
  try {
    await client.query("set local lock_timeout='5s'")
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended('repair-kalyani-finance-device-history',0))",
    )
    await client.query('select 1 from public.counter_devices where id=$1 for update', [
      original.device.id,
    ])
    await client.query('select 1 from public.drawer_observations where id=$1 for update', [
      bundle.rows.observation.id,
    ])
    await client.query(
      'select 1 from public.counter_device_history where device_id=$1 for update',
      [original.device.id],
    )
    await verify(client, original, bundle)
    const later = await client.query(
      `select count(*)::int n from (
         select paid_at at from public.bills where counter_device_id=$1 and paid_at>=$2
         union all select ordered_at from public.orders where device_id=$1 and ordered_at>=$2
         union all select opened_at from public.counter_shifts where device_id=$1 and opened_at>=$2
       ) x`,
      [original.device.id, bundle.safe.boundary],
    )
    assert(later.rows[0].n === 0, 'Later device work makes automatic history rollback unsafe')
    const timestampTrigger = async () =>
      (
        await client.query(
          `select tgenabled from pg_trigger
            where tgrelid='public.drawer_observations'::regclass
              and tgname='drawer_observations_set_updated_at' and not tgisinternal`,
        )
      ).rows[0]?.tgenabled
    assert((await timestampTrigger()) === 'O', 'Drawer timestamp trigger is not enabled')
    await client.query(
      'alter table public.drawer_observations disable trigger drawer_observations_set_updated_at',
    )
    await client.query(
      `update public.drawer_observations
          set expected_paise=$1,difference_paise=$2,updated_at=$3 where id=$4`,
      [
        bundle.rows.observation.expected_paise,
        bundle.rows.observation.difference_paise,
        bundle.rows.observation.updated_at,
        bundle.rows.observation.id,
      ],
    )
    await client.query(
      'alter table public.drawer_observations enable trigger drawer_observations_set_updated_at',
    )
    assert((await timestampTrigger()) === 'O', 'Drawer timestamp trigger was not restored')
    await client.query(
      'delete from public.counter_device_history where device_id=$1 and valid_to=$2',
      [original.device.id, bundle.safe.boundary],
    )
    await client.query(
      'update public.counter_device_history set valid_from=$1 where device_id=$2 and valid_to is null',
      [bundle.rows.history[0].valid_from, original.device.id],
    )
    await client.query('commit')
    return { mode: 'rollback', planDigest: bundle.planDigest }
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const original = await originalBundle(args)
  const client = await connect(args)
  try {
    if (args.mode === 'plan') {
      await client.query('begin read only')
      const plan = await compute(client, original, new Date().toISOString())
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
      const result = await capture(args, client, original)
      await client.query('rollback')
      console.log(JSON.stringify(result, null, 2))
      return
    }
    const bundle = await loadFollowup(args)
    const result =
      args.mode === 'apply'
        ? await apply(args, client, original, bundle)
        : args.mode === 'verify'
          ? await verify(client, original, bundle)
          : await rollback(client, original, bundle)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`)
  process.exitCode = 1
})
