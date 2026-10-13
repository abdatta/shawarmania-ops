/**
 * Reading a GitHub Actions workflow's shape without a YAML library, for the
 * tests that pin how a release runs (`check-release-order.test.mjs`,
 * `check-republish.test.mjs`, `check-hotfix.test.mjs`).
 *
 * Hand-rolled for the reason `check-workflow-path-tiers.test.mjs` gives: no YAML
 * library is in the dependency tree, and the few facts these tests need — a
 * job's `needs`, its environment, its concurrency group, its commands — sit at
 * fixed indentation in files this repository writes.
 */

/** The lines of one job, from its header to the next job's, or null. */
export function jobBlock(yaml, job) {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(String.raw`^ {2}${job}:\s*$`).test(line))
  if (start === -1) return null
  const end = lines.findIndex((line, i) => i > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

/** A job's `needs`, in either YAML spelling; [] when it has none, null when there is no such job. */
export function needsOf(yaml, job) {
  const block = jobBlock(yaml, job)
  if (block === null) return null
  const inline = /^ {4}needs:\s*\[([^\]]*)\]\s*$/m.exec(block)
  if (inline)
    return inline[1]
      .split(',')
      .map((need) => need.trim())
      .filter(Boolean)
  const single = /^ {4}needs:\s*([A-Za-z0-9_-]+)\s*$/m.exec(block)
  if (single) return [single[1]]
  const list = /^ {4}needs:\s*\n((?: {6}- .*\n?)+)/m.exec(block)
  if (list) return [...list[1].matchAll(/- ([A-Za-z0-9_-]+)/g)].map((match) => match[1])
  return []
}

/** The environment a job runs in, or null. */
export function environmentOf(yaml, job) {
  const block = jobBlock(yaml, job) ?? ''
  return (
    /^ {4}environment:\s*\n {6}name:\s*([A-Za-z0-9_-]+)/m.exec(block)?.[1] ??
    /^ {4}environment:\s*([A-Za-z0-9_-]+)\s*$/m.exec(block)?.[1] ??
    null
  )
}

/** A job's concurrency group, or null. */
export function concurrencyOf(yaml, job) {
  const block = jobBlock(yaml, job) ?? ''
  return /^ {4}concurrency:\s*\n {6}group:\s*(\S+)/m.exec(block)?.[1] ?? null
}

/** The workflow-level concurrency group, or null. */
export function workflowConcurrency(yaml) {
  return /^concurrency:\s*\n {2}group:\s*(\S+)/m.exec(yaml)?.[1] ?? null
}

/** Every job a job waits for, directly or through another. */
export function allNeedsOf(yaml, job, seen = new Set()) {
  for (const need of needsOf(yaml, job) ?? []) {
    if (seen.has(need)) continue
    seen.add(need)
    allNeedsOf(yaml, need, seen)
  }
  return seen
}

/** The job names a workflow declares, in order. */
export function jobsOf(yaml) {
  const body = yaml.split(/^jobs:\s*$/m)[1] ?? ''
  return [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1])
}

/** A job's commands, comments dropped, so prose naming a command does not read as running it. */
export function commandsOf(yaml, job) {
  return (jobBlock(yaml, job) ?? '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
}
