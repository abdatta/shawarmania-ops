-- Finish the override -> approval rename.
--
-- `20260731000001` renamed `override_by` to `approved_by`, but `alter table
-- ... rename column` does not rename the foreign key Postgres had auto-named
-- after the old column. That left `attendance_override_by_fkey` sitting on a
-- column called `approved_by`: functionally correct, and the last piece of
-- override vocabulary in the live schema.
--
-- Nothing references the constraint by name, in application code or in tests,
-- so this is a pure rename with no behavioural change.

alter table public.attendance
  rename constraint attendance_override_by_fkey to attendance_approved_by_fkey;
