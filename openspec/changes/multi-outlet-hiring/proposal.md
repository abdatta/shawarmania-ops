# Proposal: multi-outlet-hiring

> **Model**: GPT-5.6 Sol · **Wave**: D · **Depends on**: #4, #16, #22 · **Gate**: an admin creates a person working at two outlets in **one action** and hands over **one code that activates**; the code is issued after every assignment exists, so nothing supersedes it; granting or ending an assignment for a person with an unredeemed code visibly reissues instead of silently killing it; a Franchise Admin managing exactly one outlet sees today's form unchanged; a hand-crafted provision naming an outlet outside the caller's authority is refused; and the four-role demo walkthrough still walks.

## Why

Creating a person places them at exactly one outlet. A day-one multi-outlet hire
therefore takes two acts — create at outlet A, then "Assign to an outlet" for
outlet B — and the second act springs a trap: the `supersede_invites_on_reassignment`
trigger fires on any assignment insert or end, invalidating the activation code
the admin was shown moments earlier. Nothing warns. The AssignSheet even
reassures — "They keep everything they already have" — which is true of
assignments and false of the code. The person fails to activate, and someone
diagnoses it after the fact. The natural flow, performed in the natural order,
produces a dead credential.

The owner decided (2026-07-30): the create form gains an **outlet multi-select**
— one role, several outlets, one act, one code issued after all assignments
exist so the trigger never fires. Mixed roles (managing one outlet, working at
another) stay a later grant from the People surface, which keeps the form as
simple as it is today for the overwhelmingly common single-outlet hire.

## Orientation — read this first; the driver of this change has no prior context

**The app.** A multi-outlet cash-counter and outlet-management PWA for
Shawarmania, a shawarma franchise. React 19 + Vite + Tailwind on the front,
Supabase (Postgres + RLS + Edge Functions) behind it, TypeScript throughout,
deployed as an installable PWA. Attendance is live in production; billing,
expenses, cash and the owner console run demo-gated against mock adapters.

**The contract.** Read [`AGENTS.md`](../../../AGENTS.md) before touching
anything — it is the single agent contract for this repo and applies to any
agent, Codex included. The two rules that bite hardest: **outlet isolation is
enforced in the database, not the UI** (every refusal this proposal describes
must hold against a hand-crafted request, not just a disabled control), and
**money is integer paise, never floats** (not touched here, but inviolable).

**The workflow.** No code change without this change folder. Expand this seed
into `design.md`, `tasks.md` and spec deltas, implement, then archive — the
archive step merges the spec deltas into `openspec/specs/` and updates every
affected page in `docs/` in the same change. Run `npm run roadmap:sync` after
lifecycle transitions so the roadmap status cells stay derived. Verify against
what CI actually runs (`.github/workflows/`), not a remembered checklist:
`npm run typecheck`, `lint`, `test`, `test:rls`, `test:db`, `test:e2e`,
`test:e2e:auth`, `build`.

**The people model** (as restated by changes #21 and #22, both archived
2026-07-29):

- `profiles` — one row per person; carries `full_name`, `phone`, `is_active`,
  `role_title`. **No role or outlet columns** — those died in #22.
- `assignments` — person × role × outlet, `ended_on IS NULL` means live.
  Partial unique indexes guarantee at most one live assignment per
  person-outlet pair and exactly one live Super Admin owner. Authority is
  derived from these rows by security-definer membership helpers
  (`app_has_role_at`, `app_outlets_for`, `app_is_owner`); **nothing
  authority-bearing lives in the token**.
