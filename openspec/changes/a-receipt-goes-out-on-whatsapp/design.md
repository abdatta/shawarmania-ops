# Design: a-receipt-goes-out-on-whatsapp

Read [`proposal.md`](proposal.md) first. It records what the owner decided on
2026-09-29 and what was refused. This file is how.

**No RLS policy, no migration, no money arithmetic, no offline semantics.** The
change reads two fields the bill already carries (`customerPhone`,
`receiptUrl`) and one it already formats (`totalPaise`), and it writes nothing.
The rules those areas carry are named below only where this change comes near
them.

## D1. One receipt action per bill, chosen by the number

```ts
const phone = normalizeIndianPhone(bill.customerPhone) // shared/phone.ts
phone ? <SendReceipt …/> : <OpenReceipt …/>
```

- **`normalizeIndianPhone`, not a truthiness check.** Since #56 the counter
  stores the canonical `+91XXXXXXXXXX`, but bills rung before it can carry
  anything a biller typed. A value that does not normalise is treated as no
  number, and the bill offers Open receipt. It is never "fixed up" into a
  guess, because a guessed digit sends a stranger somebody's bill.
- **Both still need `bill.receiptUrl`.** A bill the server has not accepted has
  no link. It gets no receipt action at all, exactly as today.
- **A void bill gets no row at all**, exactly as today (the row is already inside
  `bill.status !== 'void'`).

**Rejected: both buttons at once.** Three controls do not fit one 375px row, and
the owner shares with the customer, whom the number already names. See the
proposal.

## D2. The WhatsApp link

A pure function in `src/lib/whatsapp-link.ts`:

```ts
/** `+919876543210` → `https://wa.me/919876543210?text=…` */
export function whatsappChatLink(canonicalPhone: string, message: string): string
```

- **`https://wa.me/`**, with the number in full international form, **no `+`,
  no spaces, no leading zero**, which is the canonical form with its `+`
  removed. The function takes the canonical form only and throws on anything
  else, so a caller cannot pass a raw bill value by mistake.
- **`?text=` with `encodeURIComponent`**, so line breaks travel as `%0A` and the
  receipt URL's own characters survive.
- **An anchor, not a script.** `<a href target="_blank" rel="noopener noreferrer">`.
  An anchor is a user gesture no popup blocker refuses. On Android, `wa.me` is an
  App Link that WhatsApp claims, so the phone opens WhatsApp directly. Where both
  WhatsApp and WhatsApp Business are installed, Android asks which (or uses the
  default). `noreferrer` keeps the ops app's address out of the request.

**Rejected: `whatsapp://send?phone=…&text=…`.** It skips a browser hop on a
phone, but fails silently on any device without the app: a laptop, or a counter
tablet. `wa.me` degrades to WhatsApp Web's landing page there.

**Rejected: `api.whatsapp.com/send?phone=…`.** Same behaviour, longer URL, no
gain.

**Rejected: the WhatsApp Business API / Cloud API.** That is automatic sending,
with a Meta account, templates and per-message cost. It is #59's territory, and
#59 has chosen SMS.

## D3. The message

```
Thanks for visiting Shawarmania!
Your bill 1489 for ₹260:
https://shawarmania.in/bill/<token>
```

- Built by a pure `receiptMessage({ billNumber, totalPaise, receiptUrl })` beside
  the link builder, and tested as a string.
- **The total goes through `formatPaise`**, the one money formatter. Integer paise
  in, `₹` string out, at the display edge. No arithmetic.
- **The link goes last, on its own line**, so WhatsApp builds its preview card
  from it. The receipt page's preview was checked in WhatsApp at #54's
  production gate.
- **Transactional only.** No offer, no "use your points", no nudge. It matches
  the tone #59's published page promises, even though this message is not that
  programme.
