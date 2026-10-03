# Tasks: a-receipt-link-fits-an-sms

> Read [`proposal.md`](proposal.md) and [`design.md`](design.md) first. No table, no
> policy and no migration, so no isolation test is owed and the Docker job has
> nothing of this change's to exercise; it is run anyway, as CI runs it.

## 1. The link this app hands out

- [x] 1.1 Failing first, in `src/lib/receipt-link.test.ts`: `receiptLink` builds
      `<base>/bill?t=<token>` at the production base, a `workers.dev` base and a
      base with a trailing slash; the demo link reads `/bill?t=demo~<n>`;
      `isDemoReceiptLink` recognises a demo link at any base, with `view=counter`
      added and with the tilde percent-encoded, and leaves a real link and a
      non-receipt URL alone.
- [x] 1.2 Failing first, same file: the filled-in DLT template (design D6) at a
      ten-character token and a four-digit balance is at most 160 characters and
      all GSM-7 basic set; the link starts with the registered CTA
      `https://shawarmania.in/bill?`.
- [x] 1.3 `src/lib/receipt-link.ts`: `receiptLink` and `isDemoReceiptLink` (design
      D7), and the module comment's address.
- [x] 1.4 Every test that asserts a `/bill/<token>` link (`billing.test.ts`,
      `bill-receipt-action.test.tsx`, `manager-bill-detail.test.tsx`,
      `receipt-viewer.test.tsx`, `shift-bill-list.test.tsx`,
      `whatsapp-link.test.ts`) asserts the same intent against the new shape.

## 2. The landing Worker (child change, `C:\Users\iamro\Code\shawarmania`)

- [x] 2.1 Seed `openspec/changes/a-receipt-link-fits-an-sms-page/` there: proposal
      naming this change as its parent, the delta to `public-receipt-page`'s *served
      from the brand domain* requirement, and tasks.
- [x] 2.2 Failing first, in a new `worker/test/route.test.ts`: the request router,
      as a pure function of the URL, answers `/bill?t=<token>` as the page,
      `&view=counter` as the page in the counter view, `/bill/<token>.pdf` as the
      PDF, the three assets as assets, `/bill/<token>` and `/bill/<token>?view=counter`
      as a redirect to the `?t=` form keeping `view`, and every mangled `t` (absent,
      empty, repeated, malformed, a demo `~`) and a malformed `/bill/<x>` as the one
      refusal; `/billing` and `/` as not the Worker's.
- [x] 2.3 `worker/src/route.ts` (the router), `worker/src/index.ts` (uses it; the
      `/bill` guard), `wrangler.toml` (the route becomes `shawarmania.in/bill*`;
      design D3), and the routing comments.
