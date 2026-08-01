## Context

The schema already anticipates machine Auth users in `counter_devices`, but the
current real session path assumes every Auth user owns a profile and assignment.
Seed tablets therefore masquerade as people. The demo counter opens shifts with
a shared PIN, which provides weaker attribution than the owner's chosen normal-
credential flow and would expose an FA/SA personal token on a shared tablet.

Launch now targets one active tablet at each outlet. It still needs a durable
local acknowledgement boundary so a request failure after taking money cannot
lose the command. Prolonged offline startup and multiple active tablets are
explicit later changes.

## Goals / Non-Goals

**Goals:**

- Separate machine identity from people, profiles, and assignments.
- Turn a verified eligible person's credentials into a daily billing grant
  without retaining their personal session on the tablet.
- Make Biller a single assignment that includes Employee attendance behavior.
- Enforce one active device per outlet and immediate revocation in Postgres.
- Provide a versioned device-local store that durably accepts commands before UI success.

**Non-Goals:**

- Sending real billing commands or making billing live.
- More than one active device per outlet.
- Starting/resuming work while the backend is already unreachable.
- Tablet attendance, inactivity auto-lock, or emergency personal-device billing.

## Decisions

### A device is a machine principal, never a synthetic person

The machine Auth user maps only to `counter_devices.id`. Device session loading
checks that row and its `revoked_at` value before attempting the human profile
path. It receives no profile or assignment row.

Keeping synthetic Biller people was rejected because profiles and assignments
are the durable people/authority model, and it lets machine credentials inherit
human behavior accidentally.

### Enrollment replaces rather than coexists with the personal session

An FA or SA invokes a privileged enrollment function from the current tablet.
The function re-derives caller authority, enforces one active device for the
outlet, creates the machine Auth identity and device row atomically as far as
the external Auth boundary permits, and returns the one-time material needed to
establish the machine session. The client then removes the personal session and
reloads into Counter shell; failure leaves the admin session intact and no
half-enrolled active device.

A local “registered” flag without a server credential was rejected because it
would be a UI preference, not a security boundary.

### Human credentials create a server row, not a retained human session

Counter login uses an isolated, non-persisting Auth client. After provider
verification it presents the short-lived human token together with the machine
session to a privileged function. That function validates current profile,
assignment hierarchy, device/outlet, and cutover, then creates the operator
grant/shift row. Human access and refresh tokens are discarded immediately;
normal counter reads/writes continue under the machine principal and reference
the grant row.

Minting a custom role-bearing JWT was rejected because authority does not belong
in tokens. Replacing the machine session with the FA/SA session was rejected
because hidden navigation cannot stop a stolen admin token calling privileged APIs.

### Eligibility is a role hierarchy, not a second assignment

At an outlet, `biller` satisfies Employee attendance capability plus counter
eligibility. The outlet's FA and any SA are counter-eligible without becoming
Billers or staff. An Employee is promoted by changing their one assignment to
`biller`; no person receives two assignments at one outlet.

### The grant expires at cutover; the device does not

The grant stores outlet, device, operator, opened time, explicit business date,
and expiry derived from that outlet's next cutover. New commands require the
grant to be live at their client creation time. At cutoff the UI closes the
working session and online credential verification is required again. Pending
commands retain their historical grant reference and may drain later.

An automatic same-operator rollover was rejected because it defeats daily
reauthentication. Revoking registration at every cutoff was rejected because
registration describes the physical tablet, not the person using it that day.

### One active device is a database invariant for launch

A partial unique constraint permits at most one `counter_devices` row with no
revocation for each outlet. Replacing a device first revokes the old one; later
multi-device work can deliberately remove this constraint without changing bill
number or idempotency contracts.

### IndexedDB is the local acknowledgement boundary

Dexie stores versioned immutable operation envelopes by client UUID, device,
grant, type, created time, payload version, and canonical payload hash. A local
transaction must commit before a screen reports acceptance or clears input. If
it fails, the form stays intact. Queue rows survive human logout, device-session
refresh, reload, and browser restart; logging never includes payload contents.

The network response cannot be the acknowledgement boundary because a received
payment could be lost during an outage. In-memory state was rejected because the
current demo's synchronous Map behavior does not survive process death.

### One page drains, and revocation has a separate recovery authority

Web Locks elects a foreground drain leader, with a short IndexedDB lease fallback
where unavailable. `navigator.onLine` is only a wake-up hint; response categories
drive state. A revoked machine session cannot drain or read. An FA/SA physically
authenticating on that tablet may invoke an upload-only recovery function for
operations that prove a valid pre-revocation grant and creation time. Recovery
does not restore registration or enable new commands.

Service-worker Background Sync was rejected as a correctness dependency because
availability differs by browser. Allowing revoked device credentials to keep
writing was rejected because revocation would not be immediate.

## Risks / Trade-offs

- **Human credentials briefly exist in the counter process** → use a separate
  non-persisting client, never log inputs/tokens, discard tokens immediately,
  and test that ordinary admin APIs are unavailable afterward.
- **Auth user creation and Postgres enrollment cannot share one transaction** →
  privileged cleanup makes failed attempts inactive and retry-safe.
- **One-device constraint delays an easy spare counter** → retain concurrency-
  safe server contracts and document replacement/recovery; multi-device is tracked.
- **IndexedDB can be cleared or quota-exhausted** → fail before UI success,
  request persistence best-effort, expose storage failure, and keep accepted
  queue records small. Rich quota tooling remains deferred.
- **A recovered device contains PII in queued payloads later** → origin-scoped
  storage, no payload logging, explicit admin authentication, and deletion only
  after acknowledged server acceptance or audited discard.

## Migration Plan

1. Add device/grant invariants and privileged enrollment/grant/recovery functions.
2. Remove synthetic device profiles/assignments from seed and adapt session loading.
3. Add Biller hierarchy helpers and migrate no human data beyond interpreting
   existing Biller assignments as Employee-capable.
4. Add Counter/Devices surfaces and local operation store behind non-live gates.
5. Enroll synthetic test devices through the real function and run auth/RLS tests.

Rollback revokes newly enrolled devices, restores the prior gates, and removes
empty grant rows. Do not roll back by recreating fake people after real device
credentials have been issued; rotate/re-enroll those devices instead.

## Open Questions

None.
