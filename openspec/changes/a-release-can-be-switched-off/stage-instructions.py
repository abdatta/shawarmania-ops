"""Task 9.11 of a-release-can-be-switched-off: every instruction that pushes or
releases moves to `stage`, in one commit, pushed to `stage` just before the `main`
ruleset is turned on. Run from the repository root:

    python openspec/changes/a-release-can-be-switched-off/stage-instructions.py
"""
import pathlib


def edit(path, *pairs):
    p = pathlib.Path(path)
    t = p.read_text(encoding='utf-8')
    for old, new in pairs:
        assert t.count(old) == 1, f'{path}: {old[:70]!r}'
        t = t.replace(old, new, 1)
    p.write_text(t, encoding='utf-8', newline='\n')


# ── AGENTS.md ─────────────────────────────────────────────────────────────────
edit(
    'AGENTS.md',
    (
        "**When a change archives, its spec delta merges into `openspec/specs/` and every affected `docs/` page updates in the same change.**",
        """**Every commit goes to `stage`, never to `main`.** Push with `git push origin HEAD:stage` from whatever local branch you are on. `main` is protected by a ruleset: only Promote and Hotfix move it, each with the owner's approval in GitHub, so a push to `main` is refused. **A push to `stage` reaches staging only** — Staging runs the whole suite, migrates the staging project and publishes `stage-ops.shawarmania.in` — so it is safe at any hour, including during service. **A promotion is the release**: it fast-forwards `main` to a commit staging verified, and Deploy publishes it to the counters. It keeps every rule a push to `main` had, the deploy window above all: never while the counter trades. See [Releases](docs/RELEASES.md#staging).

**When a change archives, its spec delta merges into `openspec/specs/` and every affected `docs/` page updates in the same change.**""",
    ),
    (
        "`verify.yml` is the one definition of the suite, and nothing triggers it directly. Two workflows call it: `ci.yml` on every pull request, and `deploy.yml` on every push to `main`,",
        "`verify.yml` is the one definition of the suite, and nothing triggers it directly. Three workflows call it: `ci.yml` on every pull request, `staging.yml` on every push to `stage`, and `deploy.yml` on every push to `main` — which only Promote and Hotfix make, and which skips the suite for a commit Staging already verified —",
    ),
    (
        "- **The life of a change:** propose (with its Change gate section) → the owner approves the demo, which runs it on → apply (gate and migration row first, off path untouched) → verify, both states → deploy, which ships it **off** →",
        "- **The life of a change:** propose (with its Change gate section) → the owner approves the demo, which runs it on → apply (gate and migration row first, off path untouched) → verify, both states → push to `stage`, where Staging verifies it and publishes the staging site → the owner tries it on the fake outlet → the owner approves a Promote, which deploys it to the counters **off** →",
    ),
    (
        """**Why pushing early is safe here.** `deploy.yml` declares `migrate: needs: gate`
and `deploy: needs: [gate, build, migrate]`. A red gate publishes nothing and
migrates nothing, and the build already on the counter stays live.""",
        """**Why pushing early is safe here.** A push goes to `stage` and reaches staging
only; production moves when the owner promotes. And `staging.yml`, like
`deploy.yml`, declares `migrate: needs: [awake, gate]` and publishes only after
both: a red gate publishes nothing and migrates nothing.""",
    ),
)

# ── CLAUDE.md ─────────────────────────────────────────────────────────────────
edit(
    'CLAUDE.md',
    (
        "- **Where is the truth?**",
        "- **Where does a commit go?** To `stage` (`git push origin HEAD:stage`), never `main`. Staging verifies it; the owner promotes it to the counters. See [`docs/RELEASES.md`](docs/RELEASES.md#staging).\n- **Where is the truth?**",
    ),
)

# ── The quickfix lane ─────────────────────────────────────────────────────────
edit(
    '.claude/skills/quickfix/SKILL.md',
    (
        """Commit in the repo's voice, describing what was wrong and why the fix is shaped
as it is. Push only when the user has asked for it, and treat reaching
production as the outward-facing act it is.

Then `gh run watch <id> --exit-status`, and check the deployed build actually
carries the commit (`build-version` on the shell reads `Build <sha>`). If CI goes
red, fix forward: nothing published.""",
        """Commit in the repo's voice, describing what was wrong and why the fix is shaped
as it is. Push only when the user has asked for it, and only to `stage`:
`git push origin HEAD:stage`. A push to `main` is refused by its ruleset.

Then `gh run watch <id> --exit-status` on the Staging run, and check the staging
build carries the commit (`build-version` on `stage-ops.shawarmania.in` reads
`Build <sha>`). If it goes red, fix forward: nothing published. The fix reaches
the counters when the owner approves a Promote of that commit — tell them it is
ready, and remember a promotion is the release: never while the counter trades.
If the counter is down, the way out is Hotfix, not waiting for Promote.""",
    ),
)

