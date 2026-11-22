/**
 * The sender's diary: what happened to the sender itself, kept on this laptop
 * (a-campaign-goes-out-on-whatsapp, design *The sender's history*).
 *
 * Started, connected, connection lost, Send batch pressed, asked to stop,
 * halted, started again by the keeper. What was sent to whom is not here: the
 * database holds that, and the history page reads it from there. So the diary
 * holds no number and no message, and losing it with the laptop loses nothing
 * the business needs [owner, 2026-11-21].
 *
 * One JSON object per line in `diary.jsonl` in the data folder, newest last.
 * It keeps the newest `DIARY_KEEP` lines. Text in, text out: nothing here
 * touches the disk.
 */

export const DIARY_FILE = 'diary.jsonl'

/** Lines kept: months of a sender that starts and stops a few times a day. */
export const DIARY_KEEP = 2000

export type DiaryTone = 'plain' | 'good' | 'warn' | 'alarm'

export interface DiaryEntry {
  /** An ISO instant. */
  at: string
  tone: DiaryTone
  text: string
}

const TONES: readonly DiaryTone[] = ['plain', 'good', 'warn', 'alarm']

export function diaryLine(entry: DiaryEntry): string {
  return `${JSON.stringify(entry)}\n`
}

function asEntry(line: string): DiaryEntry | null {
  try {
    const value = JSON.parse(line) as Partial<DiaryEntry>
    if (typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))) return null
    if (typeof value.text !== 'string') return null
    const tone = TONES.includes(value.tone as DiaryTone) ? (value.tone as DiaryTone) : 'plain'
    return { at: value.at, tone, text: value.text }
  } catch {
    return null
  }
}

/** The newest `limit` entries, newest first. A line that cannot be read is skipped. */
export function readDiary(text: string, limit: number): DiaryEntry[] {
  const entries: DiaryEntry[] = []
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i -= 1) {
    const line = (lines[i] as string).trim()
    if (line === '') continue
    const entry = asEntry(line)
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * The diary cut to its newest `DIARY_KEEP` lines, or null when it is small
 * enough as it is. Trimmed only once it is half as long again, so it is not
 * rewritten on every line.
 */
export function trimDiary(text: string): string | null {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  if (lines.length <= DIARY_KEEP * 1.5) return null
  return `${lines.slice(-DIARY_KEEP).join('\n')}\n`
}
