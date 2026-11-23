/**
 * A campaign message, rendered for one customer
 * (a-campaign-goes-out-on-whatsapp, design D3).
 *
 * **One function for both halves.** The app draws the bubble the partner sees
 * as they type from this, and the sender on the owner's laptop hands WhatsApp
 * the text this returns. A preview that came from other code than the send
 * would be a picture of a different message.
 *
 * So this file imports nothing: the sender is its own package and runs its
 * TypeScript directly under Node.
 *
 * Two rules:
 *
 * 1. `{name}` becomes the customer's saved name. A customer with no saved name
 *    gets the greeting without one, never a gap or the word "customer".
 * 2. A message is never cut to fit: an over-long one is reported and it is
 *    the caller that refuses it.
 *
 * Nothing is added under the body. Until 2026-11-20 every message ended with
 * "Reply STOP to stop these messages."; the owner dropped it, as the messages
 * go from a linked phone and not WhatsApp's Business API, and the sender no
 * longer reads replies (design, *No stop line*).
 */

/**
 * The longest message that goes out.
 *
 * A campaign may carry one image, and then the text is that image's caption.
 * 1,024 characters is the caption length WhatsApp is commonly said to allow;
 * plain text may be far longer, but one limit for both keeps what the partner
 * is told the same with and without a picture. To be checked against a real
 * send before the first campaign with an image (tasks 5.2).
 */
export const CAMPAIGN_MESSAGE_MAX = 1024

/** A saved name longer than this is cut where it greets, so a body's length can be judged once. */
export const CAMPAIGN_NAME_MAX = 40

const NAME_TOKEN = /\{\s*name\s*\}/gi

/**
 * A saved name as it may stand in a message, or null where there is none to
 * greet with.
 *
 * WhatsApp has no way to escape `*`, `_`, `~` or a backtick, so a name holding
 * one would format whatever sits beside it. They are taken out. Braces go too,
 * so a name can never smuggle a second `{name}` in, and a line break becomes a
 * space.
 */
