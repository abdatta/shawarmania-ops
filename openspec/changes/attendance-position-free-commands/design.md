## Context

`src/data-access/supabase-adapters/attendance.ts` builds each command's payload
as a plain object handed to `client.rpc(...)`. Two of those payloads state the
position like this:

```ts
p_lat: reading?.latitude as number,
```

With no reading that expression is `undefined`, and `JSON.stringify` omits keys
whose value is `undefined`. The request therefore arrives carrying four of its
seven arguments. `attendance_submit_attempt` and `attendance_approve_attempt`
declare no defaults for the three that went missing, so PostgREST cannot resolve
the function at all and answers `PGRST202`. Reproduced against production, the
same call over a direct connection says it plainly:

```
function public.attendance_submit_attempt(p_attempt_id => uuid, p_outlet_id => uuid,
  p_business_date => date, p_attempted_at => timestamp with time zone) does not exist
```

`toActionError` has no branch for that, so it falls to the catch-all, and the
person is told to try again in a moment — advice that can never work, for a
write that never happened.

The `as number` cast is what let this ship. It was written to satisfy the
generated `Args` type, which types `p_lat` as a required `number` because the
Postgres parameter carries no default. The cast silenced the one signal that
would have caught it.

Why every layer of the existing suite stayed green is worth stating, because it
decides where the new coverage goes. The component suites drive the **mock**
adapter, which accepts a null reading happily. The pgTAP suite calls the
functions from SQL, where a missing argument is a compile error nobody would
write. The Playwright walk drives demo mode, which never reaches Supabase. And
the one REST test that does pass `reading: null` asserts only that the call
rejects — which it did, for the wrong reason.

## Goals / Non-Goals

**Goals:**

- A check-in with no position is recorded at the named outlet and waits for that
  outlet's manager.
- An approval with no position is recorded and treated as off-site.
- A command the backend cannot accept is reported as such, not offered as a
  retry.
- The position-free path of both commands is proved against a real Postgres over
  the transport the phone uses.
- The defect's shape is made unwritable, not merely corrected in the two places
  it currently appears.

**Non-Goals:**

- Any change to the geofence, the approval rules, or what an unlocated day
  counts as before a manager settles it.
- Any migration. The Postgres signatures are right.
- Queueing or retrying a command the backend refused.
- Changing what the screens show or when they ask which outlet.

## Decisions

### D1: Fix the caller, not the signatures

The adapter will send `null` explicitly. The alternative was to give
`p_lat`, `p_lng` and `p_accuracy_m` a `DEFAULT NULL` in Postgres, which also
makes today's payload resolvable.

Rejected, for three reasons. A required parameter is the database stating that
this fact must be stated, and with a default an argument a future caller forgets
records an unlocated arrival silently instead of failing loudly — the same class
of bug, moved somewhere harder to see. Nothing about the schema is wrong, so a
migration would spend production risk on a client defect. And the paired-
coordinate guard inside the function (`(p_lat is null) <> (p_lng is null)`) only
means something while both arguments are always present to be compared.

### D2: One expression per command shape, so the pattern cannot recur

Each command builds its position arguments through a small named helper rather
than inline optional chaining. Two helpers, because the two commands name their
columns differently (`p_lat` versus `p_manager_lat`), and a single generic one
keyed by prefix would be less readable than the duplication it saves.

`correct` keeps its conditional spread: its parameters do carry `DEFAULT NULL`,
and omitting them is how it says "this command does not accept a position at
all", which the time-correction rule depends on.

The `as number` casts do not survive. Where a cast is still needed to satisfy
the generated `Args` type, it is applied to an expression that is provably
`number | null` and never `undefined`, with the reason recorded beside it. The
generated types are not edited: an argument's nullability is not something the
generator expresses, and hand-editing generated output is a lie that outlives
its author.

### D3: An unacceptable command is its own error code

`AttendanceActionError` gains one code for a command the backend could not
accept — a request whose shape no function matches. `toActionError` maps
PostgREST's `PGRST202` and Postgres's `42883` to it, since the same fault
reaches the adapter under either code depending on the transport in front of it.
Its copy tells the person the action could not be sent and asks them to report
it, which is true, and does not invite a retry, which would not be.

Both call sites already render `AttendanceActionError.message` and fall back to
the generic sentence for anything else, so no screen changes. The catch-all
stays exactly where it is, for the faults nobody has classified yet.

### D4: Coverage belongs at the transport, in the adapter suite

The new cases go in `supabase/tests/rest/attendance-adapter.test.ts`, which runs
the real adapter against the real stack — the only layer that could have caught
this. A component test with the mock adapter proves nothing here, which is the
lesson of the bug rather than an aside.

The persona is the seeded Kalyani griller, who holds one live Employee
assignment there and no attendance row for today; the two-outlet person already
has today's row written by the command-races suite, and one person holds one row
a day. The transport does not know how many outlets the chooser had — the
payload is identical — so the multi-outlet question stays covered where it is
decided, in the component suite, and the REST case proves what only it can: that
a position-free command is accepted by a real database.

The existing self-approval test, which passes `reading: null` and asserts only
that it rejects, is tightened to assert the policy refusal by code. It has been
passing for the wrong reason, and would go on passing if this bug returned.

### D5: Nothing tenancy, money or offline touches

No policy, no `grant`, no table and no column changes, so the isolation suites
gain no cases and need none: every actor and boundary is exactly as before, and
the same policies decide these two commands as decided them yesterday. No money
arithmetic is involved. No offline semantics change — attendance has never been
queued, and a command that cannot be sent is reported rather than stored.

## Risks / Trade-offs

**An unlocated check-in becomes possible where operators had grown used to it
failing** → It is what the spec has required since #26 and #29, and it is
recorded as absent with unknown coordinates, so it still counts as nothing until
a manager approves it with a written reason. The fix widens no authority.

**A hand-crafted `PGRST202` could now be reported as a fault rather than a
refusal** → That is the intent: an unresolvable command is a defect in the app,
whoever provoked it, and the copy asks for a report rather than granting
anything.

**The same defect may exist in adapters this change does not read** → Out of
scope here and worth a sweep of its own; the pattern to grep for is a cast on an
optional chain inside an `rpc` payload. It goes to `openspec/todos/` rather than
into this change.
