# Security And Privacy

> Describes the intended posture. Nothing is built yet.

## Hard rules

- **The Supabase service-role key never reaches the browser.** It bypasses Row-Level Security entirely. Anything needing it runs in an Edge Function. There is no exception to this.
- **Never commit** `.env`, keys, real customer or employee data, or database dumps. The `.gitignore` covers the common shapes; that is a safety net, not permission to be careless.
- **Every outlet-scoped table ships an RLS policy in the same migration that creates it.** A table without a policy is a data leak, not a to-do item.
- **Never log** customer phone numbers, employee coordinates, or full bill contents.
- Access tokens live in memory and Supabase's managed storage. No hand-rolled token persistence.
- **The repository is public.** GitHub Pages hosts the app for free only from a public repo, so everything committed here is world-readable — including `docs/`. Assume anything you write down is published. This makes the "never commit" rule above load-bearing rather than tidy.

## What being a public repo does and does not expose

Worth stating plainly, because "the repo is public" sounds worse than it is and better than it is in different places.

**Not exposed**: no customer or employee data, no credentials. `.env` is gitignored, the service-role key exists only in Supabase's own secret storage, and seed data is synthetic by policy. The Supabase anon key will appear in the built bundle once the app talks to a backend — that is by design, and Row-Level Security is what protects the data behind it, not the key's secrecy.

**Exposed**: the business's own contact details in [Business Context](BUSINESS_CONTEXT.md) — outlet phone number, delivery line, FSSAI licence numbers. These are already publicly displayed by the business and required to be, so this is republishing public facts rather than leaking private ones. It does make them scrapable in one place, which is a different thing from being on a shop wall.

**Also exposed**: the security design itself — the RLS model, the auth posture, the threat model below. That is the intended trade. A tenancy model that only holds while nobody has read it was never holding.

