# The Sales page shows what delivery kept

> **Model**: Opus · **Wave**: F · **Dependencies**: #71, #42, #47 · **Roadmap**: #73 (owner request, 2026-10-10)

## Why

On 2026-10-09 the owner found the closed Kalyani outlet showing **negative October revenue** on Overview: −₹326.75, made of a −₹604.75 Zomato day and a +₹278 Swiggy day, with no bill rung since 27 Sep. The cause was real: the old Zomato and Swiggy listings were still taking orders nobody accepted, and the platforms charged for the cancellations. The figures were already in the database — a zero-sales day carrying a commission is exactly what a charge looks like — but no screen showed them as charges. Overview folds them into one revenue number, and Analytics → Sales counts delivery **gross**, before commission, so a charge-only day is invisible there.

The owner wants to see, day by day, how much Zomato and Swiggy took, and which of those figures are final. The delivery feeds were moved to Kalyani Cafe on 2026-10-10 precisely so such charges stay visible; this change is the screen that shows them.

## What changes

Analytics → Sales gains a **delivery section** below its existing cards:

- **A section heading** separates it from everything above and says what it is: delivery revenue only, one bar per day. It ignores the page's Revenue/Orders/AOV measure, its Hour/Day/Week grouping and its period comparison; it follows only the page's outlet and date range (the current period).
- **One card per delivery channel** the outlet has figures for in the range, headed by the channel (**Zomato revenue**, **Swiggy revenue**), with three tiles: what customers paid, what the platform kept, and what the outlet gets.
- **One filled column per day.** A day with sales is one column split into two solid colours: what the outlet gets, and what the platform kept on top of it. A day where the platform only charged (no sales, a commission, so a negative net) drops **below the zero line** in a warning colour, so it cannot be missed. A day whose commission is not known yet shows its sales in a third, neutral fill. A day that is not final yet keeps its fill and gains a **distinct outline**; a disputed day gets a small red dot. No hatching or striping: the owner prefers filled bars.
- **Tapping, hovering or arrowing onto a day** spells it out: the date, what customers paid, what the platform kept, what the outlet gets, and the status in words (Final, Not final yet, Cut not known yet, Disputed). A day with no figures recorded says so rather than reading as zero.
- **Weekly charges** that belong to a week rather than a day — today Swiggy's advertising — are listed under that channel's columns with their week and amount.

**The owner sees how the section looks before it is built.** The first tasks render the section against demo data and stop for the owner's approval in both themes on a phone; nothing is wired to live data until then.

## Non-goals

- **Delivery orders and AOV.** Delivery order counts are not stored; the owner dropped this on 2026-10-10.
- Delivery by hour, comparisons with earlier periods inside this section, and any change to the existing Sales cards or to Overview's revenue.
- The Delivery (sync) page, the Zomato/Swiggy accept-the-difference action, the "Delivery data incomplete" qualifier on Overview, and pre-switch weeks re-recorded under a new outlet. Those are fixes to the sync, tracked separately.
- Hyperpure bills paid through a Zomato payout. They are stock purchased, not a platform charge, and already appear in Expenses.
- Editing, accepting or correcting any delivery figure from this screen.

## Durable documentation

Before archive: `docs/SCREENS.md` (Analytics → Sales), `docs/DESIGN_SYSTEM.md` (the delivery series tokens), `docs/DEMO_MODE.md` (demo delivery figures carry commission, state and weekly charges), `docs/DATA_MODEL.md` (what the Sales snapshot carries for delivery) and `docs/TESTING.md`.
