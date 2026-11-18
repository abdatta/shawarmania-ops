# Proposal: The Dish Description Wraps

> **Model**: Opus · **Kind**: small correction, not a roadmap change · **Gate**:
> **a long description in the Menu dish editor wraps onto new lines and the box
> grows with it**, and is still saved as one line, as every description is
> today

## Why

The dish editor's Description is a one-line input, so a description longer
than the box runs sideways out of sight while it is typed; the owner asked for
it to wrap and grow instead (2026-11-17). Menu's descriptions are a sentence
or two, and on a phone a one-line box shows a few words of them.

## What Changes

- The Description field becomes a text area that starts one line high, wraps,
  and grows with its text, through a new shared `TextArea` beside `Input`.
- **It stays one line of text.** Enter saves the form, as it did, and a pasted
  line break becomes a space. The counter, the receipt and the customer menu
  have only ever shown a description on one line, and a description saved
  with a line break in it would reach all three.

## Change gate

**No gate:** a revert is clean and the change is away from the counter. The
saved description is the same one-line string either way, so after a revert
the old build reads every description it reads today; nothing is queued or
stored in a new shape. The field is the manager's Menu editor, which the
counter and the kitchen never render.

## Non-goals

- Descriptions with paragraphs or line breaks. That would change what the
  counter, the receipt and the customer menu show, and is its own change.
- A length limit or counter on the description.
- Other one-line fields.
