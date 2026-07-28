## ADDED Requirements

### Requirement: A placeholder never reads as a value already filled in

A placeholder that shows an **example of the value** SHALL be marked as an
example, so that it cannot be mistaken for content already entered. It SHALL
NOT be the exact name of a real record that exists in the same database, since
that is the case most likely to be read as a value rather than a hint.

A placeholder that supplies the **accessible name of an input with no visible
label** SHALL NOT be marked as an example, because it is doing the work of a
label rather than suggesting a value. A format mask and an instruction are
likewise not examples.

The distinction is the requirement. A blanket convention applied to both kinds
would make labels incoherent, and applying none is what allowed an outlet to be
created with no name.

#### Scenario: A sample value is recognisable as a sample

- **WHEN** a form field's placeholder shows an example of what to type
- **THEN** it is presented as an example rather than as a bare value

#### Scenario: A placeholder standing in for a label is left alone

- **WHEN** an input has no visible label and its placeholder supplies its
  accessible name
- **THEN** that placeholder names the field plainly, with no example marking

#### Scenario: No placeholder names a real record

- **WHEN** any placeholder in the app shows a sample value
- **THEN** it is not the exact name of a record that exists in the database
