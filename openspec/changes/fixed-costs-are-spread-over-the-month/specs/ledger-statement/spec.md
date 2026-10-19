## ADDED Requirements

### Requirement: The current month reads both P&Ls and the fixed costs behind them

Where the outlet has a fixed cost active in the month shown, and the month shown
is the current month, the Ledger's month reading SHALL show, in this order: P&L;
the fixed costs owed so far and unpaid; P&L (Pro-rata); the month's fixed costs in full; how much of them the month's
trading covers so far, as a percentage and a bar capped at 100%; how far that
trading is short of covering the month's fixed costs in full, named for the
month, until it covers them; and what is still to pay. It SHALL then list each fixed cost with its cost this month, what
is paid and what is owed, each linking to that fixed cost's page.

A past month SHALL read as it does without fixed costs. The category breakdown
SHALL keep every recorded expense, fixed-cost payments included, so that it adds
up to recorded expenses in every month.

The month SHALL still settle in at most two round trips: the fixed costs SHALL be
read alongside the month's existing read, not after it.

#### Scenario: The 18th of a month with fixed costs

- **WHEN** the owner opens the Ledger's October on 18 October with ₹3,22,700 of
  fixed costs set up and none paid, and P&L of ₹1,89,368
- **THEN** it shows P&L, *Fixed costs owed so far, unpaid* ₹1,87,374, P&L (Pro-rata), *Fixed costs this month* ₹3,22,700, the covered percentage,
  *Short of covering October* ₹1,33,332 and *Still to pay* ₹3,22,700, then each fixed cost

#### Scenario: Last month, after it ended

- **WHEN** the owner opens September on 18 October
- **THEN** it shows P&L and no P&L (Pro-rata), covered bar or fixed costs group

### Requirement: A fixed-cost payment reads as its fixed cost on the month's lines

On the month reading's expense lines, an expense linked to a fixed cost SHALL
read the fixed cost's name with its category in brackets, or the name alone
where the two are one word, with a **Fixed** chip drawn as the Cash chip is, and
the day it was paid where that differs from the day it counts in. The name,
category and chip SHALL come from the link, not from the expense's text.

#### Scenario: A salary counted in October, paid in November

- **WHEN** October's lines include Nayan's ₹20,000 paid on 2 November and counted on 31 October
- **THEN** the line reads *Nayan (Salary)*, **Fixed**, *paid 2 Nov*
