-- a-tablet-keeps-its-login: a set-up tablet opens only its own counter or
-- kitchen page, and nobody can sign in as a person on it.
-- change-gate: a-tablet-keeps-its-login
--
-- The gate's row and nothing else. The boundary and the sign-in refusal are
-- client code; no table, policy or function changes. No roadmap row, because it
-- corrects shipped behaviour, so `change_number` is null.

insert into public.change_gates
  (key, code, kind, title, on_means, off_means, change_name, change_number)
values
  ('a-tablet-keeps-its-login', 'TK', 'change', 'A tablet keeps its login',
   'A set-up tablet opens only its own counter or kitchen page, whatever address it is given, and nobody can sign in as a person on it.',
   'A set-up tablet can still open the sign-in and activation pages, and a person signing in there replaces the tablet''s login.',
   'a-tablet-keeps-its-login', null);