- **No name** (legacy placeholder names; see the proposal's Non-goals).
- **No points** (the history read does not carry them; the page shows them).

The wording is the owner's to change at the checkpoint. It lives in one function
for that reason.

## D4. Open receipt

`<a href={receiptUrl} target="_blank" rel="noopener noreferrer">`, drawn as a
secondary button with an external-link icon (`ExternalLink` from lucide).

**What the owner asked for was "open it in Chrome, not the app's webview", and
that is not reachable from an installed web app on Android.** Chrome opens a link
leaving an installed app's scope in a **Custom Tab**, a Chrome window over the
app with an address bar and a close button. Neither `target="_blank"` nor an
`intent://` rewrite escapes it:

- Chromium issue 40745354 ("Links from PWA always open in custom tab mode on
  Android") is the open request for exactly this.
- trovu PR #709 built the `intent://` workaround, tested it, found it still
  landed in a Custom Tab unless a native app claimed the URL, and closed.
- The only real escape is `display: "browser"` in the manifest, which ends the
  installed app. Rejected outright.

The Custom Tab does everything the old button was used for. The link is in its
address bar. Share, Copy link, Download (the PDF) and **Open in Chrome** are in
its menu. So a plain anchor is built, and it does not fight the platform. **On a
laptop the same anchor is an ordinary new tab.**

**Rejected: keeping the share sheet behind Open receipt.** The Custom Tab's menu
already is one.

## D5. Demo mode

The receipt URL decides, as the demo note already does: `isDemoReceiptLink(receiptUrl)`
from `src/lib/receipt-link.ts`. That keeps the rule *read off the link, not off
the session*: a demo token is structurally unable to name a real bill, and a bill
with a demo token has a number invented alongside it.

- **Both actions behave exactly as in production** [owner, 2026-09-30]. Send
  receipt opens WhatsApp on the demo customer's number with the message typed,
  and Open receipt opens the demo link, which the public reader refuses.
- **The note is the only difference.** It says the receipt link will not open,
  because the bill behind it is invented, which is today's note unchanged.

**Rejected: Send receipt disabled in demo.** It was built that way first,
because the demo's numbers (`+91 90000 001xx`) are shaped like real mobiles and
may belong to real people. The owner overruled it on 2026-09-30: following the
link sends nothing, a person still has to tap Send in WhatsApp, and a demo that
does less than production is a demo that cannot show the feature. A disabled
button would also have been a second code path in a control whose whole job is
one link.

This is the demo seam, which is one reason this is a change and not a quickfix.

## D6. The row

```tsx
<div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
  {receipt action or nothing}
  <Button variant="secondary" className="ml-auto text-danger" …>Cancel this bill</Button>
</div>
```

- **`justify-between` plus `ml-auto` on Cancel**, so Cancel is at the right edge
  whether or not a receipt action precedes it.
- The receipt action stays **first in DOM order**, keeping #54's reason: a
  destructive control must not be the first thing a thumb or a screen reader
  reaches.
- **The row no longer wraps.** The revealed-link paragraph (`basis-full`,
  `order-last`) and the `sr-only` "Link copied." live region leave with the
  clipboard path. The demo note, where it shows, stays `basis-full` beneath the
  row, which therefore keeps `flex-wrap`.
- **This departs from the Outlets page's destructive-at-the-foot convention**
  on purpose, recorded in `docs/DESIGN_SYSTEM.md` so it is not "fixed" back.

**Shimmer:** Billing history's loading silhouette covers collapsed rows, not an
expanded bill's action row. Check that it is so; if a placeholder draws this
row, reshape it (AGENTS.md, Design).

## D7. WhatsApp's colour and mark

**The colour.** An outlined button drawn exactly like **Cancel this bill**, with
WhatsApp's green where Cancel has red, for the label and the mark [owner,
2026-09-30]. It is the ordinary `secondary` button plus `text-whatsapp`, as
Cancel is `secondary` plus `text-danger`.

AGENTS.md puts every colour in the token layer and none in a component. WhatsApp's
colour is not Shawarmania's brand, and a franchise re-skin must not change it.
So its values enter `src/styles/tokens.css` in a third-party layer beside the
brand block, with a comment saying whose they are, and map to one semantic token
that **moves with the theme**, as `--danger` does:

```css
--thirdparty-whatsapp-green: #25d366;      /* WhatsApp's own bright green */
--thirdparty-whatsapp-teal-green: #007d66; /* WhatsApp Web's #008069, a hair deeper */
--whatsapp: var(--thirdparty-whatsapp-teal-green); /* light */
--whatsapp: var(--thirdparty-whatsapp-green);      /* dark */
```

**The values are chosen by contrast, not taste.** The label sits on the button's
own surface, and on the raised surface while hovered. On the dark card WhatsApp's
bright green is about 8.8:1, and 7.7:1 on the raised one. On white it is only
1.9:1, so light takes WhatsApp Web's teal green `#008069`, which is 4.89:1 on the
surface but 4.49:1 on the raised hover ground, a hair under AA. `#007d66` is
5.1:1 and 4.7:1 and looks the same. Both pairs are in `scripts/lib/contrast.mjs`
for both themes, and the validator is the gate, not this arithmetic.

**Rejected: a filled button in WhatsApp's dark teal `#075E54`** with white text
and mark (7.7:1). It was built first. The owner turned it down on 2026-09-30: a
filled button outshouted everything else on the bill, and it read as a different
kind of control from the Cancel beside it. *(An earlier chat reply on 2026-09-29
suggested the mid teal `#128C7E` for that fill as the readable option. It was
not: 4.1:1.)*

**The mark.** Lucide ships no brand icons. A `WhatsAppMark` component in
`src/components/ui/` draws WhatsApp's official glyph as one inline SVG path in
`currentColor`, `aria-hidden`, copied unaltered from Simple Icons (CC0) with the
source in a comment. It adds no dependency. WhatsApp's brand guidance permits its
glyph on a link that opens WhatsApp, unmodified.

**Rejected: a neutral button with only the mark in green.** The label in green
as well is what makes the channel read at a glance, the way Cancel's red label
does.

## D8. Labels and accessibility

- **Send receipt**, accessible name "Send receipt on WhatsApp". "Share" was
  rejected: it implies choosing a recipient, and this goes to one. The visible
  label carries the noun because the row is not inside a tile that names the
  receipt (the verb-only convention applies where the card names the thing).
- **Open receipt**, accessible name "Open receipt (opens outside the app)".
- Both anchors are styled with `buttonVariants`, as the demo link in
  `account-menu.tsx` and `not-found.tsx` already are. `Button` renders only
  `<button>`. Send receipt uses the `secondary` variant plus `text-whatsapp`,
  so no button variant was added for it.
- Focus ring: the existing `focus-visible:focus-ring` via `buttonVariants`.

## D9. What leaves, what stays

- `BillReceiptShare` is replaced by `BillReceiptAction`, which takes
  `receiptUrl`, `billNumber`, `totalPaise` and `customerPhone`. Its test file is
  rewritten. The share-sheet, clipboard and reveal tests leave with the
  behaviour.
- **`useShareLink` stays.** It serves the public menu and account handover, whose
  tests are untouched.
- `docs/SCREENS.md`'s Menu paragraph says the menu link is shared "exactly as a
  bill's receipt link is shared". That comparison stops being true and is
  reworded.

## D10. Privacy

- The number and the receipt link **leave the app into WhatsApp on the owner's
  tap**, and nowhere else. Nothing is logged, sent to analytics or stored.
- Where WhatsApp is not installed, the browser requests `wa.me/<number>`, which
  hands the number to Meta's web server. Meta is carrying the message to that
  number anyway, so this discloses nothing the send does not. Recorded rather
  than engineered around.
- **Who the message is from** is whichever WhatsApp account is signed in on that
  phone, often the owner's personal number. `docs/OPERATIONS.md` suggests a
  dedicated outlet number on the free WhatsApp Business app. Not enforced.
- **Consent.** A number given for points is not consent (#62). The practice is to
  ask. WhatsApp itself restricts accounts that many recipients block or report,
  which is a second reason to send only to people who asked.
- **Misdelivery.** A human sees the chat before sending: WhatsApp shows the name
  or photo the number carries, or says it is not on WhatsApp. That is a stronger
  check than #59's automatic path has. #54's bound (the page names no customer)
  still holds until #58.

## D12. The counter shows the receipt (2026-09-30)

A `ReceiptViewer` pop-up on the shared `Modal`, opened from **View receipt** in
the expanded bill of `ShiftBillList` (the counter's Bills this shift, rendered by
`MyShiftSurface`). It holds one `<iframe>` of the bill's receipt URL.

**Why a frame of the real page, not the receipt redrawn in the app.** The page is
the receipt the customer's link shows, discounts, round-up and points included,
built at the moment it is asked for (#54). Redrawing it here would be a second
receipt that could disagree with the first. Measured 2026-09-30: the Worker sends
`Referrer-Policy`, `X-Robots-Tag` and `X-Content-Type-Options`, and **no**
`X-Frame-Options` or CSP `frame-ancestors`, so it can be framed with no change to
the landing repo.

**Locked down with an empty `sandbox`.** The receipt page carries no script
(checked in `worker/src/page.ts`), so the frame needs no permission at all. An
empty `sandbox` refuses scripts, forms, pop-ups, downloads and navigating the app,
which is what keeps the tablet from being walked out of the app by the page's PDF
link or footer. `referrerPolicy="no-referrer"` matches the page's own policy.

**No new read and no new policy.** `listShiftHistory` already selects
`bill_public_links(token, revoked_at)`, and that table is readable wherever its
bill is (`bill_public_links_select`), so a tablet already holds the link for every
bill of its own shift. A bill still in the outbox has `receiptUrl: null` because
its token is minted when the row reaches Postgres; View receipt is greyed out with
"Receipt appears once this bill syncs". A void bill offers nothing, as D1.

**Offline.** A cross-origin frame cannot report a failed load, so the viewer asks
the browser instead: `navigator.onLine` when it opens, kept current by the
`online` and `offline` events. Offline, it shows "The receipt needs the internet.
This tablet is offline." in place of the frame; the frame appears when the tablet
comes back. A captive portal that claims to be online is not detected, and a
blank frame there is accepted.

**Demo** is production, as D5: the frame loads the demo link, which the reader
refuses, and the demo note says why.

**Reversed from #54, narrowly.** #54's proposal kept "a share affordance on the
counter tablet" out because the tablet is shared hardware in a shop, and its
tasks asserted "no Share control on any Biller surface". That remains true: the
tablet gets no Send, Open or Share. What it gains shows a bill it can already
read, on its own screen, and hands nothing out.

**Rejected: opening the receipt in the browser from the tablet.** The owner asked
that the biller not leave the app, and a Custom Tab over the counter is a way to
lose the counter mid-service.

**Rejected: the receipt redrawn natively from the bill.** A second rendering of
the same document; see above.

## D11. Relationship to #59

A backup now, a manual resend after #59 ships. Nothing here constrains #59's
design, and #59 will not need to remove anything this builds.
