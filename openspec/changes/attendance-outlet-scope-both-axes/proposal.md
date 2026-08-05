# Proposal: One Outlet Scope Above Both Attendance Axes

> **Model**: Opus · **Kind**: small correction with one deliberate contract reversal, not a roadmap change · **Gate**: **the outlet chips sit in the Attendance header, stay put across both axes, and narrow who By staff offers — while a selected person's month still spans every outlet the reader may see**, the late tag reads before the verdict it qualifies wherever attendance is rendered, and the four-role demo walkthrough still walks.

## Why

Attendance's header had grown three stacked full-width strips — axis buttons,
outlet chips, day picker — where the Ledger next door says the same kind of
thing in a header slot and one segmented control. The owner asked for the two to
match, and they should: they are the same reader answering the same question
about the same shops on the same phone.

Matching them means moving the outlet chips above the axis control, and that
placement is a claim: chips above the tabs scope the page, not the tab. The
owner has decided the claim should be true. So By staff now narrows to the
selected outlets' staff, reversing design D4 of
`attendance-one-day-per-person` — a decision made for a reason that is recorded,
weighed and answered in `design.md`, not one being forgotten.

Separately and unrelated: the late tag rendered *after* the verdict, so a row
read "Present · late" with the qualifier trailing the thing it qualifies. It
reads better in front, and it is one line of JSX in the component every
attendance surface shares.

## What Changes

- The outlet chips move into the Attendance page header, beside the title, where
  the Ledger keeps them. They are present on both axes and never move.
- The axis control becomes the Ledger's segmented control, and **By outlet** is
  renamed **By day** — the axis is one business date across whichever shops are
  selected, and "outlet" naming a tab beside the outlet chips said the choice
  was the tab's.
- **The outlet selection narrows the By staff person picker** to people holding
  a staff assignment at a selected outlet. It does **not** narrow a selected
  person's month: the range read still names no outlet, so somebody who moved
  between two shops keeps one continuous month.
- The late tag renders before the verdict it qualifies, on every surface that
  shows one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `attendance-and-location`: the outlet selection becomes scope for the whole
  surface rather than for the by-outlet axis alone, and narrows who the by-staff
  axis offers. The guarantees underneath it are untouched — the by-staff read
  still names no outlet, the database still resolves the reader's reach from
  their own live assignments, and a person's month still spans every outlet that
  reader may see.

## Impact

Two files of UI (`outlet-attendance.tsx`, `evidence.tsx`), their tests, one
`docs/SCREENS.md` paragraph, and one requirement plus one scenario in the
attendance spec. No schema change, no migration, no policy change, no adapter
change, no gate change. The reads each axis makes are byte-for-byte what they
were.

## Non-goals

- Narrowing the by-staff **read**. `listPersonRange` still names no outlet and
  the policies still decide what comes back; a hand-crafted request naming an
  outlet the reader holds no assignment at is refused exactly as before.
- Truncating a person's month to the selected outlets. That would break the one
  question the axis exists to answer.
- Touching the employee's own attendance view, which has no outlet scope to
  apply.
- Reshaping the Ledger, which is the surface being matched, not changed.

## Docs to update before archive

`docs/SCREENS.md` — the Attendance entry describes the axis choice as coming
before the outlet choice, which is no longer how the surface is laid out.
