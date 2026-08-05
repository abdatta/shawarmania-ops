## 1. Reproduce

- [x] 1.1 Pin the late tag's position with a test that asserts it precedes the verdict text, and watch it fail against the current order.
- [x] 1.2 Pin the by-staff narrowing with a test that selects one outlet and asserts the other outlet's staff are not offered, and watch it fail against the current picker.

## 2. The late tag reads first

- [x] 2.1 Render `LateTag` before the verdict span in `DayVerdict`, and say in the comment why the qualifier leads.

## 3. One outlet scope above both axes

- [x] 3.1 Move the outlet chips into `PageHeader`'s `scope` slot and render them on both axes.
- [x] 3.2 Replace the axis buttons with the Ledger's segmented control, rename **By outlet** to **By day**, and rename the test id to match.
- [x] 3.3 Hand `StaffAxis` the narrowed people while keeping it every outlet the reader may see, so the month is still assembled across all of them.
- [x] 3.4 Derive the subject from the narrowed list, so a person the selection removes cannot stay the subject of the read.
- [x] 3.5 Confirm the surface's shimmer still matches the shape that arrives under it, since the controls above it moved.

## 4. Pin it

- [x] 4.1 Assert the chips are present on both axes, replacing the test that asserted their absence on by staff.
- [x] 4.2 Assert a narrowed person's month still spans both outlets and the read still names no outlet.
- [x] 4.3 Assert a subject narrowed away is replaced rather than kept.

## 5. Trim the captions the new header made redundant

Asked for while the header was being rebuilt, and kept in this change because
they are the same header.

- [x] 5.1 Drop the **Whose attendance** caption above the person picker, keeping it as the control's accessible name — a combobox showing a person's name under a tab reading By staff was already saying it.
- [x] 5.2 Replace the page subtitle. *"Who was here, and where they were"* described the surface to somebody who had not looked at it; the segmented control beneath it is the part that is genuinely not obvious, so the line now names the two axes.
- [x] 5.3 No tests for either: both are copy, and the picker's accessible name is the only behaviour in reach.

## 6. Make lateness demonstrable on any date

Found while verifying the late tag: the demo could not show one. The only late
seed sat eight days back and the by-staff axis reads a calendar month, so for
the first eight days of every month the demo showed `0 Late` for everybody.

- [x] 6.1 Move a late day close to today on the Employee persona's month, so the current month reaches it from the 4th rather than the 9th. The deep one stays; a month wants more than one to read as a pattern.
- [x] 6.2 Add a late day to the roll-call one step back. By day is the default axis and today cannot carry one — Kalyani's deadline is 13:00, so a late arrival today does not exist until the afternoon.
- [x] 6.3 Pin it with a test that reads the roll-call for the last three business days and asserts one of them is late, judged against each row's **own** outlet's deadline. Proved failing first: `expected [] to not have a length of +0`.
- [x] 6.4 Record the rule in the fixture file's header, since it is the thing nobody had written down: a state the demo exists to show belongs on a small offset.

## 7. Record what changed

- [x] 7.1 `docs/SCREENS.md`: the outlet choice scopes the surface and both axes; the by-day axis is named By day.

## 8. PHASE GATE

- [x] 8.1 **Gate**: the outlet chips sit in the Attendance header, stay put across both axes, and narrow who By staff offers, while a selected person's month still spans every outlet the reader may see; the late tag reads before the verdict wherever attendance is rendered; and the four-role demo walkthrough still walks. Run `npm run typecheck`, the attendance test files, `npm run format:check`, and let CI run the rest.
