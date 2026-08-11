# Design: updates-wait-for-a-safe-moment

## Context

`src/pwa/register-sw.ts` registers the worker at module scope from `main.tsx`,
checks once in `onRegisteredSW`, and on `onNeedRefresh` calls
`updateServiceWorker(false)` believing `false` means "skip waiting without
reloading". It does not. In vite-plugin-pwa 1.3.0 the shipped implementation is:

```js
const updateServiceWorker = async (_reloadPage = true) => {
  await registerPromise
  if (!auto) sendSkipWaitingMessage?.()
}
```

The parameter is unused. The reload lives in the `waiting` handler, which arms a
`controlling` listener *before* invoking our callback:

```js
const showSkipWaitingPrompt = () => {
  wb?.addEventListener('controlling', (event) => {
    if (event.isUpdate) {
      if (onNeedReload) onNeedReload()
      else window.location.reload()
    }
  })
  onNeedRefresh?.()
}
```

We supply `onNeedRefresh` and not `onNeedReload`, so sending skip-waiting is what
triggers the reload we intended to prevent. `^1.3.0` has been the pinned range
since the founding commit (`41007d6`), so this has never worked as documented.

It has been survivable only because the single check runs at launch, putting the
reload seconds after open, usually before anyone types. That is timing, not
design: a slow connection moves the reload later, into use.

Two claims in the current spec are also false and are being withdrawn, not
weakened by convenience:

- *"a newly activated worker SHALL NOT take control of an already-open page"*.
  `clientsClaim` governs a **first** worker adopting uncontrolled pages. An
  **updated** worker that skips waiting takes control by definition; that is
  what makes `controllerchange` fire. The comment in `e2e/offline.spec.ts`
  reasons from the same conflation and is corrected in this change.
- *"nor served assets from the new build"*. It follows from the same mistake.
  Once control transfers, later fetches are served by the new precache.

## Goals / Non-Goals

**Goals:**

- The running page is never reloaded without either being unoccupied or being
  asked.
- A build reaches an open device without a relaunch, in minutes rather than at
  the next launch.
- The occupancy test is generic: forms written later are covered without being
  registered anywhere.
- The existing "the next load runs the new build" guarantee is preserved
  exactly.

**Non-Goals:**

- Durable outbox semantics. `billing-live` owns those, and this change does not
  gate on outbox contents (see D5).
- Guaranteeing an update is ever applied to a permanently busy device.
- Version reporting, remote force-update, or blocking an old build.

## Decisions

### D1: Keep the immediate skip-waiting, and take `onNeedReload` instead

`onNeedRefresh` continues to call `updateServiceWorker()`, so a found build
activates at once and the next load runs it. We additionally pass
`onNeedReload`, whose entire body records the update. The plugin's own reload
path is thereby closed at its source rather than worked around.

**Rejected:** defer skip-waiting until we decide to apply, so the open page keeps
the old worker and old assets and the two withdrawn clauses could have been kept
truthfully. A waiting worker does not activate across an ordinary reload while
clients overlap, which is the whole reason `skipWaiting` exists. Deferring would
therefore mean a manual refresh, or a relaunch of a tab that is never fully
closed, could leave the device on the old build. The owner explicitly requires
closing and reopening the app to be a dependable way to force the new build, so
that trade is not available.

**Consequence, accepted:** while an update is deferred, the open page is
controlled by the new worker while running old code. There are no `React.lazy`
calls and no dynamic `import()` anywhere in `src/`, so every chunk the page can
ever need is already in its module graph and in memory. Data comes from
Supabase over the network, not from the precache. The skew is therefore inert
today, and a future dynamic import would need to revisit this.

### D2: Update state lives in a module store, not a provider

Registration stays exactly where it is, at module scope in `main.tsx`. It
publishes into a tiny subscribe/getSnapshot store that React reads through
`useSyncExternalStore`.

**Rejected:** move registration into a React provider, mirroring
`InstallPromptProvider`. That provider exists because it must hold a captured
`beforeinstallprompt` event; update readiness is a boolean. Moving registration
into React would put StrictMode double-invocation and mount ordering in the path
of the boot sequence for no benefit.

### D3: Occupancy is measured by listening for typing, not by reading values

One `input` listener on `document`, capturing, records which elements have been
typed into and how much. Elements gone from the DOM or emptied are dropped when
the snapshot is read.

**Rejected:** scan the DOM for non-empty controls. A `<select>` resting on its
default reads as filled, and comparing against `defaultValue` is unreliable for
React-controlled inputs. Counting keystrokes measures the thing we actually care
about, which is what the person would have to retype.

**Rejected:** a `useUnsavedGuard(isDirty)` hook each form opts into. Twenty-three
files render forms and six of them hand-roll raw `<input>` elements rather than
using `src/components/ui/input.tsx`, so hooking the shared primitive would have
missed them. More importantly the failure mode is inverted: forgetting to opt in
destroys someone's typing, silently. A document-level listener cannot be
forgotten.

### D4: A threshold replaces per-surface opt-out markers

Three or more fields typed into, or roughly a sentence's worth in any one field,
counts as occupied. A search box or a filter falls under it on its own.

**Rejected:** marking noisy controls "ignore me". The threshold removes the need
for the marker entirely, so there is nothing to maintain and nothing to forget.
Forgetting a threshold costs a delayed reload; forgetting a marker costs lost
typing. The asymmetry decides it.

**Consequence:** the threshold cannot see work that is not in form controls. The
bill composer is exactly that case, and D6 handles it.

