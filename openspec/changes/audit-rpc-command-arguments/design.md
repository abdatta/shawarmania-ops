## Context

PostgREST resolves an RPC by its function name and the set of JSON keys sent.
JavaScript removes properties whose value is `undefined` during serialization,
so a caller can compile, satisfy a mock, and still name no database overload on
the wire. The position-free attendance fix pinned the two known instances, while
the repository now contains 38 browser and Edge Function RPC call sites that
have not been reviewed as one surface.

Browser calls use the generated `Database` type, but generation does not express
that a required Postgres parameter accepts SQL null; this is why the safe
attendance builders use `?? null` before a narrow cast. Privileged Edge Function
clients are intentionally service-role clients and are not parameterized by the
browser's generated type, so their payloads require the same review without that
compile-time help.

## Goals / Non-Goals

**Goals:**

- Establish that every current RPC request serializes every parameter the
  database requires.
- Distinguish an explicit unknown value from an intentional omission backed by
  a SQL default.
- Pin required-nullable paths where objects, mocks, and SQL-only tests cannot
  prove the wire shape.
- Leave a proportionate verification rule for new command families.

**Non-Goals:**

- Change SQL signatures, defaults, authority, RLS, or command semantics.
- Ban optional properties in table insert/update patches, where omission is a
  legitimate partial-write instruction.
- Build a generic parser that attempts to infer final SQL signatures across the
  migration history.
- Touch money arithmetic, the billing outbox, offline ordering, gates, or demo
  adapters.

## Decisions

### Audit the call surface against final signatures, not source spelling

The implementation will enumerate every `.rpc(...)` caller under browser data
access and Edge Functions, then compare its serialized argument set with the
generated final signature and, where typing is absent or ambiguous, the final
function exposed by the reset local database. Each parameter is classified as:

1. required and always present;
2. required but nullable, therefore explicitly present as a value or `null`;
3. optional because the database declares a default, therefore safe to omit.

The rejected alternative is scanning migrations textually. A function may be
replaced several times, so a textual inventory can validate an obsolete
signature and produce false confidence.

### Test the payload where uncertainty enters, then prove the real transport

For a required-nullable path, an adapter-level payload test will inspect the
serialized object and a REST-level test will exercise the empty/unknown variant
against the reset database. Existing tests may satisfy this requirement when
they assert successful persistence for that exact variant; rejection alone is
not proof because the original broken test rejected for the wrong reason.

The rejected alternative is relying on typecheck. A cast can hide `undefined`,
and generated RPC arguments do not encode SQL nullability faithfully enough to
represent the safe value without one.

### Keep prevention behavioral rather than syntax-based

The durable requirement is attached to each new command family: cover its
unknown/empty variant after JSON serialization and over the real transport.
There will be no global lint rule banning optional chains or conditional
spreads near an RPC. Those forms are correct for defaulted parameters, and a
syntax rule cannot know the difference without becoming a fragile SQL parser.

### Treat an empty audit as a valid result

If the full inventory finds no unsafe caller beyond the already-fixed attendance
paths, the change still lands the evidence and strengthened contract. Inventing
a code rewrite to make an investigation appear productive would add risk while
proving less.

## Risks / Trade-offs

- **A hand-maintained inventory could miss an indirect caller** → derive the
  inventory from repository-wide `.rpc(` search and reconcile its count in the
  task evidence.
- **An Edge Function caller has no generated argument type** → verify its final
  signature against the reset local database and exercise required-nullable
  variants through REST.
- **A test can pass because the command rejected** → require the expected
  successful row/result and assert the intended facts, not merely a status code.
- **The rule adds work to every new command family** → scope it to an
  empty/unknown variant whose serialization can differ, not duplicate every
  happy-path case.

## Migration Plan

There is no schema or data migration. Apply any caller correction and its test
together, run the targeted adapter and REST suites, then the standard non-DB and
database gates. Reverting the change restores only the previous callers and
tests; no persisted state requires rollback.

## Open Questions

None. If implementation discovers an unsafe RPC whose correction would change
domain behavior rather than only state an existing fact, stop and seed that
behavioral change separately.
