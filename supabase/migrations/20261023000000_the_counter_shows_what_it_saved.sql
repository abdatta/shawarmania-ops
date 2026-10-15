-- change-gate: instant-saves
--
-- The counter shows what it saved (the-counter-shows-what-it-saved). The gate's
-- row, off, and its dependencies on both of #74's gates. Nothing else: the on
-- path reads only what the tablet already holds, so it needs no table, column,
-- function, policy or trigger.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('instant-saves', 'IS', 'change', 'Instant saves',
   'The counter shows an order, an edit or a payment the moment the tablet has saved it, and checks with the server afterwards.',
   'The counter shows an order, an edit or a payment once it has asked the server again, which takes a moment on a slow connection.',
   'the-counter-shows-what-it-saved', null);

insert into public.change_gate_dependencies (gate_key, depends_on)
values
  ('instant-saves', 'dish-ticks'),
  ('instant-saves', 'kitchen-ready');
