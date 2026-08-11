# RPC command-argument audit

This is the implementation evidence for `audit-rpc-command-arguments`. The
inventory was derived from a repository-wide `.rpc(` search, restricted to
production browser adapters and production Edge Functions for the production
count. Test callers were reviewed as coverage, not counted as production.

The search reconciles to **38 literal production call sites**: **21 browser**
and **17 Edge Function**, split into **10 reads** and **28 writes**. Those sites
name 37 functions because `report_counter_device_state` has two browser
callers. The billing command adapter also has one deliberate indirect transport
seam (`client.rpc.bind` followed by `invoke`) which maps eight command types to
eight functions; it does not contain a literal `.rpc(` and therefore is not
added to the design's 38-site count, but its shared argument envelope is audited
below.

## Classification method

Final signatures came from the reset local database, not migration text. The
audit queried `pg_proc` in `supabase_db_shawarmania-ops` with
`pg_get_function_arguments` and `pronargdefaults` for every function named
below. Parameters are classified as:

- **R** — required by the final signature and always present with a value;
- **N** — required by the final signature, legitimately nullable, and always
  present with a value or explicit `null`;
- **D** — optional because the final signature declares a default.

Across the 38 literal sites there are 133 parameter occurrences: **100 R, 13
N, and 20 D**. The browser subtotal is 52 R / 7 N / 12 D; the Edge Function
subtotal is 48 R / 6 N / 8 D.

## Browser adapter inventory

| # | Call site | Function | Kind | Final signature classification |
|---:|---|---|---|---|
| 1 | `accounts.ts:256` | `invite_failure_pressure` | read | D `p_window` |
| 2 | `billing-command.ts:82` | `billing_day_readiness` | read | R `p_outlet_id`, `p_business_date` |
| 3 | `attendance.ts:500` | `attendance_elsewhere` | read | R `p_outlets`, `p_business_date` |
| 4 | `attendance.ts:559` | `attendance_submit_attempt` | write | R `p_attempt_id`, `p_outlet_id`, `p_business_date`, `p_attempted_at`; N `p_lat`, `p_lng`, `p_accuracy_m`; D `p_expected_version` |
| 5 | `attendance.ts:578` | `attendance_record_manual` | write | R `p_attempt_id`, `p_decision_id`, `p_person_id`, `p_outlet_id`, `p_business_date`, `p_attempted_at` |
| 6 | `attendance.ts:611` | `attendance_approve_attempt` | write | R `p_decision_id`, `p_attendance_id`, `p_expected_attempt_id`, `p_expected_version`; N `p_reason`, `p_manager_lat`, `p_manager_lng`, `p_manager_accuracy_m` |
| 7 | `attendance.ts:632` | `attendance_deny_attempt` | write | R `p_decision_id`, `p_attendance_id`, `p_expected_attempt_id`, `p_expected_version`, `p_reason`; D `p_prevent_retry` |
| 8 | `attendance.ts:653` | `attendance_correct` | write | R `p_decision_id`, `p_attendance_id`, `p_expected_version`, `p_action`, `p_reason`; D `p_manager_lat`, `p_manager_lng`, `p_manager_accuracy_m`, `p_corrected_at` |
| 9 | `outlets.ts:160` | `outlet_reference_counts` | read | R `p_outlet` |
| 10 | `menu.ts:148` | `create_menu_item_with_category` | write | R `p_outlet_id`, `p_category_name`, `p_item_name`, `p_price_paise`; D `p_is_veg`, `p_description`, `p_sort_order` |
| 11 | `menu.ts:162` | `update_menu_item_with_category` | write | R `p_item_id`, `p_category_name`, `p_item_name`, `p_price_paise`, `p_is_veg`; D `p_description` |
| 12 | `menu.ts:199` | `retire_menu_item` | write | R `p_item_id` |
| 13 | `counter.ts:348` | `report_counter_device_state` | write | R `p_unsent` |
| 14 | `manual-ledger.ts:60` | `manual_ledger_people` | read | no arguments |
| 15 | `manual-ledger.ts:135` | `manual_ledger_counter_revenue` | read | R `p_outlet_id`, `p_from`, `p_to` |
| 16 | `billing.ts:525` | `report_counter_device_state` | write | R `p_unsent` |
| 17 | `expense-categories.ts:91` | `rename_expense_category` | write | R `p_from`, `p_to`, `p_rewrite_history` |
| 18 | `expense-categories.ts:101` | `merge_expense_category` | write | R `p_from`, `p_into` |
| 19 | `expense-categories.ts:110` | `retire_expense_category` | write | R `p_name` |
| 20 | `customers.ts:37` | `customer_lookup_by_phone` | read | R `p_phone` |
| 21 | `customers.ts:57` | `customer_create_or_get` | write | R `p_phone`; D `p_name` |

## Edge Function inventory

