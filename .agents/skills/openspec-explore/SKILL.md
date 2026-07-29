---
name: openspec-explore
description: Enter a read-only exploration stance for thinking through ideas, investigating the codebase, comparing approaches, and clarifying an OpenSpec change without implementing it. Use when the user asks to explore, brainstorm, reason deeply, investigate before proposing, or invokes "/opsx:explore".
---

# Explore OpenSpec

Think deeply, visualize freely, and follow useful threads without implementing
application or infrastructure changes.

## Stance

- Be curious rather than prescriptive.
- Open several relevant directions without turning the conversation into an
  interrogation.
- Ground reasoning in the actual repository.
- Challenge assumptions, including the user's and your own.
- Use compact diagrams, state machines, data flows, or comparison tables when
  relationships are easier to see than describe.
- Let uncertainty remain visible instead of rushing to a conclusion.

## Read-Only Boundary

You may:

- Read files and search code.
- Run non-mutating inspection commands.
- Map architecture and integration points.
- Compare approaches and surface risks.
- Create or update OpenSpec proposals, designs, specs, or tasks only when the
  user explicitly asks to capture the thinking.

You must not:

- Implement code or features.
- Change configuration, migrations, tests, or application files.
- Auto-capture conclusions into artifacts.

If the user asks for implementation while this skill is active, explain that
they must exit the exploration stance and create or select a change proposal
first.

## Establish Context

Start with:

```bash
openspec list --json
```

If the user mentions a specific active change, run:

```bash
openspec status --change "<name>" --json
```

Use `changeRoot`, `artifactPaths`, and `actionContext` from the result. Read
existing outputs from the resolved paths; do not guess their locations.

For archived changes, resolve them from the repository's archive structure and
treat them as immutable context.

## Explore Naturally

Depending on the question:

- Reframe the actual problem.
- Trace current behavior through UI, adapters, policies, schema, and tests.
- Identify historical constraints that may no longer apply.
- Compare options against the North Star and hard rules.
- Separate product requirements from implementation accidents.
- Call out security, tenancy, money, time, offline, privacy, and operability
  consequences when relevant.
- Suggest a spike or investigation when evidence is missing.

When a decision crystallizes, offer to capture it:

| Insight | Artifact |
|---|---|
| Scope change | `proposal.md` |
| Design decision | `design.md` |
| Requirement change | capability delta spec |
| New work | `tasks.md` |

The user decides whether to write it.

## Ending

There is no required output. Exploration may end with a recommendation, open
questions, an offer to create a proposal, or simply clearer understanding.
