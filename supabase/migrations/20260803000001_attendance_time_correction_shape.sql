-- An effective-time correction is a manager decision, never an edited attempt.
-- Add the enum value in its own migration so PostgreSQL commits it before the
-- following migration uses it in constraints and command code.
alter type public.attendance_decision_kind add value if not exists 'correct_time';

alter table public.attendance_decisions
  add column previous_check_in_at timestamptz,
  add column new_check_in_at timestamptz;
