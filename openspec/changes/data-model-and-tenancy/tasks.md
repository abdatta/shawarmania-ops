# Tasks: data-model-and-tenancy

## 1. Foundations — enums, helpers, token hook

- [x] 1.1 Migration: enable required extensions; create all Postgres enums (`app_role`, `payment_method`, `pricing_mode`, `bill_status`, `movement_type`, `inventory_unit`, `expense_category`, `attendance_status`, `check_in_source`, `employment_status`, `alert_category`, `alert_priority`, `alert_status`)
- [x] 1.2 Migration: claim helpers `app_role()` and `app_outlet_id()` (stable, read `auth.jwt()`), and `security definer` status helpers `app_account_active()` and `app_device_ok()` with `set search_path = ''` and grants locked down
- [x] 1.3 Migration: `custom_access_token_hook(event jsonb)` injecting `app_role` and `app_outlet_id` from `profiles`; executable by `supabase_auth_admin` only; register the hook in `supabase/config.toml` and verify the stanza against CLI 2.109 with the stack running

## 2. Tenancy and identity tables

- [x] 2.1 Migration: `outlets` (code, name, address fields, coordinates, `geofence_radius_m` default 150, `business_day_cutover` default 04:00, `is_active`) with RLS: Super Admin full; scoped roles read their own outlet row only
- [x] 2.2 Migration: `profiles` (`id = auth.users.id`, role enum, nullable `outlet_id` for super_admin only via check, `is_active`) with RLS: self-read; Super Admin all; Franchise Admin and Biller read own-outlet profiles; no client writes
- [x] 2.3 Migration: `counter_devices` (`id = device auth user id`, outlet, label, enrolment/revocation timestamps, `last_seen_at`) with RLS: Super Admin all, Franchise Admin own outlet, device self-read; no client writes

## 3. Menu and customers

- [x] 3.1 Migration: `menu_categories` and `menu_items` (price in paise, veg flag, availability, soft delete, `updated_at` trigger) with RLS: Super Admin read all + write; Franchise Admin own outlet write; Biller own outlet read; Employee none
- [x] 3.2 Migration: `customers` (per-outlet, aggregates as plain columns for now) with RLS: Super Admin read, Franchise Admin and Biller own-outlet read; no client writes yet (maintenance lands with billing-live)

## 4. Billing tables and the write contract

- [x] 4.1 Migration: `shifts` (device, biller profile, business date, opened/closed) with RLS: device opens/closes own shifts on own outlet; Franchise Admin and Super Admin read; device reads own
- [x] 4.2 Migration: `bills` (client-UUID primary key, all documented columns, `unique (outlet_id, bill_number)`, arithmetic CHECK `total = subtotal − discount + tax`, non-negative money CHECKs, v1 CHECK `pricing_mode = 'no_tax' and tax_paise = 0`) with RLS: Biller inserts on own outlet/device only (device unrevoked, account active); Franchise Admin reads own outlet; Super Admin reads all; Biller reads bills of open shifts on own device; no client deletes
- [x] 4.3 Migration: `bill_items` (snapshot columns, `line_total = unit_price × quantity` CHECK, nullable advisory `menu_item_id`) with RLS scoped through the parent bill; immutable once written
- [x] 4.4 Migration: `bill_number_counters` (one row per outlet, RLS deny-all to clients) and the `before insert` trigger allocating `bill_number` via `update … returning`, overriding any client-supplied value
- [x] 4.5 Migration: append-only guards — trigger allowing only the `settled → void` transition touching only void columns, role-gated to Franchise Admin (own outlet) and Super Admin; delete denied; `bill_items` update/delete denied
- [x] 4.6 Migration: business-date validation trigger — reject a bill (and shift, and attendance row) whose `business_date` contradicts `created_at` shifted to Asia/Kolkata under the outlet's cutover

## 5. Inventory, expenses, employees, attendance

- [x] 5.1 Migration: `inventory_items` (numeric quantity, paise costs, threshold, soft delete) and `inventory_movements` (signed delta, movement enum, note, business date) with RLS: Franchise Admin own outlet write, Super Admin read all
- [x] 5.2 Migration: inventory ledger enforcement — movements append-only (trigger rejects update/delete), `current_quantity` maintained by `security definer` trigger, direct client writes to `current_quantity` blocked via column-scoped grants
- [x] 5.3 Migration: `expenses` (category enum, paise, business date, recorded_by) with RLS: Franchise Admin own outlet insert + read, Super Admin read all; no client update/delete
- [x] 5.4 Migration: `employees` (roster fields, nullable unique `profile_id`, employment status enum) with RLS: Franchise Admin own outlet full, Super Admin all, Employee reads own row
- [x] 5.5 Migration: `attendance` (status enum, check-in/out evidence fields, override attribution, `unique (employee_id, business_date)`) with RLS: Employee reads/writes own rows only; counter device inserts with `check_in_source = 'counter_tablet'` for own outlet; Franchise Admin own outlet full; Super Admin read all