### D5: Do not gate on the outbox

The live counter adapter is `notLive` in every method
(`src/data-access/supabase-adapters/billing.ts`), so there is no live outbox to
protect today. The durable queue that replaces it is already specified to
survive a reload (`billing-live`, `billing-delivery`: *"Unsent work survives
session and application lifecycle"*, committed to IndexedDB before
acknowledgement). Gating on queue depth would protect a window that does not
exist now and will not exist later.

What a reload does cost a counter is the right to keep billing: resuming after a
reload requires a fresh approved shift, which requires the backend. The online
condition covers that, and covers it more directly than a queue check would.

### D6: One declaration, for work that is not in form controls

`src/features/billing/billing-counter.tsx` holds an order in
`useState<BillLineDraft[]>` and renders no `<input>`, `<textarea>` or `<select>`
anywhere in `src/features/billing/`. A generic measure therefore scores a
fifteen-item order as zero. The composer declares occupancy while `lines` is
non-empty.

This is the one thing a future surface could forget. It is accepted because the
class is narrow and deliberate: a surface only lands here by building a custom
entry mechanism instead of using form controls, which is already a decision
somebody makes consciously.

### D7: In-flight writes are counted at the adapter seam

Every write already passes through the adapters seam, so a single wrapper counts
them for every present and future surface. This is the same reasoning as D3,
applied to saves rather than typing.

### D8: A settle delay, then re-confirmation

When every condition goes green, wait briefly, then re-evaluate before
reloading. Counter billing is continuous; reloading the instant one order
settles would land as the next begins. Re-confirmation is what makes the delay
meaningful rather than decorative.

### D9: One header slot, install first

The shells' `installAction` prop becomes `appAction`, and one component chooses
between install and update. Precedence expressed as one branch in one component
cannot drift; a rule split across two self-suppressing components can. Once
shown, the update action stays shown until applied, because an affordance that
appears and vanishes with each keystroke is worse than none.

Demo shells pass no action, unchanged, and still auto-apply when unoccupied.

### D11: The update action pulses; the install action does not

Install teaches its label once per tab and then goes quiet. The update action
expands and collapses on a repeating cycle for as long as it is unapplied.

The asymmetry is the point. Installing is an invitation, and nobody is waiting
on it, so repeating it would be nagging. An unapplied update is the app
declaring that it is deliberately holding something back, on a counter tablet
that nobody is studying and that may not be looked at directly for an hour. A
label shown once, five minutes ago, on a screen in a busy kitchen, has not been
seen.

Reduced motion turns the cycle off and leaves the label up rather than leaving
an unexplained icon, which states the same thing without moving. The accessible
name is constant throughout, so the cycle is visual only and screen-reader
output never changes underneath somebody.

`usePrefersReducedMotion` moves out of `install-app-button.tsx` into
`src/lib/`, because two components now need it and a second copy would be the
one that stops tracking changes live.

### D10: Five minutes, plus foreground and reconnect, with no cooldown

Discovery is one function, called on launch, on `visibilitychange` to visible, on
`online`, and on a five-minute interval. No cooldown suppresses a call, so
closing and reopening is always a dependable manual override, which the owner
asked for explicitly. Background timers are throttled by the platform; the
foreground call is what covers that, and the two compose.

**Deferred, not rejected:** a realtime signal from CI announcing a deployed
version, so discovery is immediate. Realtime is already in use in this codebase
(`src/data-access/supabase-adapters/counter.ts`), so it is feasible. It is out of
scope because it changes *when we learn*, not *when we apply*, and we apply on
occupancy rather than on discovery: an idle device already reloads promptly, and
a busy one would not reload sooner. It would also add a table, an anon-readable
policy, a realtime publication and a production write from CI, and would still
require every fallback path, since realtime is unavailable exactly when the
network is. Recorded in `openspec/todos/`. Building discovery as one callable
function keeps it a purely additive follow-up.

## Risks / Trade-offs

- **A deferred update leaves old code running against a new worker** → No lazy
  chunks exist in `src/`, so nothing the page needs is fetched after boot;
  re-examine if a dynamic import is ever introduced.
- **`navigator.onLine` reports connectivity, not reachability** → It reliably
  catches airplane mode and a dead adapter, which are the cases that matter for a
  tablet. A captive portal can defeat it, and the cost is a reload that a biller
  can recover from by reconnecting, not lost data.
- **A permanently busy counter never auto-applies** → The action stays visible
  and the build lands on the next launch, which is exactly today's behaviour, so
  this is not a regression.
- **A surface holding non-control work forgets to declare it** → Narrow and
  deliberate class (D6); the bill composer is the only present member and is
  covered by test.
- **Existing worker-lifecycle tests are timing-sensitive**
  (`e2e/offline.spec.ts` primes across two loads) → Its reasoning comment is
  corrected here, and the suite is re-run against the new reload timing rather
  than assumed unaffected.
- **The threshold is a judgement, not a proof** → Two fields lost is cheap to
  retype; the numbers are constants in one module and can be tuned without
  touching the decision logic.

## Migration Plan

No schema, migration, policy or data change. The change is frontend only and
takes effect on the deploy that carries it. Rollback is republishing the prior
frontend commit, which restores the previous (reloading) behaviour with no
forward state to unwind.

The first deploy carrying this change is itself applied by the **old** logic on
any device already running the current build, so that one reload still happens
the way it does today. Every deploy after it is governed by the new rules.

## Open Questions

None. Thresholds, interval, settle delay and precedence are all settled above.
