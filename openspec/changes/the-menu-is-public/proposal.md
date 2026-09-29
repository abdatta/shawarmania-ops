# Proposal: the-menu-is-public

> **Model**: Opus · **Wave**: E · **Depends on**: #54 · **Gate**: every
> trading outlet with a menu has a public address, derived from its name and
> shown on its Outlets page; `public_menu(slug)` answers the service role only,
> with active sections and items in the counter's order — unavailable items
> flagged, removed ones absent — and null alike for a closed outlet, an empty
> menu and an invented address; the Menu screen links to it; the brand site's
> Worker serves it at `shawarmania.in/menu/<slug>/`; and a price changed on the
> Menu screen reaches a customer's phone within a minute, with no deploy.

> **This is the parent half of a pair.** The child is change 13
> `the-table-menu-reads-ops` in the brand site's repo
> (`C:\Users\iamro\Code\shawarmania`), which owns the page and the Worker route.
> This change owns the address and the data; neither ships alone.

## Why

Customers at Kalyani Cafe scan a QR code on the table to read the menu
[owner, 2026-09-26]. Until now that page was a copy of the printed card, built
into the brand site: a price changed in ops did not reach it, and an item the
kitchen ran out of still looked orderable. The owner asked for the public menu to
**come from ops**, for **every outlet that is active on ops without anybody
setting one up**, and for items marked unavailable to show as greyed out and
"Unavailable" [owner, 2026-09-28].

The brand site is static (GitHub Pages) and cannot read ops. The public receipt
(#54) already solved the same problem: a Cloudflare Worker on the brand domain
holds a service-role credential and calls one narrow function. The menu takes
the same route.

## What changes

- **`outlets.menu_slug`** — each outlet's public address, derived from its name
  at creation (`Kalyani Cafe` → `kalyani-cafe`), unique, URL-safe, stored and
  kept through a rename; backfilled for every existing outlet.
- **`public_menu(slug)`** — service role only; the customer-visible menu and
  nothing else.
- **The Outlets page** shows each outlet's public address as the address itself,
  with a Copy button beside it, and the form offers it as an optional field with
  the derived one shown.
- **The Menu screen** has a Share button beside Add that shares the public menu
  link, exactly as a bill's receipt link is shared.
- **The brand site** (separate repo) serves `/menu/<slug>/` from the Worker and
  redirects `/menu/` to Kalyani Cafe's. Recorded here for the gate; built there.

## Non-goals

- **No publishing switch.** Every trading outlet with a menu is public, as asked.
  An outlet leaves by being marked closed or by emptying its menu.
- **No prices other than the outlet's own**, no discounts, no ordering from the
  page.
- **No slug history.** A changed address is not redirected from the old one; the
  field warns that printed codes stop working.

## Docs to update before archiving

`docs/DATA_MODEL.md` (the column and the reader), `docs/SCREENS.md` (the Menu
link, the Outlets address), `docs/OPERATIONS.md` (the Worker's second function,
onboarding a table QR), `docs/SECURITY_AND_PRIVACY.md` (what the reader
exposes), `docs/DEMO_MODE.md` (where the demo link goes).

## How to run the gate

`format`, `lint`, `typecheck`, `test`, `build`, `test:e2e`, `test:db`, types
regenerated; a browser check of the Outlets page and the Menu link in demo mode;
then, after deploy, the owner's walk: mark an item unavailable in ops and watch
it grey out on the table's QR menu within a minute.