- `account_invites` — hashed one-time activation codes (the person activates
  via a link, #16). The `supersede_invites_on_reassignment` trigger on
  `assignments` (migration `20260729000004_multi_outlet_people.sql`)
  invalidates a person's unredeemed codes on any assignment insert *or* end.
  That semantics is sound — a code handed over as "you're an Employee at
  Kalyani" must never silently redeem into broader authority than existed when
  it was issued — and this change **must not weaken it**.

**The privileged path.** `supabase/functions/admin-accounts/index.ts` is the
Edge Function all account administration goes through; the database enforces
the identical rule underneath, so the function is the legible refusal, not the
boundary. Relevant actions: `provision` (create person — today: auth user →
profile → **one** assignment → code via the `issue_account_invite` RPC, with
manual rollback via `deleteUser` on any failure), `assign`, `end-assignment`,
`reissue`. Authority judgments live in
`supabase/functions/_shared/authority.ts` (`mayProvision`, `mayAssign`,
`mayManage`): a Super Admin provisions anywhere; a Franchise Admin only at
outlets they manage, only Biller and Employee, and only when every outlet the
target is assigned to is one they manage.

**The UI.** `src/features/accounts/accounts-surface.tsx` is the People
surface: the create form ("Create and issue a code"), the `AssignSheet`
(grant at another outlet), the `EndAssignmentSheet`, and the
`IssuedCodePanel` that shows a freshly issued code. Data access goes through
the adapter seam (`src/data-access/adapters.ts`): the Supabase adapter
(`src/data-access/supabase-adapters/accounts.ts`) and the mock adapter
(`src/data-access/mock/accounts.ts`) must stay in step — mocks are typed from
the generated schema types (`npm run db:types`), so a mock that drifts fails
to compile. Demo mode never writes to Supabase.

## Scope

**One act, several outlets.** The `provision` action accepts a set of outlets
alongside the single role. Every outlet is validated against the caller's
authority before anything is written; then account, all N assignments, and
finally the code, in that order, all-or-nothing (rollback via `deleteUser`
exactly as today). Because the code is issued after the last assignment
exists, the supersede trigger has nothing to kill. A request naming Super
Admin *and* outlets stays contradictory and refused — the owner role remains
outlet-less and singular.

**The form stays the form.** Role remains a single select. The outlet control
becomes a multi-select **only for callers with authority over more than one
outlet**: a Franchise Admin managing exactly one outlet sees today's
pre-selected single outlet, unchanged. Not a native `<select multiple>` — a
checkbox list or chip set in the design-system idiom, usable on a phone. The
mock adapter mirrors the new shape.

**Codes survive later grants.** `assign` and `end-assignment` against a person
holding an unredeemed invite must surface that fact and reissue in the same
act — the admin sees the new code (the existing `IssuedCodePanel`), not a
silent invalidation discovered at activation. The AssignSheet's "they keep
everything they already have" copy is corrected. This path becomes rare once
day-one hires bundle, but it does not vanish.

**Spec deltas** to `openspec/specs/identity-and-access/spec.md`: the creation
requirement ("an admin submits a name, email, role, and outlet"; "one create
action yields an account, a live assignment at that outlet, and a one-time
activation code") generalises to one or more outlets with an assignment at
each; the reassignment-invalidates-codes requirement gains the visible
reissue-in-the-same-act behaviour.

## Non-goals

- **No per-outlet roles at create.** One role across the selected outlets;
  the mixed-role person is a later grant from People (owner decision,
  2026-07-30 — keeps the form single-role simple).
- **No weakening of the supersede trigger.** The fix is issue-after-assign
  and visible reissue, never letting a code outlive an authority change.
- **No bulk hiring** — no CSV import, no creating several people at once.
- The AssignSheet and EndAssignmentSheet remain the tools for lifecycle
  changes; this change does not fold them into the create form.

## Design questions to settle during `/opsx:propose`

- **Biller at several outlets**: the model permits it; a physical counter
  tablet does not. Constrain the form, or leave reality to #9's device
  enrolment? Record the decision either way.
- Whether the later-grant reissue is warn-then-confirm or automatic with the
  code panel re-shown — the owner leans toward whichever reads simplest.
- Whether `provision` keeps accepting the old single-`outletId` shape or all
  callers migrate in the same deploy (adapters live in this repo; likely just
  migrate).
- The exact multi-select control, within the design system and the phone
  viewport.

## Docs to update before archiving

`docs/SCREENS.md` (the People create flow), `docs/ROLES_AND_PERMISSIONS.md`
(provisioning authority across several outlets), `docs/OPERATIONS.md` (the
onboarding runbook loses the create-then-assign step for day-one multi-outlet
hires), `docs/LIMITATIONS.md` if the two-step trap is recorded there,
`docs/DATA_MODEL.md` only if the invite shape changes.
