# Design: a-receipt-link-fits-an-sms

No table, no policy, no migration, no money arithmetic and no offline semantics.
The token, its generator, the reader function and the receipt's contents are all
untouched. What changes is the address the token is carried in: one function in
this repository builds it, and the Worker in the landing repository answers it.

## D1. The token goes after a `?`, as `t=`

```
https://shawarmania.in/bill?t=Ab3-_x9QzT
                           ^ registered on DLT up to and including this
```

TRAI's direction of 18 November 2025 (Annexure I) says a `{#url#}` variable *"must
be validated with registered CTA, under Static or Dynamic or Short URL"*. Airtel's
portal registers a dynamic URL as its fixed part up to the `?`, and only what follows
may vary. So the token has to be the part after the `?`, and everything before it
has to be identical for every bill.

**`t=<token>` rather than a bare `?<token>`.** A bare query string is legal, but
`URLSearchParams` reads it as a key with an empty value, and an operator's scrubber
is more likely to parse `key=value` than to expect a naked one. Two characters buy
the conventional form. `t` because the address carries nothing else a customer
needs, and a longer name would be paid for in every SMS.

**`/bill` kept as the path.** It is the address the brand site already uses for
receipts, it reads as what it is, and the Worker's assets and PDF already live
under it.

Rejected:

- **`/r?t=` or another shorter path.** Four characters cheaper, and the message
  fits one SMS either way (D5). A second path prefix for the Worker to own buys
  nothing a customer can see.
- **The token in a fragment (`/bill#Ab3…`).** A fragment never reaches the server,
  so the Worker could not read it.
- **A short-URL CTA.** It needs a shortener domain registered as the sender's,
  adds a hop the Worker does not control, and hides from the customer where the
  link goes. The full link is 40 characters.

## D2. `/bill/<token>` redirects; it is not kept as a page

**No customer holds a `/bill/<token>` link.** The owner confirmed on 2026-10-02 that
none was ever sent, so nothing is owed to the old shape. It is still redirected,
for one reason: **the release is two deploys that cannot happen in the same
instant.**

- The live ops build hands out `/bill/<token>` until the ops push deploys, and the
  counter's **View receipt** frames that address. If the Worker stopped answering
  it first, every View receipt at the counter would refuse until the ops deploy
  landed, during trading.
- The ops build cannot go first either: the live Worker's route is
  `shawarmania.in/bill/*`, so `/bill?t=…` never reaches it and falls through to
  GitHub Pages' 404.

So the Worker ships first, answering both, and the ops push follows whenever the
owner chooses. A redirect rather than a second page keeps **one address per
receipt**, the same rule the menu follows when it redirects `/menu/Kalyani-Cafe` to
its canonical lowercase address.

The redirect is a `301` to `/bill?t=<token>`, keeping every other query parameter,
so `/bill/<token>?view=counter` lands on the counter view. It is issued only for a
token of the right shape, **before any lookup**, so it says nothing about whether
the bill exists: an unknown token redirects and is then refused like any other.
A malformed one is refused at once, as it is today.

Rejected:

- **Drop `/bill/<token>` outright**, as the owner allowed. It leaves the gap above,
  and the redirect is a few lines.
- **Serve both as pages.** Two addresses for one receipt, one of which is
  unregistrable on DLT, kept alive by nothing but habit.
- **Retire the redirect after the ops deploy.** A third deploy that removes
  something harmless. A later change may, if it ever has a reason.

## D3. The route is `bill*`, because an exact route misses every query

The Worker's receipt route becomes:

```toml
[[routes]]
pattern = "shawarmania.in/bill*"    # /bill?t=<token>, and everything under /bill/
```

**This was not the first design, and production corrected it.** The change first
shipped an exact `shawarmania.in/bill` route beside `shawarmania.in/bill/*`, on the
belief that Cloudflare matches a route on host and path and ignores the query. It
does not, for a pattern with no wildcard: deployed at 01:25 IST on 2026-10-02, the
exact route answered a bare `/bill` and let every `/bill?t=…` fall through to GitHub
Pages' 404, while `/bill/?t=…` (under the wildcard route) reached the Worker. A
wildcard pattern does match a URL with a query, so `bill*` was deployed minutes
later and the receipt answered. The live app was still handing out `/bill/<token>`
throughout, which kept working, so no customer and no counter saw the gap.

**What `bill*` costs.** It also routes `/billing`, `/bills` and any other path that
merely begins with `bill` to the Worker, which answers them with its plain 404. The
brand site has no page there, so nothing moves today; a page published under that
prefix later would need this route narrowed first.

Rejected:

