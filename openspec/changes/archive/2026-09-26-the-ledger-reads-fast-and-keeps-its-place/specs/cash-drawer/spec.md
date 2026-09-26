## ADDED Requirements

### Requirement: Each part of the Drawer appears when its own reading does

The Drawer surface SHALL read its balance, its recent counts and its exceptions
independently, and SHALL present each as soon as its own reading is complete,
without waiting for the others. While a part is being read, the surface SHALL
show a placeholder in that part's own layout.

The action that records a count SHALL be available as soon as the balance is, and
SHALL NOT wait for the counts or the exceptions.

A part that cannot be read SHALL say so in its own place, and SHALL NOT withdraw
the parts that were read.

#### Scenario: The balance arrives first

- **WHEN** the balance has been read and the recent counts have not
- **THEN** the balance card and the count action are shown, and the counts show their placeholder

#### Scenario: The counts arrive first

- **WHEN** the recent counts have been read and the balance has not
- **THEN** the counts are shown, and the balance shows its placeholder

#### Scenario: One part fails

- **WHEN** the exceptions cannot be read
- **THEN** the balance and the counts are still shown, and the failure is stated
