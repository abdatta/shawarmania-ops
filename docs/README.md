# Shawarmania Ops Wiki

This folder is the durable project wiki. It describes **what the app is and why** — in the present tense, with no change history. History lives in `openspec/changes/archive/`.

> These pages describe the system as designed and agreed — much of it now built and some of it live in production. Where a page describes something not yet implemented, it says so; the [roadmap](../openspec/changes/ROADMAP.md) is the authority on what is real versus demo-only.

## Start here

- [Project Overview](PROJECT_OVERVIEW.md) — what this app does, what it deliberately does not, and the principles behind that line.
- [Business Context](BUSINESS_CONTEXT.md) — Shawarmania itself: outlets, menu, payment rails, how a counter shift actually runs.
- [Glossary](GLOSSARY.md) — domain terms defined once. Read this before the data model.

## How it is built

- [Architecture](ARCHITECTURE.md) — runtime shape, layers, data flow, and why the stack is what it is.
- [Data Model](DATA_MODEL.md) — tables, keys, invariants, and the two modelling traps in this domain.
- [Roles And Permissions](ROLES_AND_PERMISSIONS.md) — four roles × capability matrix, mapped to Row-Level Security policies.
- [Demo Mode](DEMO_MODE.md) — the adapter seam and feature gating that let the whole UI be built and demonstrated before it is real.
- [Offline And Sync](OFFLINE_AND_SYNC.md) — the counter outbox, idempotency, conflict rules, failure modes.

## How it looks and behaves

- [Screens](SCREENS.md) — every screen, who sees it, what it does.
- [Design System](DESIGN_SYSTEM.md) — Shawarmania brand tokens mapped to an ops-portal semantic layer, with the contrast rules that keep it accessible.

## Running it

- [Operations](OPERATIONS.md) — environments, deployment, backups, onboarding a new franchise outlet.
- [Security And Privacy](SECURITY_AND_PRIVACY.md) — PII handling, employee monitoring, key management.
- [Testing](TESTING.md) — how to verify a change, including the tenancy isolation suite.
- [Limitations](LIMITATIONS.md) — known edges and deliberate non-features.

## The short version

Shawarmania runs quick-service shawarma counters in Kalyani and Kanchrapara and is selling franchises across West Bengal. This app is the operational spine for that: a biller rings up orders on a counter tablet that keeps working when the internet does not, outlet managers track stock, expenses, staff and daily cash on their phones, and the owner sees every outlet from one place — with the database itself guaranteeing that no outlet can read another's data.
