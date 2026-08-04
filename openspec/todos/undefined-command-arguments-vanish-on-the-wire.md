# A command argument that is unknown may be vanishing on the wire

**Type**: Verification gap · **Status**: Open · **Area**: Data access

## What happens

One family of database commands lost every argument it had nothing to say about.
Where a value was unknown, the payload left the property `undefined`, JSON
serialisation dropped the key entirely, and the command function — which requires
that fact and offers no default for it — matched nothing at all. The backend
answered that it could not find the command, and the person was shown a message
inviting them to try again, for a write that had not happened and never would.

Attendance had it in two places (check-in and approval taken with no location),
found in production on 2026-08-04 and fixed in
`attendance-position-free-commands`. **Nothing has established that attendance was
the only place.**

## Why it matters

The failure mode is quiet in exactly the wrong way. It is invisible to the mock
adapter and every component suite, because those are handed the object rather
than the JSON that goes over HTTP. It is invisible to the database suites, where
a missing argument is not something anybody would write. And it only ever fires
on the path where something is genuinely unknown — the drawer nobody counted, the
note nobody wrote, the position no phone could find — which is the path least
likely to be exercised deliberately and most likely to be somebody's bad day.

It also reads to the person as a broken app rather than a missing value, so the
first report will describe the wrong problem.

## What to look for

Any command payload that derives a value from an optional chain, an optional
property, or a conditional, and any cast that silences the generated argument
types over one. The attendance version looked like this:

```
p_lat: reading?.latitude as number
```

Two questions per site: can this expression be `undefined`, and does the command
declare a default for that argument? Either answer being no makes it safe; both
being yes makes it this bug.

## Constraints on any fix

- The rule already stated in `docs/ARCHITECTURE.md` is the target: state every
  argument explicitly, including the unknown ones, because an omitted key is not
  a null.
- Giving the database defaults instead is the wrong direction. A required
  argument is the schema insisting a fact be stated, and a default turns a caller
  that forgot into a row that lies quietly.
- Whatever is found needs coverage over the real transport, not against a mock.
  A payload assertion is the cheapest form and cannot be fooled.

## Trigger

Before the next `*-live` change ships a new command family, or immediately if
anybody reports an action that fails while writing nothing.
