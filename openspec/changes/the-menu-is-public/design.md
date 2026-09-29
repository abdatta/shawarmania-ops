# Design: the-menu-is-public

## D1 — The address is derived once, then stored

The owner's worry was that a slug would be hard to map back to its outlet
[owner, 2026-09-28]. So nobody invents one: the database derives it from the
name, and the Outlets form shows the derived address as its placeholder before
anything is saved. The page shows the address itself rather than a "view" link,
so the mapping is read, not remembered.

It is **stored, not recomputed.** A printed QR code on a table carries the
address; if renaming an outlet moved it, every code already printed would
silently stop working. The same argument makes a blank field on an edit mean
"keep", never "clear" — clearing a field must not un-publish a menu.

Uniqueness is the database's: a unique key refuses a collision from any request,
and a new outlet whose name's address is taken gets `-2`, `-3` … from the same
trigger that derives it, so creating an outlet never fails on an address nobody
typed. The trigger is security definer because finding a free address has to
see every outlet's, not only the ones the writer's policies show.

## D2 — Not the short code

`outlets.code` looked like the obvious address and was rejected. It is internal
shorthand (`skcafe`, `skpa`) that means nothing to a customer; the owner edits it
freely from the same form, which would break printed codes; and staff codes are
derived from it, so its spelling already answers to another purpose.

## D3 — A service-role function behind the Worker, as the receipt is

The brand site is static and the anonymous role is granted nothing in this
schema, so the menu is read the way the public receipt is (#54): the Worker on
`shawarmania.in` holds the service-role key and calls one function that can
return nothing but a menu. `anon` is not granted it — a browser holding a key
would make the whole menu table's shape a public API — and neither is
`authenticated`, because staff read the menu through their own policies and a
security definer function has no business being reachable from a session.

The Worker caches each answer for a minute, which bounds what the database
serves at about one call per outlet per minute of traffic: under 100 MB a month
at the owner's expected 60–80 customers a day, which the owner accepted
[owner, 2026-09-28].

## D4 — What the reader answers, and the one null

Exactly what the customer's page renders: the outlet's name and address, and per
section in the counter's order, per item in order, its name, description, price,
veg flag and availability. No ids — the page links to nothing — and no discounts,
which are the till's business.

An **unavailable** item is listed and flagged, because the owner wants it greyed
out rather than missing. A **removed** item is absent. A closed outlet, an outlet
whose menu is empty and an address nobody holds all answer null, and the Worker
renders one "menu not found" page for all three, so the page cannot be used to
learn which outlets exist but are closed.

## D5 — The Menu screen's link rides the read it already makes

`readOutletMenu` already reads the outlet row for presets and service settings;
the address is one more column on it, so the control costs no request.

It **shares** the address rather than opening it, because a public menu address
exists to be handed to customers [owner, 2026-09-29] — so it is the receipt's
share, not a link: share sheet, else clipboard, else selectable text with no
claim of a copy. Those three cases now live in `useShareLink`, which
`BillReceiptShare` uses too, so the two cannot drift apart. It shares **the link
alone** — no title, no sales line [owner, 2026-09-29]; the receipt keeps its own.

Where it sits took three tries, all the owner's calls on a phone: an underlined
link under the outlet chips (clutter), then an icon beside the title (too
subtle), and finally a labelled **Share** button left of **Add**, the same size in
the secondary colours so Add stays the one highlighted action. It turns to a tick
and **Copied** on the clipboard path. A menu a tablet persisted before this
change has no address and shows no link rather than a wrong one.

## D6 — Demo mode

Demo outlets are given addresses derived exactly as the database derives them,
so the Outlets page and the Menu link are walkable. The link opens the brand
site, which serves real outlets only, so a demo outlet's address finds no menu
there — reading the public site is not writing to real data, and a demo that
invented a working public menu would be demonstrating something that does not
exist.
