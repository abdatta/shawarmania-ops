## ADDED Requirements

### Requirement: A pop-up closes when the space outside it is tapped

A pop-up the person opened (a sheet, a confirmation, a number pad, an
explanation) SHALL close when a press and release both land on the dimmed space
outside it, through the same close its own Close button runs. A pop-up that
declines to close while it is saving SHALL decline this too, and a pop-up or
sheet with a save in flight SHALL ignore the tap even where its own Close or
Back button stays live. A pop-up's own padding is not outside it.

A press that starts inside a pop-up SHALL NOT close it however far it travels
before release. A press that begins within 400 ms of the pop-up opening SHALL
NOT close it, however long it is held.
A pop-up opened over another SHALL be closed alone by a tap on its own backdrop,
and the one beneath SHALL stay open.

The iOS install hint, a transient panel that is not a pop-up, SHALL close when a
pointer lands outside it, as a menu does.

This behaviour SHALL ship behind the change gate `outside-tap-closes`; with the
gate off a pop-up closes only from its own controls and Escape.

#### Scenario: A tap on the space outside a sheet

- **WHEN** a sheet is open and a person presses and releases on the dimmed space outside it
- **THEN** the sheet closes

#### Scenario: A tap on the pop-up's own padding

- **WHEN** a confirmation is open and a person taps its padding, between its text and its edge
- **THEN** the confirmation stays open

#### Scenario: A drag that ends outside

- **WHEN** a person presses inside a field in a sheet, drags past the sheet's edge and releases
- **THEN** the sheet stays open

#### Scenario: A double-tap on the button that opened it

- **WHEN** a pop-up opens from a button and the second tap of a double-tap lands on the backdrop within 400 ms
- **THEN** the pop-up stays open

#### Scenario: A pop-up opened over another

- **WHEN** an explanation is open over a sheet and a person taps outside the explanation
- **THEN** the explanation closes and the sheet stays open

#### Scenario: A pop-up that is saving

- **WHEN** a confirmation is busy with its request and a person taps outside it
- **THEN** it stays open

#### Scenario: A sheet that is saving

- **WHEN** a person has pressed Save on the Count & Collect sheet and taps outside it before the save returns
- **THEN** the sheet stays open with what they typed

#### Scenario: The gate is off

- **WHEN** the `outside-tap-closes` change gate is off and a person taps the space outside a pop-up
- **THEN** the pop-up stays open, and closes from its own Close button or Escape as before
