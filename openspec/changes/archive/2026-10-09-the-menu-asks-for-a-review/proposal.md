# The menu asks for a Google review

> **Model**: Opus · **Dependencies**: #61 (the-menu-is-public), #68 (the-menu-orders-and-highlights) · **Parent of**: the brand site's table-menu review popup

## Why

Kalyani Cafe wants more Google reviews, and the table menu is the one page every
dine-in customer opens. The owner asked [2026-10-07] for the menu to open with a
popup asking for a review on Google, with an extra discount as a thank-you for
sharing one — and for each outlet to be able to switch it off and change the
percentage without a website deploy.

The framing is the owner's too: the popup thanks a customer for their feedback;
it must not read as paying for a good review.

## What changes

- **Each outlet has a Google review ask**: on or off, its listing's review link,
  and a review discount percentage (whole, 1–50, five by default). The owner sets it for
  any outlet and a Franchise Admin for the outlets they manage — the same reach as
  Orders and Loyalty — on a new **Google review** section of the outlet's page.
- **`public_menu` carries it**: `review` is `{url, percent, popup}` while the outlet asks
  and null while it does not. Its privilege and every other field are unchanged.
- The brand site's Worker reads `review` and draws the popup and its docked
  banner; with null, or from a reader that predates this, there is none.
- **The popup can be switched off** [owner, 2026-10-07]: with it off, the menu shows
  only the bottom banner — the quieter version. On by default.
- Kalyani Cafe starts with it on, with its real listing's link and five percent.

The percentage is copy, not arithmetic: the biller gives it at the counter with
the ordinary bill discount. No bill, total or discount row changes.

## Delivery and gate

The section is small and reuses the outlet page's settings tiles, so it ships
straight to `live` behind the `outlet-review-ask` part: database, adapter, mock
and UI in one change, as #60 and #62's settings did once their tables existed.

**Release order matters.** The Worker's menu reader refuses any field it does not
know (`MenuSaysTooMuch`), so the brand site's Worker that accepts `review` must be
deployed before this migration reaches production; otherwise every menu page
fails until it is.

## Non-goals

An automatic discount at the counter, verifying that a review was posted, a
separate offer per table, scheduling, or any change to captured bills.