# ── docs/RELEASES.md ──────────────────────────────────────────────────────────
edit(
    'docs/RELEASES.md',
    (
        "| 5 | Deploy | It reaches production **off**. | `deploy.yml` |",
        """| 5 | Stage | A push to `stage`. The suite runs, then staging is migrated and published. Safe at any hour: no tablet at an outlet reads staging. | `staging.yml` |
| 5a | Try on staging | The owner turns the gate on in staging's Change gates page and runs the fake outlet — a laptop as the counter, a laptop as the kitchen, their phone as owner. Trouble: fix, push to `stage` again. | the owner; `npm run test:e2e:staging` |
| 5b | Promote | The owner approves a Promote of that exact commit; `main` fast-forwards to it and Deploy publishes it, **off**. Promotion is the release, so it happens in the owner's deploy window. | `promote.yml`, the `main` ruleset, `deploy.yml` |""",
    ),
    (
        "## Retiring a gate\n",
        """## Staging

A separate Supabase project, in a separate Supabase account, on the same plan and
compute size as production, published from the `stage` branch to
`stage-ops.shawarmania.in`. Every screen carries the band **Staging · not a real
outlet**, and the installed app is called *Shawarmania Ops (staging)*. Its data is
synthetic and at production's scale; no production row is ever copied there; and
it holds none of the third parties' secrets, so it can text no phone and reach no
restaurant account ([Operations](OPERATIONS.md#never-configured-on-staging)).

**How a commit gets there.** Every commit is pushed to `stage`. Staging runs the
suite, migrates the staging project, seeds it if it holds no Test Cafe, deploys its
Edge Functions, publishes a staging build, and runs the smoke suite against it. A Free project pauses after a
week without a push; Staging then stops with one sentence saying to resume it from
the staging account's dashboard.

**Running the fake outlet.** On staging, from the owner's phone: create an outlet
— or use *Test Cafe*, which the seed made — and on Outlets → the outlet → Tablets,
issue a setup code; type it on laptop 1 at the staging address and it becomes the
counter. Do the same for laptop 2 as a kitchen. Open each one's shift with the
handshake: the laptop asks for a username and shows four digits, which the person
types on their own phone. Then turn the gate under test on from staging's Change
gates page and ring orders, acknowledge them and take payments as staff would, for
as long as it takes to trust it. With **Tablet health** on, the gate's page shows
both laptops' requests a minute beside the budget's numbers.

**How an agent verifies on staging.** Not by typing a password into a browser:
`npm run test:e2e:staging`, with `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`
and `STAGING_TEST_PASSWORD` in the environment. It walks the owner, a manager, a
counter and a kitchen through one order, one acknowledgement, one payment and one
change-gate turn on *Test Cafe*, checking the band on each, and leaves both shifts
at the end.

**Promoting.** Actions → Promote → Run workflow, with the commit's full SHA, or
nothing for `stage`'s tip. It refuses a commit no Staging run passed and one `main`
cannot fast-forward to, then lists every commit it would carry with its change
folders. GitHub holds the push until the owner approves it in the
`production-promote` environment. Deploy then finds Staging's run for the commit,
skips the suite, and migrates, deploys functions and publishes in a few minutes.
Because history is linear, a promotion carries everything beneath its commit;
because every behaviour change ships off, carrying a change staged but not yet tried
is safe, and the summary lists it.

**Starting over.** Actions → Staging reset wipes staging's database, re-applies every
migration on `stage`, and re-runs `scripts/seed-staging.mjs`: *Test Cafe*, a test
account for every role, a counter and a kitchen tablet, and about three thousand
bills rung through the counter's own command.

**Reading the protections.** No file can prove them, so read them:

```bash
gh api repos/abdatta/shawarmania-ops/rulesets
gh api repos/abdatta/shawarmania-ops/environments/production-promote --jq '.protection_rules'
```

The `main` ruleset must refuse direct pushes, force pushes and deletion, with the
deploy key its only bypass; `stage`'s must refuse force pushes and deletion; and
`production-promote` and `production-hotfix` must each name the owner as required
reviewer.

## Retiring a gate
""",
    ),
)

# ── docs/OPERATIONS.md ────────────────────────────────────────────────────────
edit(
    'docs/OPERATIONS.md',
    (
        "| **Staging** | Verification before release | Separate Supabase project, synthetic data only |",
        "| **Staging** | Verification before release, and the owner's fake outlet | Separate Supabase project in a separate account, synthetic data at production's scale, published from `stage` to `stage-ops.shawarmania.in` |",
    ),
    (
        "Staging is still not provisioned; changes go from local to production, which is acceptable at this size and worth revisiting before the next franchise.",
        "**Staging is provisioned** (see [Releases](RELEASES.md#staging)): every commit is pushed to `stage`, verified and published there, and reaches production only when the owner approves a Promote.",
    ),
    (
        "Hosting is **GitHub Pages**, published by `.github/workflows/deploy.yml` on\nevery push to `main` that passes verification.",
        "Hosting is **GitHub Pages**, published by `.github/workflows/deploy.yml` on\nevery push to `main` that passes verification. Only Promote and Hotfix push to\n`main`, each with the owner's approval; `main`'s ruleset refuses anything else.",
    ),
)
print('9.11 edits applied')
