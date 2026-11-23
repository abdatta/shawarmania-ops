import { Plus, X } from 'lucide-react'
import { useState, type Ref } from 'react'

import { AttentionField } from '@/components/ui/attention-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { formatTestNumber, MAX_TEST_NUMBERS } from '../../../shared/campaign-test-number'

/**
 * A campaign's test numbers, in the composer [owner, 2026-11-18] and on a
 * submitted campaign's page while it is still going [owner, 2026-11-24].
 *
 * Numbers the owners type themselves, their own or a friend's, shown whole
 * as chips. The laptop sends them the message with no press: on **Send
 * test**, and again ahead of the first batch when the campaign is submitted.
 * Numbers used on earlier campaigns are offered under **Used before**, since
 * they are mostly the same ones. At most five.
 */
export function TestNumbers({
  phones,
  suggestions,
  busy,
  attentionRef,
  message,
  canSend,
  waiting,
  onAdd,
  onRemove,
  onSend,
  onTyping,
}: {
  phones: readonly string[]
  /** Numbers used before, most recent first; the ones already here are left out. */
  suggestions: readonly string[]
  busy: 'tests' | 'test' | boolean
  attentionRef: Ref<HTMLDivElement>
  message: string | null
  /** There is a message to send. */
  canSend: boolean
  /** A test of this campaign is waiting for the laptop. */
  waiting: boolean
  /** Add one typed or tapped number. Resolves true when it was added. */
  onAdd: (typed: string) => Promise<boolean>
  onRemove: (phone: string) => void
  onSend: () => void
  /** The number in the box changed, so a refusal about the last one no longer applies. */
  onTyping: () => void
}) {
  const [typed, setTyped] = useState('')
  const full = phones.length >= MAX_TEST_NUMBERS
  const offered = suggestions.filter((phone) => !phones.includes(phone))
  const working = busy !== false

  async function add(value: string) {
    if (await onAdd(value)) setTyped('')
  }

  return (
    <AttentionField attentionRef={attentionRef} message={message} testId="test-numbers">
      <span className="mb-1 block text-sm font-semibold text-content">Test numbers</span>
      {phones.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Test numbers">
          {phones.map((phone) => (
            <li
              key={phone}
              data-testid={`test-number-${phone}`}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pl-3 pr-1 text-sm font-semibold tabular-nums text-content"
            >
              {formatTestNumber(phone)}
              <button
                type="button"
                disabled={working}
                aria-label={`Remove ${formatTestNumber(phone)}`}
                onClick={() => onRemove(phone)}
                className="flex size-7 items-center justify-center rounded-full text-content-muted hover:bg-surface-raised focus-visible:focus-ring disabled:opacity-50"
              >
                <X aria-hidden size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <div className="flex gap-2">
          <Input
            aria-label="Add a test number"
            data-testid="test-number-input"
            inputMode="tel"
            autoComplete="off"
            placeholder="Mobile, or + and country code"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value)
              onTyping()
            }}
            onKeyDown={(event) => {
              // Enter adds the number; it must not submit the campaign.
              if (event.key === 'Enter') {
                event.preventDefault()
                void add(typed)
              }
            }}
            className="h-[var(--size-control-phone)] min-w-0 flex-1"
          />
          <Button
            variant="secondary"
            size="phone"
            disabled={working || typed.trim() === ''}
            data-testid="test-number-add"
            onClick={() => void add(typed)}
          >
            Add
          </Button>
        </div>
      )}

      {!full && offered.length > 0 && (
        <div className="mt-2" data-testid="test-number-suggestions">
          <span className="mb-1 block text-xs font-semibold text-content-muted">Used before</span>
          <div className="flex flex-wrap gap-1.5">
            {offered.map((phone) => (
              <button
                key={phone}
                type="button"
                disabled={working}
                aria-label={`Add ${formatTestNumber(phone)}`}
                onClick={() => void add(phone)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-sm tabular-nums text-content hover:bg-surface-raised focus-visible:focus-ring disabled:opacity-50"
              >
                <Plus aria-hidden size={14} className="text-content-muted" />
                {formatTestNumber(phone)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          variant="secondary"
          size="phone"
          disabled={working || waiting || !canSend || phones.length === 0}
          data-testid="send-test"
          onClick={onSend}
        >
          {busy === 'test' ? 'Sending…' : 'Send test'}
        </Button>
        {waiting && (
          <span className="text-xs text-content-muted" data-testid="test-waiting">
            A test is waiting for the laptop.
          </span>
        )}
      </div>
    </AttentionField>
  )
}
