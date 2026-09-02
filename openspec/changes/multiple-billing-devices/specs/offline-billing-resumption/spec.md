# Delta: offline-billing-resumption

This capability landed with `#34 extended-offline-billing` and was written
per-tablet throughout: a record is used only where its tablet "is this
installation, and no other", and a record naming another tablet already opens
nothing. Two tablets at one outlet therefore need no correction to it.

What they need is the one fact a single tablet could not expose. A resume record
holds the **outlet's** pipeline, which since `#45` includes the neighbouring
tablet's orders, so resuming offline hands a tablet a remembered list of work it
may see and may not touch, with no server to ask. That is added here rather than
assumed.

## ADDED Requirements

### Requirement: A resume record is one tablet's, and a remembered pipeline is still not its own

Each tablet SHALL write, read, correct and discard only the resume record it
wrote itself. Two tablets at one outlet SHALL each resume from their own record,
including where the same person holds a shift on both for the same business date:
a shared outlet and a shared operator SHALL NOT make one record readable by the
other tablet.

**A remembered pipeline does not widen what a tablet may do.** The outlet
pipeline in a resume record holds every open order at that outlet, the
neighbouring tablet's included. Resuming offline SHALL present them exactly as an
online counter does, and SHALL refuse revise, pay, cancel and preparation on an
order this tablet does not own **locally**, without reaching the server. Offline
SHALL never be the state in which ownership stops being enforced.

**A remembered pipeline is a read, not the outlet's present.** It SHALL carry the
read time it was captured at, and SHALL NOT be presented as the outlet's current
work. It MAY omit orders the neighbour took afterwards and MAY still show orders
the neighbour has since been paid for or had cancelled; neither SHALL be treated
as a conflict to reconcile, because the server's pipeline replaces it on the
first successful read.

One tablet's drain leader, retry classification and needs-attention queue SHALL
reach only that tablet's own captured commands.

#### Scenario: Both tablets cold-start during one outage

- **WHEN** two tablets at one outlet, each holding an approved shift, are both reloaded with no backend reachable
- **THEN** each reopens its own shift from its own record with its own captured work, and neither reads, drains or discards anything belonging to the other

#### Scenario: One person holds a shift on both tablets

- **WHEN** the same operator's approved shifts are live on two tablets at one outlet and both cold-start offline
- **THEN** each tablet resumes the shift it actually opened, and neither record opens a counter on the other tablet

#### Scenario: An offline tablet acts on the neighbour's remembered order

- **WHEN** a resumed offline tablet attempts to revise, pay, cancel or mark prepared an order created by the other tablet
- **THEN** it is refused locally with no server reachable, and no command is captured for delivery

#### Scenario: The neighbour kept trading through the outage

- **WHEN** a tablet resumes from a record captured before the other tablet took three further orders and settled one
- **THEN** its pipeline is labelled with its read time rather than shown as current, and the server's pipeline replaces it on the first successful read without either tablet's accepted work being lost or double counted