export function campaignGreetingName(saved: string | null | undefined): string | null {
  if (saved == null) return null
  const clean = saved
    .replace(/[*_~`{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean === '') return null
  return clean.length > CAMPAIGN_NAME_MAX ? clean.slice(0, CAMPAIGN_NAME_MAX).trimEnd() : clean
}

/** Whether a body greets by name anywhere. */
export function usesCampaignName(body: string): boolean {
  return new RegExp(NAME_TOKEN.source, 'i').test(body)
}

/** The greeting with nobody named: the token goes, with the space or comma that held it in place. */
function withoutName(body: string): string {
  // A token may be wrapped in formatting (`*{name}*`), which would otherwise
  // leave an empty pair behind.
  const token = String.raw`[*_~]*\{\s*name\s*\}[*_~]*`
  return (
    body
      // Opening a line: the name and its comma go, and the line still starts
      // with a capital.
      .replace(
        new RegExp(String.raw`(^|\n)[ \t]*${token}[ \t]*[,!:;.\-]?[ \t]*(\p{L})?`, 'giu'),
        (_match, start: string, letter: string | undefined) =>
          start + (letter ? letter.toUpperCase() : ''),
      )
      // After a word: "Hi {name}," reads "Hi,".
      .replace(new RegExp(String.raw`[ \t]+${token}`, 'gi'), '')
      .replace(new RegExp(token, 'gi'), '')
  )
}

export interface RenderedCampaignMessage {
  /** Exactly what WhatsApp is handed, as text or as an image's caption. */
  text: string
  /** Longer than `CAMPAIGN_MESSAGE_MAX`. The text is whole all the same. */
  tooLong: boolean
}

/**
 * Monospace, left as it is, or a pair of double asterisks WhatsApp's own rule
 * would read as a pair: opening at the edge of a word with text straight
 * after, closing with text straight before and no letter or digit after, on
 * one line.
 */
const DOUBLE_ASTERISKS =
  /```[\s\S]*?```|`[^`\n]*`|(^|[^\p{L}\p{N}*])\*\*(?=[^\s*])([^\n]*?[^\s*])\*\*(?![\p{L}\p{N}*])/gu

/**
 * `**bold**`, as most apps write bold, becomes WhatsApp's `*bold*`
 * [owner, 2026-11-24]. WhatsApp would otherwise show it bold with a stray `*`
 * each side. Done here, where the text is sent, so a campaign already stored
 * with `**` goes out bold too, and the bubble shows what is sent.
 */
function singleAsterisks(text: string): string {
  return text.replace(
    DOUBLE_ASTERISKS,
    (match, before: string | undefined, inside: string | undefined) =>
      inside === undefined ? match : `${before ?? ''}*${inside}*`,
  )
}

/** The message one customer gets. `savedName` is their name as the directory holds it. */
export function renderCampaignMessage(
  body: string,
  savedName: string | null | undefined,
): RenderedCampaignMessage {
  const name = campaignGreetingName(savedName)
  const greeted = name === null ? withoutName(body) : body.replace(NAME_TOKEN, name)
  const text = singleAsterisks(greeted).trim()
  return { text, tooLong: text.length > CAMPAIGN_MESSAGE_MAX }
}

/**
 * What is wrong with a body before anybody is chosen, or null.
 *
 * Length is judged against the longest name a customer could be greeted by,
 * so a campaign that passes here is not too long for anybody in its audience.
 */
export function campaignBodyProblem(body: string): 'empty' | 'too_long' | null {
  if (body.trim() === '') return 'empty'
  const longest = renderCampaignMessage(body, 'M'.repeat(CAMPAIGN_NAME_MAX))
  return longest.tooLong || renderCampaignMessage(body, null).tooLong ? 'too_long' : null
}

/** How many more characters a body may take, by the same judgement. Negative when over. */
export function campaignBodyRoom(body: string): number {
  const longest = Math.max(
    renderCampaignMessage(body, 'M'.repeat(CAMPAIGN_NAME_MAX)).text.length,
    renderCampaignMessage(body, null).text.length,
  )
  return CAMPAIGN_MESSAGE_MAX - longest
}

// ── The preview ─────────────────────────────────────────────────────────────

/**
 * One run of a previewed line. **Text and flags, never markup**: the bubble
 * draws these as elements, so nothing typed into a message can become HTML.
 */
export interface CampaignPreviewSpan {
  text: string
  bold?: true
  italic?: true
  strike?: true
  mono?: true
}

type Mark = 'bold' | 'italic' | 'strike' | 'mono'
type Marks = Partial<Record<Mark, true>>

const MARKERS: Readonly<Record<string, Mark>> = {
  '*': 'bold',
  _: 'italic',
  '~': 'strike',
  '`': 'mono',
}

const WORD = /[\p{L}\p{N}]/u

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch)
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch)
}

/**
 * Where the pair opened at `from` closes, or -1.
 *
 * WhatsApp's own rule, as nearly as it is written down: a marker opens only at
 * the edge of a word with text straight after it, closes only with text
 * straight before it and no letter or digit after, and never reaches across a
 * line.
 */
function closingMarker(text: string, from: number, marker: string): number {
  if (isWord(text[from - 1]) || isSpace(text[from + 1]) || text[from + 1] === marker) return -1
  for (let at = from + 2; at < text.length; at += 1) {
    const ch = text[at]
    if (ch === '\n') return -1
    if (ch === marker && !isSpace(text[at - 1]) && !isWord(text[at + 1])) return at
  }
  return -1
}

function inline(text: string, marks: Marks): CampaignPreviewSpan[] {
  const spans: CampaignPreviewSpan[] = []
  let plain = ''
  const flush = () => {
    if (plain !== '') spans.push({ text: plain, ...marks })
    plain = ''
  }
  let at = 0
  while (at < text.length) {
    const ch = text[at] ?? ''
    const mark = MARKERS[ch]
    const close = mark && !marks[mark] ? closingMarker(text, at, ch) : -1
    if (mark && close !== -1) {
      flush()
      const inside = text.slice(at + 1, close)
      // Monospace is literal: nothing inside it formats.
      if (mark === 'mono') spans.push({ text: inside, ...marks, mono: true })
      else spans.push(...inline(inside, { ...marks, [mark]: true }))
      at = close + 1
      continue
    }
    plain += ch
    at += 1
  }
  flush()
  return spans
}

/** A message as the bubble draws it: one array of runs per line, an empty one for a blank line. */
export function previewCampaignMessage(text: string): CampaignPreviewSpan[][] {
  // Three backticks hold a block that may run across lines, and are read first.
  const spans: CampaignPreviewSpan[] = []
  let rest = text
  for (;;) {
    const open = rest.indexOf('```')
    const close = open === -1 ? -1 : rest.indexOf('```', open + 3)
    if (open === -1 || close === -1 || close === open + 3) break
    spans.push(...inline(rest.slice(0, open), {}))
    spans.push({ text: rest.slice(open + 3, close), mono: true })
    rest = rest.slice(close + 3)
  }
  spans.push(...inline(rest, {}))

  const lines: CampaignPreviewSpan[][] = [[]]
  for (const span of spans) {
    const parts = span.text.split('\n')
    parts.forEach((part, index) => {
      if (index > 0) lines.push([])
      if (part !== '') lines[lines.length - 1]?.push({ ...span, text: part })
    })
  }
  return lines
}