- [x] 2.4 `npm run worker:typecheck`, `npm run worker:test`, `npm run build`.
- [x] 2.5 The real runtime: `wrangler dev` from a scratch config pointed at the
      **local** ops database (never the landing repo's `.dev.vars`), a seeded bill
      opened at `/bill?t=`, its counter view, its PDF, the redirect and each
      refusal, read from status, headers and body.

## 3. Docs

- [x] 3.1 `docs/ARCHITECTURE.md`, `docs/SCREENS.md`, `docs/SECURITY_AND_PRIVACY.md`:
      the receipt's address.
- [x] 3.2 `docs/OPERATIONS.md`: the Worker's two routes, the release order, and the
      dynamic CTA the address is registered as on DLT.
- [x] 3.3 `docs/GLOSSARY.md`: DLT, header, template, CTA.
- [x] 3.4 #59's proposal: the address it sends, the template it builds against
      (design D6), and its dependency on #66. ROADMAP.md: #66's row.

## 4. Verify

- [x] 4.1 `npm run format`, then `lint`, `format:check`, `typecheck`,
      `functions:typecheck`, `test`, `contrast`, `build`, `test:e2e`.
- [x] 4.2 The Docker job: `db:reset`, `test:db`, `test:rls`, `test:e2e:auth`,
      generated types unchanged. *(2026-10-02: one `test:e2e:auth` spec,
      `billing-served.spec.ts`'s offline served-orders test, failed locally, and
      failed identically with this change's `src/` stashed; CI was green on the
      same baseline on 2026-10-01. Not this change's; flagged separately.)*
- [x] 4.3 The app's production build in the browser pane, live against the local
      database and in demo mode: Send receipt's WhatsApp message, Open receipt's
      address and View receipt's frame each carry `/bill?t=`; View receipt renders
      the counter view from the local Worker.

## 5. Release and PHASE GATE

- [x] 5.1 Commit locally in both repositories. **Do not push or deploy**: the owner
      picks the windows (`no-pushes-while-the-counter-trades`).
- [x] 5.2 🧍 Release, in order: the landing push and `npm run worker:deploy`; then
      the ops push. Check after the first that `https://shawarmania.in/bill?t=`
      reaches the Worker (its refusal carries `X-Robots-Tag`; GitHub Pages' 404 does
      not), and that `/`, `/menu/` and `/privacy/` are unchanged. *(Done 2026-10-03
      ~01:25-01:40 IST, on the owner's word after service. The exact `bill` route
      missed every `/bill?t=`; corrected to `bill*` within minutes, design D3. Ops
      Deploy run 37057980641 green; the live bundle builds `/bill?t=`.)*
- [x] 5.3 **PHASE GATE — the ROADMAP.md checkpoint for #66**, walked: every link the
      app hands out reads `https://shawarmania.in/bill?t=<token>`; it opens the
      receipt, the counter view and the PDF as before; every mangled `t` gets the
      one refusal; `/bill/<token>` redirects keeping `view`; the brand site's other
      pages are untouched; a demo link is still recognised and still refused; a
      filled-in message fits one SMS; and the four-role demo walkthrough still walks.
      *(Walked 2026-10-03 against the live site with a real settled Kalyani Cafe
      bill. `src` builds a receipt link in one place, `receiptLink` in
      `receipt-link.ts`, as `<base>/bill?t=<token>`; no other `/bill/` builder
      exists. `/bill?t=<token>` answered 200 as the customer page, with
      `&view=counter` 200 as a different page, and `/bill/<token>.pdf` 200 as a
      `%PDF`. `/bill/<token>` and `/bill/<token>?view=counter` answered 301 to
      `/bill?t=<token>` and `/bill?t=<token>&view=counter`. No `t`, an empty `t`, a
      short `t`, two `t`s, a token with stray characters, a path token of 100
      characters and the demo token `demo~7` all answered the identical 404 body,
      and so did a well-formed token naming no bill. `/` answered 200, `/privacy`
      and `/terms` 301 to their slashed forms, which answer 200, and `/billing` 404.
      `receipt-link.test.ts`, with the approved wording, 17 of 17, covers the
      one-SMS length and the demo-link refusal. The four-role demo walkthrough ran
      green inside Deploy run 37057980641. Opens since the release include
      non-scripted visits, some from a phone.)*
- [x] 5.4 🧍 The owner registers the dynamic CTA `https://shawarmania.in/bill?` and
      submits the template with a live receipt as the URL sample. Archive once DLT
      has accepted it and a real receipt has been opened at the new address.
      *(2026-10-03: the CTA is submitted on Airtel's portal as a DynamicURL, its
      sample a live receipt of a bill with no customer attached: "1 parameters are
      added, 0 failed validation", pending approval. The template cannot be submitted
      until then: its URL variable's value is a dropdown of approved CTAs, empty
      meanwhile. Settled on the form already: header DEDTTL, Service Implicit, Food
      and Beverages, domain shawarmania.in, `{#var#}` in the content typed Numeric,
      Numeric, URL.)* *(Later 2026-10-03: the CTA was approved at 09:57 IST, CTA ID
      1014225362850951240, and moved from the CTA Parameter tab to Registered → URL,
      which is why the first list looked empty. The template was submitted at ~13:45
      IST and reads **Pending With Registrar**. Submit raised an automatic domain
      check, "a URL with different domain is seen", answered with a justification
      citing the CTA ID, on the owner's word.)* *(Rejected the same day: "Kindly
      mention full Entity Name/Header name in content." Resubmitting crashed on
      Airtel's side, a duplicate-key error on template 033355790362515, so it was
      registered afresh, same name, reference TEM154608444128010, with the sign-off
      the owner chose: `Regards, De & Datta LLP` as a fourth line. **Pending With
      Registrar.** 153 characters filled at a 4-digit balance; the part after `?`
      has 15-19 characters of room. On approval: design D6's wording and the
      SMS-length test in `receipt-link.test.ts` take the sign-off.)* *(**Approved**
      2026-10-03 ~14:05 IST as template ID `1077524620016122125`; D5, D6 and the test
      now carry the approved wording.)*
