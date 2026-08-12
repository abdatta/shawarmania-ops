-- Assignment history is recorded in the business's calendar, not the
-- database session's calendar. Between midnight and 05:30 in Kolkata,
-- PostgreSQL's default UTC current_date is still yesterday; ending an
-- assignment that started today then violates assignments_dates_valid.
--
-- Keep the already-reviewed transactional command bodies intact and make
-- their existing current_date expressions explicit about the calendar they
-- mean. Function SET settings are scoped to the invocation and restore the
-- caller's session setting afterwards.

alter function public.edit_account_assignment_set(
  uuid, uuid, text, text, text, text, text, jsonb, uuid, text, interval
) set timezone = 'Asia/Kolkata';

alter function public.mark_account_as_left(uuid, uuid, text)
  set timezone = 'Asia/Kolkata';

-- The transition functions compare a fingerprint computed inside their
-- Kolkata-scoped invocation with one computed by the preceding read. A live
-- invite contributes a timestamptz to that digest, whose JSON rendering would
-- otherwise change with the caller's timezone and look spuriously stale.
-- Canonical UTC makes the opaque digest identical in every session.
alter function public.account_state_fingerprint(uuid)
  set timezone = 'UTC';

comment on function public.edit_account_assignment_set(
  uuid, uuid, text, text, text, text, text, jsonb, uuid, text, interval
) is
  'Service-only atomic profile plus complete intended live assignment-set transition with stale-state and actor-authority validation; assignment history dates use the Asia/Kolkata calendar.';

comment on function public.mark_account_as_left(uuid, uuid, text) is
  'Service-only explicit departure: end every live assignment on the Asia/Kolkata calendar and deactivate sign-in atomically.';