If the repo is ever made private, note that Pages from a private repo needs a paid GitHub plan; see [Operations](OPERATIONS.md#moving-to-a-custom-domain-later).

## Tenancy is the primary security property

Almost every security question in this app reduces to "can this person see another outlet's data?", and the answer must be structural.

Enforcement is in Postgres, evaluated per row, driven by JWT claims. A frontend bug cannot leak another outlet's rows because the database will not return them. Route guards and conditional navigation are convenience, and are never the only thing standing between a Biller and the owner's cross-outlet view.

The isolation test suite asserts this for every outlet-scoped table (see [Testing](TESTING.md)). It exists because tenancy bugs are silent — nothing errors, a query just quietly returns more than it should.

## Personal data we hold

| Data | Whose | Why | Rules |
|---|---|---|---|
| Name, phone | Customer | Repeat-customer records, future digital receipts | Optional at billing. Never logged, never exported casually |
| Name, phone, address, salary | Employee | Roster and cost estimates | Visible to their outlet's admin and the owner. Never to other staff |
| Check-in coordinates, accuracy, distance | Employee | Attendance verification | Captured only at check-in and check-out. Never continuous |
| Bill contents | Customer | The transaction record | Retained; identifiable only where a customer was recorded |
| Hash of a caller's IP address | Whoever fails an activation | Bounding code guessing | Never the address itself, and only on failure. Pruned to the fifteen-minute window; readable by nobody, only counted |

**Two external lookups, and what they see.** The outlet form's address search queries `photon.komoot.io` (OpenStreetMap) and `api.postalpincode.in` (India Post). What leaves the browser is the text an admin types while looking up **their own shop's address**, and a PIN code. No customer record, no employee record, no bill and no session token is ever sent to either, and neither is contacted from any other screen. Both are keyless: there is no account, no API key to leak, and no billing relationship. Both are optional — a failure leaves a form that is typed by hand, which is what it was before.

**The address search never supplies an outlet's position.** The coordinates a geocoder returns are dropped at the adapter boundary, and the type the application carries has no field to hold them. `outlets.latitude/longitude` is read directly by the check-in trigger, so a map-search coordinate would arm the geofence against a rooftop centroid — and mark somebody absent while they stand at their own counter. Capturing a position on site is the only thing that surveys an outlet.

**Customer PII is collected at the counter, optionally, under time pressure.** Two consequences: the fields must never block settling a bill, and we should not treat the resulting data as reliable enough to build anything important on.

## Employee location monitoring

Attendance uses location, which makes this app a workplace-monitoring tool. That deserves explicit handling rather than being buried in a feature. This is live: real staff check in from their own phones.

- **Location is captured at two moments only** — check-in and check-out. There is no background tracking, no continuous location, and nothing that reports where someone is between those events. Do not add one without a deliberate decision recorded in a change proposal. This is enforceable by reading one file: `src/lib/geolocation.ts` is the only module in the app that touches `navigator.geolocation`, and a test asserts that a home screen sitting open reads no position.
- **The employee can see everything recorded about them.** Their own attendance history shows the same coordinates, distances, accuracy, flags, and override reasons a manager sees — including the approver's name, which is snapshot onto the row precisely so the person it concerns can read it. Both views render through the same components, so the two cannot drift apart. Asymmetric visibility in a monitoring feature is how it becomes something people resent.
- **A refused check-in is always appealable.** The manager override exists, and a refusal names the route to it rather than leaving someone stuck. Approving records who, when, and a reason that cannot be blank. *(The counter-tablet path is not built yet — until it is, the override is the only escape hatch, which costs an approval but never someone's record.)*
- **What is stored is the minimum that makes the decision reviewable**: coordinates, accuracy, computed distance, source. Nothing about the device, nothing about the network, no history between events.
- **The verdict is derived from the evidence, not asserted by the client.** The database recomputes every stored distance from the stored coordinates, so a row can never display a distance its own coordinates contradict, and the captured evidence is immutable once written. An employee cannot set their own attendance status, cannot erase the reading that judged them, and cannot approve themselves.

**The geofence reference point is surveyed, not guessed.** An outlet's position is captured from a device standing at its counter, with the accuracy of that fix stored beside it and a hard refusal above ±50 m. A fence built from a map search would judge every check-in against a point nobody has stood on. Only the Super Admin may set it: a Franchise Admin already holds the override, but an override is recorded with who and why, whereas moving the fence is silent and applies to everyone from then on. Those are not the same power, and the audited one is the one a manager should have.

Browser geolocation is spoofable — see [Limitations](LIMITATIONS.md). This matters here for a reason people often invert: because the signal is imperfect, it must never be treated as proof in a dispute about someone's pay. Storing the inputs beside the verdict is what makes a human judgement possible; the app's job is to present the evidence, not to settle the argument.

## Authentication posture

- Passwords are handled entirely by Supabase Auth. This repo never sees, stores, or transmits a password.
- **One-time provisioning codes are single-use, short-lived, and delivered out-of-band** (in practice, over WhatsApp by an admin, usually as a link that carries the code). They are not passwords and must not be reusable. As built: ten Crockford-base32 characters (50 bits), valid seven days, superseded the moment a replacement is issued, and cancelled by a role or outlet reassignment — so exactly one code per account is ever live. **A link is the same bearer credential as the code it carries**, with the same lifetime and the same single use; the expiry is what bounds its sitting in a chat thread.
- **A code is stored only as a hash, and that column is readable by nobody.** Not by a Franchise Admin, not by the Super Admin: the invite table's column grants omit it, so a request naming it — or `select *`, which expands to it — is refused by the database. The plaintext exists only in the response that issued it, which is why the screen says it cannot be looked up again.
- **The code is the lookup key, and the address is derived from it.** Redemption takes no email address. That is what removes the field a person can mistype, and it is also what makes it safe to *show* them the address the account will sign in with: anyone who can ask has already proven possession of a live, single-use code for that one account, so the only address they can learn is the one they already hold a code for. **If address-keyed lookup is ever reintroduced, that disclosure has to be reconsidered in the same breath.**
- **Redemption reveals nothing about which accounts exist.** Unknown code, expired, already used, superseded, deactivated account — one status, one body. The endpoint is unauthenticated by necessity and must never become a way to discover which addresses have accounts. Two refusals are deliberately specific because each describes the *request* rather than any account: a password below the minimum, and a rate-limited caller.
- **Guessing is bounded at the endpoint, not per invite.** A code that identifies its own invite gives a wrong guess no invite to charge, so the old per-invite attempt counter cannot advance and is retired in place. In its stead the redemption endpoint counts **failures only** — successful activations cost nothing — over a rolling fifteen minutes: 20 per client address, 500 across the endpoint. The per-address half is best-effort, because `x-forwarded-for` can be prepended to; **the global bound is the one that cannot be evaded**, and it is deliberately loose, since a tight global bound would itself be an attack on everyone's ability to activate. Attempt records hold a **hash** of the address and never the address itself.
- **A burst of failed activations is visible to the owner**, on People, above a threshold far below the hard limit — so somebody finds out well before anybody is refused. It is the only signal a targeted guessing attempt produces. No other role can read it.
- **Provisioning authority is re-derived from the caller's own token** inside the privileged function, never taken from the request. A Franchise Admin cannot mint an administrator, cannot reach another outlet, and cannot deactivate themselves.
- **Counter PINs are not a security boundary.** They select which biller a bill is attributed to. The device session is the credential — see [Roles And Permissions](ROLES_AND_PERMISSIONS.md). Do not extend a PIN to gate anything sensitive.
- **Device revocation is immediate**, enforced by a `revoked_at` check inside the policy rather than by waiting for a token to expire.
- Deactivating an account is likewise a policy-level `is_active` check, not just a claim change.

## Threat model — what actually worries us

Roughly in order of likelihood:

1. **A curious or disgruntled franchisee** trying to see another outlet's numbers. Mitigated by RLS, which is why RLS is structural rather than procedural.
2. **A lost or stolen counter tablet.** It holds a long-lived session. Mitigated by scoping it to one outlet and to billing surfaces only, immediate revocation, and `last_seen_at` making a missing device visible. Impact is bounded: one outlet's billing screen, never admin functions or the owner's view.
3. **A biller ringing bills under someone else's name.** Mitigated weakly by PINs, and properly by the fact that shifts and attribution are recorded and reviewable.
4. **Attendance gaming** via a spoofed location. Mitigated by storing the evidence for review, and by the counter-tablet path being available and stronger.
5. **Accidental PII exposure** through logs, exports, or an error report. Mitigated by not logging PII in the first place.

Not in the model at this scale: sophisticated external attackers, insider database access at the hosting provider, or supply-chain attacks on dependencies. These are real, but the practical controls at a two-outlet business are the boring ones — keep the service-role key out of the browser, keep RLS on, keep secrets out of git.

## Retention

No automated deletion in v1. Operational history is small and valuable — a year of bills at this volume is trivial data, and the owner will want year-over-year comparison.

Two things to revisit when the business grows: customer PII has no defined retention period, and attendance location data accumulates indefinitely. Both are noted in [Limitations](LIMITATIONS.md) rather than silently deferred.
