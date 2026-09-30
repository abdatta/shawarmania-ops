# Tasks: a-receipt-goes-out-on-whatsapp

No migration, no policy, no outlet-scoped table, so there is no isolation test
task. The change reads fields Billing history already reads, whose outlet scope
is already proved.

## 1. The link and the message (design D2, D3)

- [x] 1.1 Failing first: `src/lib/whatsapp-link.test.ts`.
  `+919876543210` → `https://wa.me/919876543210?text=…`; line breaks encode as
  `%0A`; the receipt URL survives a round trip through `decodeURIComponent`; a
  non-canonical input (`9876543210`, `+91 98765 43210`, `''`) throws.
- [x] 1.2 `src/lib/whatsapp-link.ts`: `whatsappChatLink(canonicalPhone, message)`.
- [x] 1.3 Failing first, same file: `receiptMessage({ billNumber, totalPaise, receiptUrl })`
  names the bill number and `formatPaise(totalPaise)`, ends with the URL on its
  own line, and contains no name and no word "points". Then implement it.

## 2. Tokens and the mark (design D7, D8)

- [x] 2.1 `src/styles/tokens.css`: the third-party WhatsApp values and a
  `--whatsapp` token per theme, with the comment saying whose colour it is and
  why it does not re-skin; exposed to Tailwind the way `--success` is. *(First
  built as a filled teal pair identical in both themes; restyled on the owner's
  word, 2026-09-30, to an outlined button like Cancel. Design D7.)*
- [x] 2.2 `scripts/lib/contrast.mjs`: `--whatsapp` on `--surface` and on
  `--surface-raised` (the hover ground) at AA text. `npm run contrast` green in
  both themes.
- [x] 2.3 No button variant: Send receipt is `secondary` plus `text-whatsapp`,
  as Cancel is `secondary` plus `text-danger`.
- [x] 2.4 `src/components/ui/whatsapp-mark.tsx`: WhatsApp's glyph as one inline
  SVG path in `currentColor`, `aria-hidden`, source (Simple Icons, CC0) in a
  comment. `npm run lint` passes `check-no-hex`.

## 3. The receipt action (design D1, D4, D5, D8, D9)

- [x] 3.1 Failing first: rewrite `bill-receipt-share.test.tsx` as
  `bill-receipt-action.test.tsx`:
  - a canonical phone renders one link named "Send receipt on WhatsApp" whose
    `href` is the D2 link, with `target="_blank"` and `rel` containing
    `noopener` and `noreferrer`;
  - no phone renders one link named "Open receipt…" whose `href` is the receipt
    URL, same `target` and `rel`;
  - an unparseable phone (`'Ask at counter'`) renders Open receipt and nothing
    linking to `wa.me`;
  - never both;
  - a demo receipt link with a phone renders Send receipt exactly as a real bill
    does, plus the demo note *(first built disabled; the owner overruled that on
    2026-09-30, design D5)*;
  - a demo receipt link without a phone keeps today's demo note on Open receipt.
- [x] 3.2 `src/features/billing/bill-receipt-action.tsx` replacing
  `bill-receipt-share.tsx`. Delete the old component and its test. Keep
  `useShareLink` and its other callers untouched.
- [x] 3.3 `manager-bill-detail.tsx`: pass `customerPhone` and `totalPaise`; the
  row keeps `flex-wrap` and Cancel takes `ml-auto`; rewrite the row's comment
  (the reasoning for receipt-first DOM order stays, the fragment and
  revealed-link reasoning goes).
- [x] 3.4 Failing first in `manager-bill-detail.test.tsx`: Cancel is the row's
  last control and carries `ml-auto`; a void bill has neither control; a bill
  without `receiptUrl` has Cancel alone.
- [x] 3.5 Grep `e2e/` and `e2e-auth/` for `Share receipt` and `receipt-link`, and
  update any walkthrough step to the new names. Check Billing history's loading
  silhouette does not draw the action row; if it does, reshape it.

## 4. Docs (proposal, "Docs to update")

- [x] 4.1 `docs/SCREENS.md`: Billing history's action row, and the Menu
  paragraph's "exactly as a bill's receipt link is shared".
- [x] 4.2 `docs/LIMITATIONS.md`: "A receipt link is shared by hand" rewritten;
  the Custom Tab ceiling; no open-receipt on a bill with a number.
- [x] 4.3 `docs/SECURITY_AND_PRIVACY.md`: D10.
- [x] 4.4 `docs/DESIGN_SYSTEM.md`: the WhatsApp tokens and why, and the
  Cancel-on-the-right exception.
- [x] 4.5 `docs/OPERATIONS.md`: which account the message goes from, and the
  dedicated-number suggestion.

## 5. Verification

- [x] 5.1 `npm run format`, then `lint`, `format:check`, `typecheck`,
  `functions:typecheck`, `test`, `contrast`, `build`, `test:e2e`.
- [x] 5.2 The Docker job: `test:e2e:auth` at least, since Billing history is
  under a manager role's shell. No migration, so `db:types` should diff clean.
- [x] 5.3 Own preview (7413, or 7414 in a worktree). Phone 375px and tablet, light
  and dark: the row sits on one line and Cancel is at the right edge; Send receipt
  reads as WhatsApp; the demo bill's Send works as a real one, with its note.
