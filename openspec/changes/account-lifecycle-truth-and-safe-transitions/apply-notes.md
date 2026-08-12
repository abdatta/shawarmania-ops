# Apply Notes

This is the implementation ledger for the apply turn. It records the frozen
cross-layer contract, the pre-implementation security matrix, and exclusive
writer ownership so later work does not reinterpret the change artifacts.

## Pre-flight

- Lead: GPT-5.6 Sol, high reasoning.
- Schema: `spec-driven`; apply state was `ready`, 0/44 tasks complete.
- Worktree at start: clean, `main` one commit ahead of `origin/main`; there was
  no uncommitted user diff to preserve.
- Read before implementation: the apply skill, every resolved change artifact,
  `AGENTS.md`, the complete living `identity-and-access` and `app-shell` specs,
  archived designs for auth/roles, activation, username/private email, staff as
  accounts, multi-outlet people/hiring, unreachable-auth classification, and
  shared root/session resolution, plus the current todo index and account
  lifecycle todos.

## Frozen typed contract

The public adapter contract uses these concepts (names may be imported from the
shared adapter module, but their meaning and wire values do not change):

```ts
type AccountInvitePurpose = 'activation' | 'password_reset'

type AccountLifecycle =
  | { kind: 'needs_setup' }
  | { kind: 'setup_link_issued'; expiresAt: string }
  | { kind: 'active' }
  | { kind: 'password_reset_issued'; expiresAt: string }
  | { kind: 'deactivated' }

interface IntendedAssignment {
  assignmentId: string | null
  outletId: string | null
  role: AppRole
  startedOn: string
}

interface EditAccountCommand {
  profileId: string
  expectedStateFingerprint: string
  fullName: string
  phone: string | null
  roleTitle: string | null
  accountEmail: string | null
  assignments: IntendedAssignment[]
}

interface AssignmentSetResult {
  profileId: string
  assignments: Assignment[]
  stateFingerprint: string
  replacementHandover: AccountHandover | null
}

interface AccountHandover {
  profileId: string
  username: string
  code: string
  expiresAt: string
  purpose: AccountInvitePurpose
}
```

`AccountSummary` additionally carries `hasSignedIn`, a live unexpired invite
with purpose/expiry or `null`, the derived `lifecycle`, and an opaque
`stateFingerprint`. The browser never receives provider aliases, raw Auth
metadata, invite hashes, or service credentials.

The edit command is a complete intended live assignment set. An existing row is
preserved only when `assignmentId`, outlet, role, and start date still agree.
Changing outlet or role ends the old row and inserts a new one. The ordinary
command refuses an empty set. `markAsLeft(profileId,
expectedStateFingerprint)` is the only command that ends every live assignment
and deactivates the account together.

The privileged wire failures are canonical:

- `401 { error: 'session_invalid' }`: bearer credential missing, malformed,
  expired, revoked, or rejected by Auth, including a deactivated human account.
- `403 { error: 'forbidden' }`: verified active human caller lacks authority.
- `409 { error: 'stale_edit' }`: the opaque current-state fingerprint changed.
- received backend failures remain server failures; no response remains a
  transport failure. Neither is translated to authentication or authorization.

Only a confirmed `session_invalid` emits the shared human-session invalidation
signal. `forbidden`, timeout, offline, fetch failure, and 5xx never clear local
credentials. Counter-device and demo providers neither emit nor consume it.

## Temporary compatibility during cutover

- Edge actions retained until frontend migration completes: `reissue`,
  `assign`, `end-assignment`, `set-active`, `set-username`,
  `set-account-email`, `provision`, and `identifiers`.
- Adapter methods retained only until all People and demo call sites move:
  `reissue`, `grantAssignment`, `endAssignment`, and `updateStaffFacts`.
- Username correction remains a separate credential action and preserves Auth
  user identity, password, sessions, assignments, and outstanding links.
- Direct `setActive` remains for Deactivate/Reactivate. It never changes
  assignments. It is not reused for Mark as left.

## Security acceptance matrix

