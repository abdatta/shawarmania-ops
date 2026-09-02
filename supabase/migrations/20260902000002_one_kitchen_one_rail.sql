-- The preparation pipeline is the outlet's, which it could not have been.
--
-- `orders_select` admitted a tablet to `device_id = auth.uid()`: its own orders
-- and no others. While an outlet held one tablet that WAS the outlet's orders,
-- so nothing ever disagreed with it -- and the app, the specs and #45's own
-- framing all say the rail is the outlet's. Found on 2026-09-02 by running the
-- claim with two tablets for the first time, which is the whole reason
-- `multiple-billing-devices` insists on evidence over argument.
--
-- Left alone it is an operational hole rather than a cosmetic one. The pipeline
-- exists so the kitchen knows what to cook, and one kitchen serves both tills.
-- Two tablets each showing only their own orders means no screen anywhere
-- answers "what does this kitchen owe", and the food gets made from whichever
-- screen somebody happens to be standing at. It also makes
-- `multi-device-billing-coordination`'s own sentence unreachable: another tablet
-- MAY see the order with its creator named, and SHALL be refused if it acts.
--
-- **Gated on a live shift, not on being set up.** `app_counter_shift_outlet()`
-- rather than `app_counter_device_outlet()`, because the house rule for a tablet
-- is that no shift means no reach: a tablet standing idle overnight reads
-- nothing, exactly as it does today. A tablet with somebody on it reads the
-- orders of the outlet it is bolted to, and that is all this changes.
--
-- What it costs, stated plainly [owner, 2026-09-02]: a till can read the
-- customer name and phone on an order the other till took. It is the same shop,
-- the same trading day and staff who are already trusted with the customers in
-- front of them, and the alternative -- withholding those two columns from a
-- sibling's order -- needs a second shape of "order" in the app for a
-- disclosure that does not leave the counter. Bills are deliberately NOT
-- widened: `Bills this shift` stays this shift's, and money history stays as
-- narrow as it was.

drop policy orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated using (
  public.app_device_ok() and (
    device_id = auth.uid()
    or outlet_id = (select public.app_counter_shift_outlet())
    or (public.app_account_active() and (
      (select public.app_is_owner())
      or outlet_id in (select public.app_outlets_for('franchise_admin'))))));

-- `order_items_select` needs no change and is left untouched on purpose: it
-- already reads `exists (select 1 from public.orders o where o.id = order_id)`,
-- so it inherits whatever the policy above admits and cannot drift from it.
