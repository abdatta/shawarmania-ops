#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function coauthorForModel(model) {
  const match = /^gpt-(\d+(?:\.\d+)?)-(sol|terra|luna|astra)$/.exec(model)
  if (!match) throw new Error(`Unrecognised exact model: ${model}; confirm its display name.`)
  const [, version, variant] = match
  return `Codex GPT-${version} ${variant[0].toUpperCase()}${variant.slice(1)} <noreply@openai.com>`
}

export function resolveCodexModel({
  threadId = process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID,
  sessionsDir = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions'),
} = {}) {
  if (!threadId || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(threadId)) {
    throw new Error('An active CODEX_THREAD_ID or CODEX_SESSION_ID is required.')
  }
  const matches = readdirSync(sessionsDir, { recursive: true }).filter((name) =>
    name.endsWith(`-${threadId}.jsonl`),
  )
  if (matches.length !== 1)
    throw new Error(`Expected one active-thread rollout; found ${matches.length}.`)
  const models = []
  // Read model metadata only. Never return conversation, tool output or credentials.
  const lines = readFileSync(join(sessionsDir, matches[0]), 'utf8').trimEnd().split('\n')
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      // A running rollout can end in an incomplete append.
      if (index !== lines.length - 1)
        throw new Error('Malformed rollout metadata before its final append.')
      continue
    }
    if (record.type === 'turn_context' && typeof record.payload?.model === 'string') {
      models.push(record.payload.model)
    }
  }
  const model = models.at(-1)
  if (!model) throw new Error('No active-thread turn_context model found.')
  return { model, coauthor: coauthorForModel(model), modelsSeen: [...new Set(models)] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(resolveCodexModel(), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