- **An exact `shawarmania.in/bill` route.** Above: it never sees a receipt link.
- **Proxying non-receipt paths back to Pages from the Worker** (`fetch(request)`),
  so `bill*` costs nothing. It loops under `wrangler dev`, which has no Pages origin
  behind it (the Worker's own comment records the 19-second hang), and protects a
  page that does not exist.

**The Worker's own guard stays narrower than the route.** It answers `/bill` exactly
and `/bill/…`, and 404s anything else, as it does now. Under `wrangler dev`, with no
routes, that guard is the only boundary.

## D4. The PDF and the assets keep their addresses

`/bill/<token>.pdf`, `/bill/logo.png` and `/bill/fonts/*.woff2` are unchanged. They
are reached only from the page, never from a message, so DLT has no say in their
shape, and moving them would change a working download for nothing.

The page's Download PDF link is therefore still `/bill/<token>.pdf`, which is what
the receipt spec already requires: *"served from its own URL"*.

## D5. A filled-in message is one SMS

The template as filed (D6), with a ten-character token and a four-digit balance:

```
Thank you for visiting Shawarmania!
You earned 20 points. Balance: 1250 points.
Receipt: https://shawarmania.in/bill?t=Ab3-_x9QzT
Regards, De & Datta LLP
```

**153 characters**, newlines included. Every character is in GSM-7's basic set,
`_`, `-` and `&` included, so no character forces the 70-character Unicode
segment; a demo token's `~` would, but a demo link never reaches an SMS. One
segment is 160.

**The headroom is the link's, and it is small.** Everything but the digits and
the part after the `?` is 135 characters, so the part after the `?` (today
`t=<token>`, 12 characters) may be up to 19 characters at a 2-digit earning and a
4-digit balance, 17 at 3 and 5 digits, 15 at 4 and 6. A token minted at fourteen
characters still fits at 3 and 5 digits (159). A second query parameter does not:
anything added to the link is paid for in a second SMS segment for every
high-balance customer.

## D6. The template as filed, for #59 to build against

**Approved by Airtel on 2026-10-03 as template ID `1077524620016122125`**,
header DEDTTL, Service Implicit, Food and Beverages. The portal is the record:

```
Thank you for visiting Shawarmania!
You earned {#numeric#} points. Balance: {#numeric#} points.
Receipt: {#url#}
Regards, De & Datta LLP
```

**The last line is Airtel's, not a style choice.** The first filing, without it,
was rejected: *"Kindly mention full Entity Name/Header name in content."* The
registered entity is De & Datta LLP and the header DEDTTL is its; "Shawarmania"
alone named neither. The owner chose the sign-off from five shapes researched
2026-10-03 (operators expect the sender's name in a footer such as "Team X" or
"- X"). Resubmitting the rejected template crashed on Airtel's side, so this is a
fresh registration under the same name; the rejected one (`033355790362515`)
stays in the Rejected tab and means nothing.

**Airtel stores it with `\r\n` line breaks** and its own internal tags
(`{#num#}`, `{#urg#}`). Whether a message sent with `\n` scrubs as a match is for
#59 to confirm against the provider before relying on it.

| Variable | Tag | Carries | Sample |
|---|---|---|---|
| 1 | `{#numeric#}` | points this bill earned | `20` |
| 2 | `{#numeric#}` | points balance after this bill | `140` |
| 3 | `{#url#}` | this bill's receipt link | a live `/bill?t=` link |

What #59 has to honour, because the template is fixed at approval:

- **`{#numeric#}` is digits only.** TRAI's annexure: *"Must be digits only. No
  alphabets or special chars allowed."* After the 60-day logger period a message
  that fails is rejected outright. So #59 sends the stored integers as
  `String(n)`: never `1,250`, never a sign, never a decimal. Points are integers
  in the database (#62), so nothing has to be rounded to get there.
  `1,250` was considered and refused [owner, 2026-10-02]: only
  `{#alphanumeric#}` accepts a comma, and tagging a number as free text is the
  loose slot the direction exists to close. If grouping is ever wanted, it is a
  second template.
- **`{#url#}` must start with the registered CTA**, `https://shawarmania.in/bill?`.
  That is exactly what `receiptLink()` produces against the production base.
- **Three variables.** TRAI's February 2023 direction caps a template at two, with
  a third allowed for recorded reasons. The reason given: each is an account figure
  of this one purchase, and none is free text.
- **Category: Service Implicit**: a message caused by something the customer just
  did. Not Promotional, which DND (the national do-not-disturb register) would
  block, and nothing in it nudges (*"come back and redeem"* would make it
  promotional).

## D7. In this repository: one builder, one reader

- `receiptLink(token, base)` returns `${base}/bill?t=${encodeURIComponent(token)}`.
  Every surface that hands out a link already goes through it: the live and mock
  billing adapters build `receiptUrl` with it, and the screens only display or
  forward that string.
- `isDemoReceiptLink(url)` parses the URL and reads `t`, rather than splitting on
  `/bill/`, which would never match the new shape and would silently stop marking
  demo links as demonstrations. It recognises only the shape `receiptLink` builds;
  nothing in the app produces the old one any more.
- The counter's **View receipt** already appends `view=counter` with
  `URL.searchParams.set`, which composes with `t` as it stands.

The demo token stays `demo~<n>`. The Worker's token shape refuses `~`, so a demo
link is still structurally unable to resolve.

## Release order

1. **The Worker** (landing repository): the new route and the redirect.
   `npm run worker:deploy`. Safe at any hour: every address the live app hands out
   keeps working, and a new one starts working.
2. **The ops push**, in the owner's window. From then on the app hands out the new
   shape.
3. **The owner registers the CTA and the template** on Airtel DLT, with a live
   receipt link as the URL variable's sample.