| # | Call site | Function | Kind | Final signature classification |
|---:|---|---|---|---|
| 22 | `redeem-invite/index.ts:73` | `preview_account_invite` | read | R `p_code_hash`; D `p_ip_hash` |
| 23 | `redeem-invite/index.ts:89` | `redeem_account_invite` | write | R `p_code_hash`, `p_username`; D `p_ip_hash` |
| 24 | `email-sign-in/index.ts:12` | `username_rollout_ready` | read | no arguments |
| 25 | `email-sign-in/index.ts:40` | `resolve_email_sign_in` | read | R `p_email`, `p_ip_hash`; D `p_window`, `p_per_ip`, `p_per_email`, `p_global` |
| 26 | `counter-setup/index.ts:75` | `redeem_counter_device_setup_code` | write | R `p_code_hash`, `p_device_id`; D `p_max_attempts` |
| 27 | `counter-devices/index.ts:102` | `cancel_counter_shift_request` | write | R `p_device_id` |
| 28 | `counter-devices/index.ts:115` | `request_counter_shift` | write | R `p_device_id`, `p_username`, `p_code_hash`, `p_valid_for` |
| 29 | `counter-devices/index.ts:144` | `issue_counter_device_setup_code` | write | R `p_outlet_id`, `p_issued_by`, `p_label`, `p_code_hash`, `p_valid_for` |
| 30 | `counter-devices/index.ts:164` | `remove_counter_device` | write | R `p_device_id`, `p_removed_by` |
| 31 | `counter-devices/index.ts:179` | `confirm_counter_shift` | write | R `p_person_id`, `p_request_id`, `p_code_hash`; D `p_max_attempts` |
| 32 | `counter-devices/index.ts:200` | `reject_counter_shift_request` | write | R `p_person_id`, `p_request_id` |
| 33 | `counter-devices/index.ts:212` | `end_counter_shift` | write | R `p_person_id`, `p_shift_id` |
| 34 | `admin-accounts/index.ts:44` | `issue_account_invite` | write | R `p_profile_id`, `p_issued_by`, `p_code_hash`, `p_valid_for` |
| 35 | `admin-accounts/index.ts:120` | `provision_account_with_invite` | write | R `p_profile_id`, `p_full_name`, `p_role`, `p_outlet_ids`, `p_issued_by`, `p_code_hash`, `p_valid_for`; N `p_phone`, `p_role_title`, `p_started_on`, `p_account_email` |
| 36 | `admin-accounts/index.ts:301` | `set_super_admin_account_email` | write | R `p_profile_id`, `p_email` |
| 37 | `admin-accounts/index.ts:338` | `grant_assignment_with_invite` | write | R `p_person_id`, `p_role`, `p_issued_by`, `p_code_hash`, `p_valid_for`; N `p_outlet_id`, `p_account_email` |
| 38 | `admin-accounts/index.ts:410` | `end_assignment_with_invite` | write | R `p_assignment_id`, `p_issued_by`, `p_code_hash`, `p_valid_for` |

## Serialization review

Every value produced by optional input, an optional chain, a conditional spread,
or a narrowing cast was inspected:

- Attendance submission and approval use `?? null` before their narrow casts,
  so all seven required-nullable facts survive JSON. The optional expected
  version is omitted only because SQL defaults it to null. Denial's optional
  retry flag defaults to false. Correction conditionally omits only four
  defaulted parameters.
- Menu creation conditionally omits only `p_description` and `p_sort_order`, and
  SQL also defaults `p_is_veg`; menu update sends required patch facts through
  explicit sentinels and conditionally omits only defaulted `p_description`.
  Customer creation conditionally omits only defaulted `p_name`.
- Account provisioning coalesces phone, role title, start date, and account email
  to explicit nulls before constructing an object that contains all four keys.
  Assignment construction does the same for outlet and account email. All
  optional request values used as required non-null parameters are rejected
  before the RPC call.
- Edge Function omissions are limited to declared rate-limit windows/counts and
  maximum-attempt parameters. Hashes, caller ids, device ids, usernames, and
  other required facts are present after their request validation.
- The indirect billing seam maps eight write commands to
  `create_billing_order`, `revise_billing_order`, `cancel_billing_order`,
  `pay_billing_order`, `pay_billing_now`, `void_billing_bill`,
  `manager_cancel_billing_order`, and `confirm_billing_end_of_day`. Their final
  signatures each declare defaults for all six envelope parameters, while
  `billingCommandRpcArguments` deliberately sends all six. A null shift and
  nested nullable customer facts survive JSON serialization.

## Result and coverage

**No new unsafe production caller was found.** The two attendance callers fixed
by `attendance-position-free-commands` remain the only live instances that had
allowed a required key to become `undefined`. Production code is therefore
unchanged.

The empty/unknown paths are pinned at both relevant boundaries:

- `src/data-access/supabase-adapters/attendance.test.ts` round-trips unlocated
  submission and approval arguments through `JSON.stringify`, including a null
  approval reason.
- `src/lib/billing-command.test.ts` round-trips the complete indirect billing
  envelope, including null shift and nested customer facts.
- `supabase/tests/rest/attendance-adapter.test.ts` successfully records and
  settles an unlocated attendance row over HTTP, then asserts the stored facts
  remain null.
- `supabase/tests/rest/account-flows.test.ts` provisions ordinary accounts with
  absent phone/title/start/email inputs and successfully grants both outlet and
  owner assignments, proving the Edge Function's explicit-null paths reach the
  intended database functions and persist the intended rows.

Targeted verification completed during apply:

- `npx vitest run src/data-access/supabase-adapters/attendance.test.ts src/lib/billing-command.test.ts`
  — 2 files and 10 tests passed.
- `npx vitest run --config vitest.rls.config.ts supabase/tests/rest/attendance-adapter.test.ts`
  — 1 file and 16 tests passed against the local stack.
- `npx vitest run --config vitest.rls.config.ts supabase/tests/rest/account-flows.test.ts`
  — 1 file and 43 tests passed against the local stack.
- Targeted Prettier check — all changed files matched repository style.

The broad database, RLS, and authenticated-browser gates are deliberately left
to the repository-wide verification pass: this evidence-only audit changed no
production caller, real-transport fixture, shared command path, migration, or
policy.