- [x] 5.4 In the preview, read both anchors' `href`, `target` and `rel` from the
  DOM and decode the `text` parameter. Screenshot both rows.

## 6. The counter shows the receipt (design D12)

- [x] 6.1 Failing first: `receipt-viewer.test.tsx`. Open, it frames the URL with
  an empty `sandbox` *(later `allow-scripts` only, 6.9)*,
  `referrerpolicy="no-referrer"` and a title naming the bill;
  offline it shows the sentence and no frame, and the frame appears on `online`;
  a demo link carries the demo note; Close calls `onClose`.
- [x] 6.2 `src/features/billing/receipt-viewer.tsx` on the shared `Modal`.
- [x] 6.3 Failing first: `shift-bill-list.test.tsx`. A synced bill's detail
  offers View receipt and tapping it opens the viewer on that bill's URL; a bill
  with `receiptUrl: null` shows it disabled with "Receipt appears once this bill
  syncs"; a void bill offers nothing.
- [x] 6.4 `ShiftBillList`: View receipt in the expanded detail, above the tender
  edit and unwind rows.
- [x] 6.5 Docs: `SCREENS.md` (Bills this shift), `SECURITY_AND_PRIVACY.md` (the
  tablet shows, hands nothing out; the sandbox), `LIMITATIONS.md` (a
  captive portal shows a blank frame).
- [x] 6.6 Gates as in 5.1, and the preview at tablet width in both themes: a
  synced bill, an unsynced one, and the pop-up in demo.
- [x] 6.7 On the owner's word (2026-09-30), failing first: the frame asks for
  `?view=counter`, and a spinner covers it until `load`, returning after offline.
  The site half, `the-counter-views-the-receipt`, omits Download PDF for that
  view; committed in the landing repo and deployed with `worker:deploy`.
- [x] 6.8 On the owner's word (2026-09-30), failing first: the counter behind the
  pop-up is blurred, so a customer shown the tablet cannot read other bills.
- [x] 6.9 On the owner's word (2026-09-30), failing first: the pop-up fits the
  receipt. The frame allows scripts and nothing else, takes a height only from
  its own frame's message, falls back to 32rem, and scrolls within beyond 92% of
  the screen. The site's counter view reports the height.
- [x] 6.10 On the owner's word (2026-09-30), in the site repo and deployed: the
  counter view also leaves out "Paid by" and the tax-invoice sentence, puts the
  bill number and time on one plain row, spaces top and bottom evenly, tightens
  the gap under the logo, and reports the content's own height rather than the
  scroll height (which could grow the pop-up but never shrink it). Checked with
  real Kalyani receipts in a throwaway local demo, since removed.
- [x] 6.11 The docs audit (2026-09-30): the pop-up's spinner recorded as a
  deliberate exception to the design system's shimmer rule, with its lint warning
  suppressed on that line; every doc and change file reread against what is live.

## 7. PHASE GATE: #63 `a-receipt-goes-out-on-whatsapp`

- [ ] 7.1 The ROADMAP.md checkpoint, walked: on a bill that carries a customer's
  number the owner or a franchise admin taps Send receipt and WhatsApp opens on
  that number's chat with the message and receipt link typed, needing only Send;
  a bill with no number, or one that does not read as an Indian mobile, offers
  Open receipt instead, which opens the receipt page outside the app; never both,
  and a cancelled bill offers neither; Cancel this bill at the right-hand end; a
  demonstration bill sends on WhatsApp exactly as a real one does, and says only
  that its receipt link will not open; the WhatsApp
  colour passes AA in both themes; a biller opens View receipt on a bill in
  Bills this shift and its receipt shows in the site's counter view, in a pop-up
  inside the app over a blurred counter, sized to the receipt up to most of the
  screen and scrolling beyond it, with nothing on it that leads out, a spinner
  until it loads, greyed out with a reason on a bill not yet synced, absent on a
  cancelled one, and saying so when offline; nothing is written; and the
  four-role demo walkthrough still walks.
  *Walked 2026-09-30 in the production build on 7413, demo and the local backend
  signed in as the seed owner: every clause proved except the first's last step.
  Live bills built `https://wa.me/91XXXXXXXXXX?text=…` with `target="_blank"`
  and `rel="noopener noreferrer"`, decoding to the three-line message ending in
  the receipt link; bills without a number offered Open receipt; demo bill 20
  then showed Send disabled; on the owner's word that became a live link like
  any other (unit-tested, and rechecked in the preview). **WhatsApp actually
  opening on the chat needs a phone with WhatsApp**, so it rides on 7.2, and this
  box stays open until then. The counter's View receipt was walked the same day
  with real Kalyani receipts in a throwaway local demo (spinner, counter view,
  fit, scroll on a short screen, blur, Close), and the owner signed the look off.*
- [ ] 7.2 🧍 The owner sends one real receipt from the installed app on their
  Android phone to a number they own, and judges the wording and the look.
- [ ] 7.3 🧍 The owner confirms which WhatsApp account customers should see it
  come from.
- [x] 7.4 Commit, and push only in a window the owner picks. Pushed and deployed on
  the owner's word on 2026-09-30, while every outlet was closed ahead of Kalyani
  Cafe's opening.
