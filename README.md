# Shawarmania Ops

A cash-counter and outlet-management PWA for **Shawarmania** — "Kalyani's Premium Shawarma" — currently operating counters in Kalyani and Kanchrapara, West Bengal, and expanding through franchises.

The app handles counter billing, employee attendance, menu management, inventory, expense tracking, daily cash reconciliation, basic profit/loss estimates, and messaging between outlet managers and the owner. It supports many outlets while keeping each outlet's data strictly separate.

> **Status: pre-implementation.** This repo currently contains the documentation, specifications, and build roadmap. No application code has been written yet.

## What gets built

Four roles, each seeing only what they should:

| Role | Scope | Does |
|---|---|---|
| **Super Admin** | All outlets | Compares outlets, manages outlets and admins, reads every report, receives alerts |
| **Franchise Admin** | One outlet | Menu, inventory, expenses, cash, attendance, outlet P&L, raises alerts |
| **Biller** | One outlet, counter tablet | Rings up bills. Reads the menu, cannot edit it |
| **Employee** | Self | Checks in and out, views own attendance |

## Repo layout

```
AGENTS.md          The agent contract — read this first
docs/              The durable wiki: what the app is and why
openspec/
  specs/           What the system is contractually required to do
  changes/         What is changing right now
    ROADMAP.md     The build order, dependencies, and gates
    archive/       Every change ever made, dated
  todos/           Ideas not yet formal enough to sequence
.claude/           Slash commands and skills driving the spec workflow
```

## Start here

- **New to the project?** [`docs/README.md`](docs/README.md) is the wiki index. [`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md) is the shortest path to understanding scope.
- **Building something?** Run `/next-change` for the current recommendation, or read [`openspec/changes/ROADMAP.md`](openspec/changes/ROADMAP.md) directly.
- **Working on the business domain?** [`docs/BUSINESS_CONTEXT.md`](docs/BUSINESS_CONTEXT.md) records how the counter actually runs.

## Stack

React 19 + TypeScript + Vite (installable PWA) · Tailwind v4 + shadcn/ui · Supabase (Postgres, Row-Level Security, Auth) · offline-capable billing via an IndexedDB outbox.

Currency is Indian rupees, stored as integer paise. Time zone is Asia/Kolkata.
