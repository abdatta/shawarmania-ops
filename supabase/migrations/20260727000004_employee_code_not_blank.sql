-- A staff code cannot be blank.
--
-- `employee_code` is not null, which stops the column being absent and does
-- nothing about it being empty — and an empty string satisfies a not-null
-- constraint while satisfying nothing a person needs. That code is how a
-- payroll record is identified for years; the roster screen says as much when
-- it refuses to let one be edited.
--
-- The hole became reachable when outlet-and-staff-setup let the account form
-- create a roster row alongside an Employee account: the roster choice defaults
-- to "add them to the staff list", so an admin who never noticed the staff-code
-- field would have written a nameless row without being told. The forms now
-- refuse it too — this is the boundary, and that is the convenience.
--
-- Same shape as attendance_override_reason_not_blank, and for the same reason:
-- a blank required field is not a value, it is a missing one.

alter table public.employees
  add constraint employees_code_not_blank
  check (length(btrim(employee_code)) > 0);
