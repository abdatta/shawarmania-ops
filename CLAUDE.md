# Claude Code Guide

Read [`AGENTS.md`](AGENTS.md) — it is the single agent contract for this repo, and it applies to Claude Code, Codex, and any other agent working here.

Quick orientation:

- **What is this?** A multi-outlet cash-counter and outlet-management PWA for Shawarmania. Under active roadmap-driven implementation: attendance is live in production, the four-role UI is demonstrable end to end, and billing/expenses/cash/owner-console are being swapped from mock to live per the roadmap.
- **What do I work on?** Run `/next-change`. It derives the recommendation from the roadmap and change folders, live.
- **How do I make a change?** `/opsx:propose` → `/opsx:apply` → `/opsx:archive`. No code change without a change folder. `/propose-apply-verify <name>` runs the first two plus an autonomous verification loop in one go.
- **It's a bug, not a change?** Run `/quickfix`. Same rules, a fraction of the ceremony, and it hands itself back for anything touching migrations, policies, money, offline or the demo seam.
- **Where is the truth?** `docs/` for what the app is, `openspec/specs/` for what it must do, `openspec/changes/` for what's changing.

Two rules worth loading before you touch anything: **outlet isolation is enforced in the database, not the UI**, and **money is integer paise, never floats**. The rest are in [`AGENTS.md`](AGENTS.md).
