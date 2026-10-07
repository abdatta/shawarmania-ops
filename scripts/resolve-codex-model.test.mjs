// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { coauthorForModel, resolveCodexModel } from './resolve-codex-model.mjs'

const threadId = '00000000-0000-4000-a000-000000000001'
const folders = []
function fixture(models, id = threadId) {
  const root = mkdtempSync(join(tmpdir(), 'codex-model-test-'))
  folders.push(root)
  mkdirSync(join(root, '2026', '10'), { recursive: true })
  writeFileSync(
    join(root, '2026', '10', `rollout-${id}.jsonl`),
    models.map((model) => JSON.stringify({ type: 'turn_context', payload: { model } })).join('\n'),
  )
  return root
}
afterEach(() => {
  for (const root of folders.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('active Codex model attribution', () => {
  it('uses this thread rather than a newer unrelated rollout', () => {
    const sessionsDir = fixture(['gpt-6.1-sol'])
    writeFileSync(
      join(sessionsDir, 'rollout-unrelated.jsonl'),
      JSON.stringify({
        type: 'turn_context',
        payload: { model: 'gpt-5.6-terra' },
      }),
    )
    expect(resolveCodexModel({ threadId, sessionsDir })).toEqual({
      model: 'gpt-6.1-sol',
      coauthor: 'Codex GPT-6.1 Sol <noreply@openai.com>',
      modelsSeen: ['gpt-6.1-sol'],
    })
  })
  it('uses the latest turn and reports model switches for earlier-work review', () => {
    const sessionsDir = fixture(['gpt-5.6-sol', 'gpt-6.1-sol'])
    expect(resolveCodexModel({ threadId, sessionsDir }).modelsSeen).toEqual([
      'gpt-5.6-sol',
      'gpt-6.1-sol',
    ])
    expect(resolveCodexModel({ threadId, sessionsDir }).model).toBe('gpt-6.1-sol')
  })
  it('ignores conversation content and incomplete trailing appends', () => {
    const sessionsDir = fixture(['gpt-6.1-sol'])
    const path = join(sessionsDir, '2026', '10', `rollout-${threadId}.jsonl`)
    writeFileSync(
      path,
      readFixture(path) + '\n{"type":"message","payload":{"model":"gpt-5.6-luna"}}\n{',
    )
    expect(resolveCodexModel({ threadId, sessionsDir }).model).toBe('gpt-6.1-sol')
  })
  it.each(['gpt-6', 'gpt-6.1', 'unknown'])('refuses ambiguous attribution %s', (model) => {
    expect(() => coauthorForModel(model)).toThrow('confirm its display name')
  })
  it('fails rather than selecting a different thread when no match exists', () => {
    expect(() => resolveCodexModel({ threadId, sessionsDir: fixture([], 'unrelated') })).toThrow(
      'found 0',
    )
  })
  it('fails when the active thread has no model metadata', () => {
    expect(() => resolveCodexModel({ threadId, sessionsDir: fixture([]) })).toThrow(
      'No active-thread',
    )
  })
  it('fails when thread identity is unavailable', () => {
    expect(() => resolveCodexModel({ threadId: '', sessionsDir: fixture([]) })).toThrow(
      'active CODEX',
    )
  })
  it('fails when more than one rollout matches', () => {
    const sessionsDir = fixture(['gpt-6.1-sol'])
    writeFileSync(join(sessionsDir, `duplicate-${threadId}.jsonl`), '')
    expect(() => resolveCodexModel({ threadId, sessionsDir })).toThrow('found 2')
  })
})

function readFixture(path) {
  return readFileSync(path, 'utf8')
}
