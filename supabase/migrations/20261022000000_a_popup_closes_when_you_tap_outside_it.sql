-- a-popup-closes-when-you-tap-outside-it: the change gate that releases it.
-- change-gate: outside-tap-closes
--
-- Tapping the dimmed space outside a pop-up closes it. The shared Modal reads
-- this gate once, when the page loads; nothing is saved by the new path, so
-- there is no table, function, policy or view here, only the gate's own row,
-- off. A build published before this migration never reads the row.
--
-- No change_number: this change has no roadmap row, so the Change gates page
-- names it by its folder.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name)
values
  ('outside-tap-closes', 'OT', 'change', 'Tap outside closes pop-ups',
   'Tapping the dimmed space outside a pop-up closes it, the same as its Close button.',
   'A pop-up closes only from its own buttons or Escape, as it does today.',
   'a-popup-closes-when-you-tap-outside-it');
