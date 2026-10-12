# Approved demo → database and live handoff

## Starting point

Change `each-dish-is-ticked-off`, roadmap #74, schema `spec-driven`, branch
`claude/counter-kitchen-workflow-8tmc58`. Read `proposal.md`, `design.md`, all three
delta specs and `tasks.md` before implementing. Phase 1 tasks 1.1–1.9 are complete:
**9/28 tasks**. Database/live/close tasks remain unchecked. Nothing has been
archived or merged into main capability specs.

On 11 October 2026 the owner said **“rest looks good”**, asked to remove the trial
money total from the status pill, reconcile all artifacts, record confirmation
and commit. This is the explicit Phase 1 approval required by D10/task 1.9.
The owner requested the remaining implementation in a separate chat. Start that
chat at task 2.1; do not repeat the demo approval gate. Merge only after the live
half and its verification are complete.

## Final UI contract

- Counter: menu plus two-column shortest-column masonry rail; one resize handle.
  New/edit composer overlays the left half without reflowing underlying cards;
  an editing pin and single footer occupy the uncovered right half.
- Records: Expenses under menu, Bills under the two-column rail, matching widths
  after resizing. Both rows retain sideways scroll and share its position on
  narrow devices. Records fill a second usable viewport; at maximum page scroll
  only records are visible below persistent chrome. Long lists scroll inside
  their panels. Keep menu layout/paint containment, shell overflow clipping and
  flex gaps that exclude closed dialogs; otherwise trailing blank scroll returns.
- Money: Cash/UPI totals remain **inside Bills only**. The header pill contains
  sync, shift time and applicable kitchen-offline status, with no money total.
  Drop all earlier placement-selector/search-side/header-total ideas.
- Counter dishes: separate visible quantity, fixed 15px checkbox, left inset
  taken from the existing gap, 6px row spacing, centered text, mouse pointer and
  subtle hover shadow. Ticked text/checkbox are orange; no filled item row.
  Waiting is gray. Ready uses a persistent orange checkbox outline and one
  uniform orange light growing from dot to rounded-box fill while fading, then
  disappearing and restarting with no shrink or permanently bright center.
  The 2.4s pulse is synchronized; reduced motion is steady. No row outline,
  ready count, shake or counter sound. B is selected; A/C remain demo comparisons.
- No aggregate Prepared button. Center Table/Dine-in/Takeaway beside Paid, or
  use full-width Paid when service is absent. Payment and its take-back safety
  remain unchanged. Customer details remain in Paid, edit and overflow.
- Compact counter timer replaces the customer icon in its existing footprint:
  centered numeric **total minutes**, including 84 rather than 1h; warning 10,
  danger 20, darker contrast-validated red 40. Gold star overlays order number
  without consuming header width.
- Every carrying kitchen owns a stable independent status slot: sent single
  tick → orange ACK double tick → Ready bell → empty after handover. Handover,
  Ready, Undo and later food change only the appropriate kitchen. No ACK bell
  or dot cluster. Keep accessible kitchen/state names and empty-slot geometry.
- Composer: Order Label placeholder with hidden accessible caption, compact
  quantity pill, amount then rightmost pencil, and unwrapped Save. Preserve
  label lifetime, quick-note ranking, All/Only 1, locks and waiting-draft restore.
- Kitchen: responsive N-column shortest-column masonry. No label/customer data.
  Gray Done checkbox beside timer, visible check and pale fill, thick outline;
  checked green circle and unchecked circle match the timer diameter. Marking
  Done sends Ready **immediately**, collapses a muted gray receipt and replaces
  timer with an expand arrow. Whole-card click toggles both directions; Undo
  remains available at any time. **No five-second timer/progress ring**, card
  border countdown or automatic time-based disappearance.
- Each Done receipt remains distinct from later cooking ticket #N · 2 etc.
  Counter handover consumes older receipts first. Only complete handover removes
  it: 320ms soft fade/4% shrink in its original slot, 180ms held blank gap, then
  masonry repacks. Unticking an unfinished order restores its gray Done receipt.
  Kitchen Undo never erases counter handover. Removed/cancelled already-made food
  must not reappear as kitchen work.
- Demo fixtures mostly have service consistent with required-service settings:
  table/dine-in and takeaway, plus exactly two legacy no-service examples.

## Where the implementation lives

`src/domain/dish-workflow.ts` defines quantity, lock and receipt derivations.
`src/data-access/mock/dish-workflow.ts` stores the typed demo sidecar and fixture
scenario; `mock/billing.ts` and `mock/kitchen.ts` project it through adapter types.
`adapters.ts` is the typed seam. No migration or generated-schema change has been
made. The mock sidecar is deliberate: the database phase must make the same
contract real rather than changing generated fixture types by hand.

Counter layout is in `billing-counter.tsx`, `demo-counter-review.tsx`,
`use-masonry-rail.ts`, `pipeline-card.tsx` and `ready-dish.tsx`. Kitchen receipts
are in `kitchen-card.tsx`, `use-kitchen-ready.ts` and `use-kitchen-masonry.ts`.
`components/ui/order-age-ring.tsx` shares ring geometry. Layout shimmers were
reshaped alongside both surfaces; preserve that parity when promoting live.

The new layout/workflow is currently selected in demo. Existing live fallbacks
remain until the live phase implements the reads/commands and replaces those
branches. Audit every `dishWorkflow`, session-mode and mock-specific branch when
promoting; optional adapter methods must not silently leave live controls inert.
Do not promote a gate or change real billing/offline behavior prematurely.

`demo/demo-orders-mirror.ts` uses the existing demo channel: counter owns labels,
notes and handover; kitchens own ACK/Ready/Undo. Ready rows merge by command ID
with Undo monotonic. Publish a locally authored kitchen action before adopting
an incoming counter snapshot, or a rapid Undo can be hidden by the periodic scan.
Unsent create/revision projections must apply `workflowLines` after their overlay
so an offline dish tick appears before delivery and survives it. Embedded Bills
must receive the cold-reopen `asOf` timestamp. Regression tests pin both issues.

## Remaining implementation and verification

Follow tasks 2.1–2.8 for label/note migrations, preparation records and Ready/Undo
records, reads, generated types, pgTAP and explicit cross-outlet probes. D2–D8
define payloads, authority, append-only Ready history, late/stale quantities,
legacy whole-order commands and day-change compatibility. Do not introduce a
dish-to-kitchen mapping, Ready times or person facts into the counter marks read;
it returns per-line Ready quantities and per-kitchen aggregate states only.

Then tasks 3.1–3.4 make the live adapter/outbox real and exercise two real sessions
against the local stack. Preserve client-generated UUID idempotency and ordered
offline delivery, including old queued payloads without label/note. Kitchen
Ready/Undo remain online-only; failed writes must restore prior UI state. Do not
change integer-paise arithmetic, customer identity or outlet isolation.

Tasks 4.x update the durable wiki, run the full local gates including fresh
database reset → pgTAP → RLS/auth, regenerate schema and prove no stale diff,
exercise actual offline exactly-once settlement, then seek merge/archive only
as instructed. Demo tests are not evidence for a live database command or RLS.
Do not hand-stamp ROADMAP status; run `npm run roadmap:sync`.

`review.md` records verification and screenshot evidence. `review/` contains
light/dark, phone/tablet and kitchen captures. The final counter capture
supersedes earlier comparison shots showing the trial header total. Temporary
preview URLs are in `review.md`; start a fresh owned preview if they have expired,
using the repository's prescribed ports rather than borrowing the owner's dev
server. User `.codex-remote-attachments/` files are excluded from the commit.
