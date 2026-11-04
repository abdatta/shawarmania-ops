import { Check, CircleAlert } from 'lucide-react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { signInSteps, stepState, type SignInStep, type SignInView } from '@/domain/sign-in-progress'
import { cn } from '@/lib/cn'

import type { AggregatorChannelConfig } from './channel-config'

/**
 * A full sign-in, told as it happens (#46).
 *
 * Live, it holds the channel's page (the surface lays it over an inert page),
 * and it carries no Reconnect, because tapping again is the one action that
 * makes a slow sign-in worse. The code field lives inside "Waiting for your code": the field
 * is where the account of the sign-in says it should be, and nowhere earlier.
 *
 * Quiet and stopped are the two ways a sign-in can fail to finish, and both say
 * so in place and offer Reconnect, rather than leaving a stage looking live.
 */
export function SignInProgress({
  config,
  view,
  waiting,
  codeAttempts,
  codeSent,
  code,
  now,
  busy,
  onCode,
  onSubmitCode,
  onReconnect,
  onDone,
  className,
}: {
  config: AggregatorChannelConfig
  /** `done` only for a sign-in this page watched live, to end it with every tick. */
  view: Extract<SignInView, { kind: 'live' | 'quiet' | 'stopped' | 'done' }>
  /** The open code request, if one is open. */
  waiting: { expiresAt: string } | null
  codeAttempts: number
  /** The owner has sent a code for this attempt and it has not been answered yet. */
  codeSent: boolean
  code: string
  now: number
  busy: boolean
  onCode: (value: string) => void
  onSubmitCode: (event: FormEvent) => void
  onReconnect: () => void
  onDone?: () => void
  className?: string
}) {
  const steps = signInSteps(config.showsHyperpure)
  const ended = view.kind === 'stopped'
  const done = view.kind === 'done'
  // Where the list stands. A stopped sign-in no longer knows which stage it was
  // at, so nothing on it reads as current; a quiet one keeps its last stage,
  // marked as the one that went silent.
  const current = view.kind === 'quiet' || view.kind === 'live' ? view.stage : null

  return (
    <Card
      className={cn(
        'p-4',
        view.kind === 'live' || done ? 'border-border' : 'border-warning/60 bg-warning/5',
        className,
      )}
      data-testid={`${config.testIdPrefix}-sign-in`}
      data-sign-in-state={view.kind}
    >
      <h2 className="text-lg font-semibold text-content">Signing in to {config.label}</h2>
      {/* One line on a phone, on purpose: the steps are the point, this only
          says they take a while (owner, 2026-11-04). */}
      {view.kind === 'live' && (
        <p className="mt-0.5 text-sm text-content-muted">This can take a couple of minutes.</p>
      )}

      {!ended && (
        <ol className="mt-4 space-y-3.5" aria-label={`Signing in to ${config.label}`}>
          {steps.map((step) => {
            const state = done ? 'past' : current ? stepState(steps, step, current) : 'upcoming'
            const quietHere = view.kind === 'quiet' && state === 'current'
            // The code is the owner's to give: nothing is processing, so the
            // ring stops turning until a code is on its way.
            const yourTurn =
              step === 'waiting_for_code' &&
              state === 'current' &&
              view.kind === 'live' &&
              waiting !== null &&
              !codeSent
            return (
              <li
                key={step}
                className="text-base"
                data-step={step}
                data-step-state={quietHere ? 'quiet' : state}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <div className="flex items-center gap-3">
                  <StepMark state={state} quiet={quietHere} still={yourTurn} />
                  <span
                    className={cn(
                      // What is behind steps back; where it is now stands out.
                      state === 'current' ? 'font-medium text-content' : 'text-content-muted',
                    )}
                  >
                    {stepLabel(step, config.label)}
                  </span>
                </div>

                {step === 'waiting_for_code' && state === 'current' && view.kind === 'live' && (
                  <CodeStep
                    config={config}
                    waiting={waiting}
                    codeAttempts={codeAttempts}
                    codeSent={codeSent}
                    code={code}
                    now={now}
                    busy={busy}
                    onCode={onCode}
                    onSubmitCode={onSubmitCode}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}

      {done && (
        <div className="mt-3">
          <p className="text-base font-medium text-content" role="status">
            Signed back in to {config.label}
          </p>
          <Button
            onClick={onDone}
            className="mt-3"
            data-testid={`${config.testIdPrefix}-sign-in-done`}
          >
            Done
          </Button>
        </div>
      )}

      {(view.kind === 'quiet' || view.kind === 'stopped') && (
        <div className="mt-3">
          <p className="text-base text-content" role="status">
            {view.kind === 'quiet' ? 'This sign-in has gone quiet.' : 'The sign-in stopped.'}
          </p>
          <Button
            disabled={busy}
            onClick={onReconnect}
            className="mt-3"
            data-testid={`${config.testIdPrefix}-sign-in-again`}
          >
            Reconnect
          </Button>
        </div>
      )}
    </Card>
  )
}

/**
 * The line a finished sign-in collapses to, until a read overtakes it.
 *
 * Without it the "signed out" card stayed up after a successful sign-in until
 * the next scheduled read, hours later, inviting a second sign-in nobody needed.
 */
export function SignedBackIn({
  config,
  reading,
}: {
  config: AggregatorChannelConfig
  reading: boolean
}) {
  return (
    <Card
      className="flex items-center gap-2.5 p-3"
      data-testid={`${config.testIdPrefix}-signed-back-in`}
    >
      <Check aria-hidden className="size-4 shrink-0 text-success" />
      <p className="text-sm text-content">
        Signed back in to {config.label}
        {reading && <span className="text-content-muted"> · reading your figures</span>}
      </p>
    </Card>
  )
}

/**
 * A step's mark: the turning ring fills into a tick of the same colour, so a
 * finished step reads as the ring completed. Ahead, a dashed ring. Where the
 * sign-in waits on the owner the ring is still — its track alone, unbroken —
 * because a turning ring says "not your turn yet". Turning only where motion is
 * welcome.
 */
function StepMark({
  state,
  quiet,
  still,
}: {
  state: 'past' | 'current' | 'upcoming'
  quiet: boolean
  still: boolean
}) {
  if (quiet) return <CircleAlert aria-hidden className="size-6 shrink-0 text-warning" />
  if (state === 'past') {
    return (
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary"
      >
        <Check className="size-4" strokeWidth={3} />
      </span>
    )
  }
  if (state === 'current') {
    return (
      <span
        aria-hidden
        data-mark={still ? 'still' : 'turning'}
        className={cn(
          'size-6 shrink-0 rounded-full border-2 border-primary/30',
          !still && 'border-t-primary animate-spin motion-reduce:animate-none',
        )}
      />
    )
  }
  return (
    <span
      aria-hidden
      className="size-6 shrink-0 rounded-full border-2 border-dashed border-content-muted/50"
    />
  )
}

function CodeStep({
  config,
  waiting,
  codeAttempts,
  codeSent,
  code,
  now,
  busy,
  onCode,
  onSubmitCode,
}: {
  config: AggregatorChannelConfig
  waiting: { expiresAt: string } | null
  codeAttempts: number
  codeSent: boolean
  code: string
  now: number
  busy: boolean
  onCode: (value: string) => void
  onSubmitCode: (event: FormEvent) => void
}) {
  // The stage is recorded the moment the mailbox opens, so the request is here
  // within one read of it. Until then there is nothing to type into.
  if (!waiting) return null
  if (codeSent) {
    return (
      <p className="mt-2 pl-9 text-sm text-content-muted" role="status">
        OTP sent
      </p>
    )
  }

  const left = Math.max(0, new Date(waiting.expiresAt).getTime() - now)
  const minutes = Math.floor(left / 60_000)
  const seconds = Math.floor((left % 60_000) / 1000)

  return (
    <div className="mt-3 ml-[11px] border-l-2 border-primary/30 pl-[21px]">
      {codeAttempts > 0 && (
        <p className="mb-2 text-sm text-danger" role="alert">
          That OTP was not accepted. Check it and try again.
        </p>
      )}
      <p className="mb-2 text-sm text-content-muted">{config.otpHeading}</p>
      <form onSubmit={onSubmitCode} className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${config.testIdPrefix}-otp`} className="sr-only">
          The OTP {config.label} sent
        </label>
        <input
          id={`${config.testIdPrefix}-otp`}
          value={code}
          onChange={(changed) => onCode(changed.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          // 16px floor: anything smaller makes a mobile browser zoom the
          // viewport on focus, and this field is typed on a phone by definition.
          className="w-32 rounded-md border border-border bg-surface px-3 py-2 text-base tabular-nums text-content"
        />
        <Button type="submit" disabled={busy || code.trim() === ''}>
          Sign back in
        </Button>
        <span
          className="text-xs tabular-nums text-content-muted"
          data-testid={`${config.testIdPrefix}-otp-left`}
        >
          {left > 0 ? `${minutes}:${String(seconds).padStart(2, '0')} left` : 'Expired'}
        </span>
      </form>
    </div>
  )
}

function stepLabel(step: SignInStep, label: string): string {
  switch (step) {
    case 'starting':
      return 'Starting the sign-in'
    case 'opening_portal':
      return `Opening the ${label} partner portal`
    case 'signing_in':
      return 'Signing in as you'
    case 'waiting_for_code':
      return 'Waiting for your OTP'
    case 'checking_code':
      return 'Checking your OTP'
    case 'bringing_hyperpure':
      return 'Bringing Hyperpure along'
  }
}
