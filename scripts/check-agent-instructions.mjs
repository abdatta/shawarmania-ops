#!/usr/bin/env node
/**
 * Enforce that the agent workflow files stay honest about their toolchain, and
 * that the two copies of that workflow stay in correspondence.
 *
 * This repo drives OpenSpec through plain files: fixed folders under
 * `openspec/`, a `spec-driven` `config.yaml`, and `npm run roadmap:sync`. There
 * is no `openspec` CLI — not on PATH, not in `node_modules`, not in
 * `package.json`. The workflow files were vendored from upstream, where that
 * binary does exist, so for months every `/opsx:*` run spent a few failed calls
 * discovering its absence, explained the gap, then improvised a fallback —
 * differently each time, which is how change folders drift in shape. That was
 * stripped out; this check is what stops it coming back, because the upstream
 * files are the obvious thing to copy from the next time one needs editing.
 *
 * Two rules, and both are about drift rather than correctness:
 *
 *   - a **CLI invocation** — any `openspec <subcommand>` in an instruction file.
 *     Describing the CLI is fine and the stripped files do exactly that, in a
 *     table mapping what it would have returned to the constant it is here; what
 *     fails is telling an agent to *run* it.
 *   - a **lopsided workflow** — a workflow present in one tree and missing from
 *     the other. Claude reads `.claude/commands/opsx/`, Codex reads
 *     `.agents/skills/openspec-*`, nothing syncs them and no page documents the
 *     split, so an edit to one silently leaves the other behind. That asymmetry
 *     is invisible until the other agent behaves differently on the same repo,
 *     which reads as a model difference rather than a missing file.
 *
 * Deliberately not a content diff. The two trees are written for different
 * hosts — different frontmatter, `$skill` references against slash commands,
 * Codex's `update_plan` against Claude's TodoWrite — and demanding identical
 * prose would fail on every legitimate edit. The invariant worth holding is that
 * both trees cover the same workflows and neither reaches for a binary that
 * is not there.
 *
 * The sibling landing repo `shawarmania` is the counter-example that shapes the
 * first rule: it has the same workflow files and a real `@fission-ai/openspec`
 * dependency, so the CLI calls there are correct. The rule is local to this
 * repo's toolchain, not a judgement about the CLI.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CLAUDE_COMMANDS = '.claude/commands/opsx'
const AGENT_SKILLS = '.agents/skills'

/**
 * The workflows, by the name each tree spells them with. A workflow is listed
 * here once it exists in either tree; the check is that it exists in both.
 */
const WORKFLOWS = [
  { command: 'propose.md', skill: 'openspec-propose' },
  { command: 'apply.md', skill: 'openspec-apply-change' },
  { command: 'archive.md', skill: 'openspec-archive-change' },
  { command: 'explore.md', skill: 'openspec-explore' },
  { command: 'sync.md', skill: 'openspec-sync-specs' },
]

/**
 * An invocation is the bare or npx-prefixed binary followed by a subcommand.
 *
 * The trailing `\b` on the subcommand and the absence of `/` after `openspec`
 * are what keep `openspec/changes/` and `openspec/config.yaml` — paths, written
 * constantly in these files — from reading as calls.
 */
const CLI_CALL =
  /(?:^|[`\s(])(?:npx\s+|\.\/node_modules\/\.bin\/)?openspec[ \t]+(new|status|instructions|list|validate|archive|init|update|change|spec|show|diff|doctor|context|view|store|workset|schema|config)\b/

/**
 * Files whose body is instructions to an agent, in either tree.
 *
 * Paths are emitted with forward slashes on every platform: they are printed as
 * `path:line` for the reader to open, and a Windows-shaped path is not clickable
 * in the terminals this repo is developed in.
 */
function instructionFiles(root) {
  const files = []

  const commandsDir = resolve(root, CLAUDE_COMMANDS)
  if (existsSync(commandsDir)) {
    for (const name of readdirSync(commandsDir)) {
      if (name.endsWith('.md')) files.push(join(CLAUDE_COMMANDS, name))
    }
  }

  for (const [dir, prefix] of [
    [resolve(root, AGENT_SKILLS), AGENT_SKILLS],
    [resolve(root, '.claude/skills'), '.claude/skills'],
  ]) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const skill = join(prefix, name, 'SKILL.md')
      if (existsSync(resolve(root, skill))) files.push(skill)
    }
  }

  return files.map((path) => path.split('\\').join('/')).sort()
}

/**
 * The exported rule, taking its input rather than reading it, so the test can
 * drive it without a fixture tree on disk.
 */
export function findInstructionDrift({ sources, claudeCommands, agentSkills }) {
  const invocations = []
  for (const { path, text } of sources) {
    text.split('\n').forEach((line, index) => {
      const match = line.match(CLI_CALL)
      // `match[0]` opens with whatever delimiter preceded the call — a backtick,
      // a paren, the indent — which is noise in an error message pointing at a
      // line number.
      if (match)
        invocations.push({ path, line: index + 1, call: match[0].replace(/^[^a-z]+/i, '') })
    })
  }

  const lopsided = []
  for (const { command, skill } of WORKFLOWS) {
    const inClaude = claudeCommands.includes(command)
    const inAgents = agentSkills.includes(skill)
    if (inClaude && !inAgents) {
      lopsided.push(`${CLAUDE_COMMANDS}/${command} has no counterpart at ${AGENT_SKILLS}/${skill}/`)
    } else if (inAgents && !inClaude) {
      lopsided.push(`${AGENT_SKILLS}/${skill}/ has no counterpart at ${CLAUDE_COMMANDS}/${command}`)
    }
  }

  return { invocations, lopsided }
}

function repoRoot() {
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
}

function main() {
  const root = repoRoot()
  const files = instructionFiles(root)

  const { invocations, lopsided } = findInstructionDrift({
    sources: files.map((path) => ({ path, text: readFileSync(resolve(root, path), 'utf8') })),
    claudeCommands: existsSync(resolve(root, CLAUDE_COMMANDS))
      ? readdirSync(resolve(root, CLAUDE_COMMANDS))
      : [],
    agentSkills: existsSync(resolve(root, AGENT_SKILLS))
      ? readdirSync(resolve(root, AGENT_SKILLS))
      : [],
  })

  if (invocations.length === 0 && lopsided.length === 0) {
    console.log(`Agent instructions are consistent (${files.length} file(s) checked).`)
    return
  }

  if (invocations.length > 0) {
    process.stderr.write(
      `✗ ${invocations.length} call(s) to an openspec CLI this repo does not have:\n`,
    )
    for (const { path, line, call } of invocations) {
      process.stderr.write(`  ${path}:${line}  ${call}\n`)
    }
    process.stderr.write(
      '  The workflow is plain files. State the constant instead of calling a binary —\n' +
        '  see the mapping table in .claude/commands/opsx/apply.md.\n',
    )
  }

  if (lopsided.length > 0) {
    process.stderr.write(`✗ ${lopsided.length} workflow(s) exist in only one tree:\n`)
    for (const line of lopsided) process.stderr.write(`  ${line}\n`)
    process.stderr.write(
      '  Claude reads .claude/commands/opsx/, Codex reads .agents/skills/.\n' +
        '  Nothing syncs them; add the counterpart by hand.\n',
    )
  }

  process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main()