| Caller / outcome | Required result |
| --- | --- |
| SA edits another ordinary or admin account | May replace the complete set across outlets/roles after stale-state, shape, email, and final-SA checks. |
| SA edits self | Refused as `forbidden`, including hand-crafted requests. |
| FA edits Employee/Biller wholly within managed outlets | May add, remove, transfer, and switch Employee/Biller only. |
| FA current or desired set contains unmanaged outlet | Whole request refused; no omitted row is interpreted as removable. |
| FA current or desired set contains FA/SA role | Whole request refused, including FA-on-FA and FA-on-SA. |
| Biller/Employee calls account command | Refused as `forbidden`. |
| Desired set duplicates an outlet or stacks Employee+Biller | Whole request refused. |
| Granting SA without normalized private email | Whole request refused. |
| Demoting SA | Private email retained. |
| Removing final live SA | Database refuses the complete transaction. |
| Any failed/stale edit | Profile, email, assignments, active state, and invites all remain unchanged. |
| Edit with live activation invite | Supersede activation only after final assignment set exists; return exactly one replacement activation handover. |
| Edit with live password-reset invite | Preserve it unchanged and return no handover. |
| Edit with no live invite | Create no unsolicited handover. |
| Issue for never-signed-in active account | Activation/setup purpose. |
| Issue for previously signed-in active account | Password-reset purpose. |
| Issue for inactive account | Refused until explicit reactivation. |
| Expired unused invite | Not live, not displayed as pending, and does not block fresh issuance. |
| Confirmed invalid human session | Clear credentials/resolved state; sign-in explains the session ended. |
| Deactivated human session | Clear credentials/resolved state; retain the specific deactivation reason. |
| Verified but unauthorized human request | Stay signed in; surface the refusal locally. |
| Offline/timeout/unanswered backend | Preserve session and shell; offer retry. |
| Counter device / demo | Existing independent lifecycle remains unchanged. |

## Initial reproduction ledger

Before production implementation, pin tests must demonstrate these current
failures:

1. an established account with an unused reissued invite is rendered as
   `Awaiting activation`;
2. the only-assignment End flow defaults account deactivation on, allowing an
   Employee-to-Biller transition to cut access;
3. an expired unused invite is included in the outstanding map;
4. after reset redemption, an accepted password can navigate while a stale
   local human session still backs protected UI/action handling.

Each pin is later proved by reverting its corresponding fix in isolation and
rerunning the targeted test.

## Exclusive file ownership and persistent roster

| Owner | Persistent workstream | Exclusive files while active |
| --- | --- | --- |
| Lead | Contracts, SQL migration/RPCs, shared authority/failure taxonomy, adapters/session integration, final review/verification | `src/data-access/adapters.ts`, `src/data-access/auth.ts`, `src/data-access/supabase-adapters/accounts.ts`, `src/auth/**`, `supabase/migrations/<new>`, `supabase/functions/_shared/authority.ts`, database tests, tasks/notes/roadmap |
| `edge_plumbing` | Frozen Edge request/response actions and real-HTTP account tests | `supabase/functions/admin-accounts/index.ts`, `supabase/tests/rest/account-flows.test.ts` |
| `people_editor` | Task-based People menu/editor and focused UI tests | `src/features/accounts/accounts-surface.tsx`, `src/features/accounts/accounts-surface.test.tsx` except the handover component import seam |
| `handover` | Reusable purpose-aware handover component and its isolated tests | new `src/features/accounts/account-handover.tsx` and `account-handover.test.tsx` only |
| `fixtures_docs` | Deferred until behavior stabilizes; demo fixtures/mock adapter and durable prose only, never concurrently with lead adapter edits | `src/data-access/mock/accounts.ts`, relevant fixtures, named docs/todo files when assigned by follow-up |

The lead inspects the live roster before every spawn. A workstream agent is
created once and later fixes return to that same identifier through follow-up
tasks. No two owners edit the same file group concurrently.

Initial persistent roster (created after a live-roster check before each spawn):

- `/root/edge_plumbing` — genuinely new, non-overlapping Edge/HTTP workstream.
- `/root/people_editor` — genuinely new, non-overlapping People UI workstream.
- `/root/handover` — genuinely new, isolated reusable component workstream.