## 6. Cash and alerts

- [x] 6.1 Migration: `cash_withdrawals` with RLS: Franchise Admin own outlet insert + read; Super Admin read all
- [x] 6.2 Migration: `daily_cash_records` (`unique (outlet_id, business_date)`, both arithmetic CHECK constraints) with RLS read-only for Franchise Admin (own outlet) and Super Admin; no client insert/update path
- [x] 6.3 Migration: `close_business_day(outlet_id, business_date, opening_cash_paise, actual_closing_paise, notes)` — `security definer`, asserts caller is an active Franchise Admin of that outlet, computes cash sales / cash expenses / withdrawals server-side, writes the snapshot, rejects a duplicate close
- [x] 6.4 Migration: `alerts` and `alert_responses` with RLS per the capability matrix: Franchise Admin raises and reads own outlet's alerts and responses; Super Admin reads all, responds, and updates status

## 7. Seeds

- [x] 7.1 `supabase/seed.sql`: both real outlets (04:00 cutover, 150 m radius, clearly-marked placeholder coordinates), real 7-item menu in paise with categories and veg flags
- [x] 7.2 Seed synthetic auth users + profiles for every test persona: Super Admin, Franchise Admin ×2, counter device ×2, Employee ×2, plus one deactivated account and one revoked device; obviously fake names, phones, and local-only passwords
- [x] 7.3 Seed synthetic operational data for both outlets: employees, shifts, bills with items (exercising every payment method), inventory items and movements, expenses, withdrawals, attendance, one closed day per outlet, and an alert with a response

## 8. Isolation and integrity test suites

- [x] 8.1 pgTAP scaffolding: `supabase test db` wired up (pgTAP available; helper to set `role` + `request.jwt.claims` per persona); npm scripts `db:start`, `db:reset`, `db:types`, `test:db`, `test:rls`
- [x] 8.2 pgTAP: coverage enumeration test — classify every `public` table from the catalog (outlet-scoped / child-scoped / global), assert RLS is enabled on all, fail on any unclassified or uncovered table
- [x] 8.3 pgTAP: cross-outlet isolation matrix — for every outlet-scoped table and each scoped role: outlet-A session reads zero outlet-B rows, cross-outlet insert/update rejected (including explicit `outlet_id` payloads), Super Admin reads across
- [x] 8.4 pgTAP: status immediacy — deactivated account and revoked device blocked with otherwise-valid claims; Employee reads only own attendance; Biller reads only open-shift bills on own device
- [x] 8.5 pgTAP: write-contract cases — bill number allocation (sequential, client value overridden, no gap after failed duplicate), append-only bills (`settled → void` only, role-gated), immutable bill items, totals CHECKs, business-date validation, movements append-only, `current_quantity = sum(deltas)`, direct cache write blocked, `close_business_day` (computes correct figures, duplicate close rejected, wrong role rejected, arithmetic CHECKs hold)
- [x] 8.6 REST probes (Vitest, `test:rls`, excluded from plain `npm test`): sign in each seeded persona through GoTrue, decode the real JWT and assert claims present; hand-crafted PostgREST reads with explicit other-outlet filters return zero rows; hand-crafted cross-outlet writes rejected; deactivated account and revoked device blocked over REST

## 9. Types, client wiring, CI

- [x] 9.1 Generate `src/data-access/database.types.ts` (`npx supabase gen types typescript --local`), commit it, and type `getSupabaseClient()` as `SupabaseClient<Database>`
- [x] 9.2 CI: new `db` job — setup-cli, `supabase start`, `supabase test db`, `test:rls`, and a types-drift check (regenerate and fail on diff)
- [x] 9.3 Full local gate: `npm test`, `npm run lint`, `npm run typecheck`, `npm run test:db`, `npm run test:rls` all green; `supabase db reset` applies every migration and seed cleanly from scratch

## 10. Phase gate

- [x] 10.1 PHASE GATE (ROADMAP #2): isolation suite passes for **every** outlet-scoped table; a Franchise Admin session provably cannot read the other outlet's rows even with a hand-crafted request; Kalyani and Kanchrapara seeded; TypeScript types generated
