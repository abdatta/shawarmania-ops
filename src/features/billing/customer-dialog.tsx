import { Delete, TriangleAlert, UserRoundCheck, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MemberMark } from '@/components/ui/member-mark'
import { Modal } from '@/components/ui/modal'
import {
  PARTIAL_PHONE_MIN_DIGITS,
  type CustomerIdentity,
  type CustomerTier,
  type PartialPhoneMatch,
} from '@/data-access/adapters'
import { formatIndianPhone, normalizeIndianPhone } from '../../../shared/phone'

/**
 * Who this order is for — asked once, from a keypad, and answerable by skipping.
 *
 * **The phone is the customer.** The composer used to offer a name box and a
 * phone box side by side and accept either, so the quickest way past it was two
 * characters of nonsense — and what came back from a year of counters was `As`,
 * `Kk`, `Jj`. Here the number is what identifies somebody, and the name is a
 * fact about them rather than a way through the form.
 *
 * Built from the same parts as `PaymentDialog` and `DiscountDialog`: a `Modal`,
 * a three-column pad, a pair of actions along the bottom. The counter learns one
 * shape and uses it three times.
 *
 * **Ten digits is the only threshold in the component.** Below ten the
 * resolution area renders nothing at all — no spinner, no hint, no greyed card —
 * because a number is incomplete for the first nine digits of typing it and a
 * message that appears while somebody is still typing teaches them to ignore
 * messages. At ten, one of two things is true and the area says which.
 *
 * **Skip lives in here and nowhere else.** On the composer, under the thumb that
 * taps Paid forty times an hour, it would be muscle memory inside a week — which
 * is how `Kk` happened. One extra tap is a choice; it is nowhere near a
 * nuisance.
 */

/** What the biller decided. Null until they have decided anything. */
export type CustomerSelection =
  | {
      kind: 'identified'
      /** Canonical `+91XXXXXXXXXX`. Never the string somebody typed. */
      phone: string
      /** Snapshotted onto this order and bill, never onto the saved profile. */
      name: string
      /**
       * Whether the directory said they are a member when they were identified.
       * Snapshotted onto the order like the name; absent for a customer saved
       * for the first time, who cannot be one yet.
       */
      tier?: CustomerTier | null
    }
  | {
      kind: 'skipped'
      /**
       * The customer name an ALREADY SAVED order carries, and nothing this
       * dialog can set: skipping is one tap and types nothing.
       *
       * It survives because every order rung before this change carries a name
       * and no number — all 1840 of them in production — and reopening one to
       * add an item must not wipe the name it was rung under.
       */
      name: string
    }

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'] as const

/** The pad caps entry here, so `normalizeIndianPhone` decides only validity. */
const PHONE_DIGITS = 10

/**
 * How long the pad settles before the partial number is asked about.
 *
 * Without this, every digit from the fourth to the tenth is its own request —
 * seven per customer, on a path that carries a rate bound. A quarter of a second
 * is under the gap between two deliberate taps, so a biller keying a number
 * straight through spends one request rather than seven, and one who pauses
 * mid-number gets an answer as soon as they do.
 */
const SUGGEST_SETTLE_MS = 250

type Resolution =
  | { state: 'idle' }
  | { state: 'looking' }
  | { state: 'match'; customer: CustomerIdentity }
  | { state: 'none' }

/** What came back for one number, so a stale answer cannot outlive its digits. */
interface LookedUp {
  phone: string
  customer: CustomerIdentity | null
}

export function CustomerDialog(props: {
  open: boolean
  /** The current decision, so reopening the row shows what it already says. */
  selection: CustomerSelection | null
  /**
   * The adapter's exact-phone lookup. Passed in rather than reached for, so the
   * dialog is one component over the mock directory and the real one.
   *
   * A refusal, a rate-limited caller and a failed request must all arrive here
   * as a rejection and read to the biller exactly as a number that matched
   * nobody: the difference between them is only useful to somebody probing the
   * directory.
   */
  lookup: (phone: string) => Promise<CustomerIdentity | null>
  /**
   * The best match for a partial number among customers **this outlet has
   * served**, or null.
   *
   * Two questions with two scopes, and the difference is deliberate. A partial
   * number reaches only this outlet's own customers, so it can surface nobody
   * the counter has not already served. A complete number reaches the whole
   * business through `lookup`, because a number given in full was given by the
   * person it belongs to.
   */
  suggest: (partial: string) => Promise<PartialPhoneMatch | null>
  onClose: () => void
  onChoose: (selection: CustomerSelection) => void
}) {
  if (!props.open) return null
  return <OpenCustomerDialog {...props} />
}

function OpenCustomerDialog({
  selection,
  lookup,
  suggest,
  onClose,
  onChoose,
}: {
  selection: CustomerSelection | null
  lookup: (phone: string) => Promise<CustomerIdentity | null>
  suggest: (partial: string) => Promise<PartialPhoneMatch | null>
  onClose: () => void
  onChoose: (selection: CustomerSelection) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  /*
    A skipped row reopens on the pad, because somebody reopening one is doing it
    for the reason the decision is reversible at all: the customer has just
    given their number.
  */
  const [digits, setDigits] = useState(() =>
    selection?.kind === 'identified' ? selection.phone.slice(-PHONE_DIGITS) : '',
  )
  const [name, setName] = useState(() => (selection?.kind === 'identified' ? selection.name : ''))
  const [lookedUp, setLookedUp] = useState<LookedUp | null>(null)
  const [suggested, setSuggested] = useState<{
    phone: string
    match: PartialPhoneMatch | null
  } | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => headingRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  // `98765 43210` as it is typed, so the readout reads the way the number is
  // said aloud. `formatIndianPhone` does the same for a complete one.
  const grouped = digits.length <= 5 ? digits : `${digits.slice(0, 5)} ${digits.slice(5)}`
  const complete = digits.length === PHONE_DIGITS
  // Ten digits is not the same as a phone number: the Indian mobile rule opens
  // 6-9. A number that is ten digits and still invalid reads as no match AND
  // offers no save, because offering to save an unsaveable number would put a
  // form in front of the biller that fails on submit.
  const canonical = complete ? normalizeIndianPhone(digits) : null
  // Ten digits that are not a mobile number. Never true mid-typing: a number is
  // incomplete for the first nine digits of every number anybody enters.
  const invalid = complete && canonical === null

  /*
    One lookup per distinct complete number, never one per keystroke. The
    per-caller bound on the real directory is 120 in fifteen minutes, and a
    lookup per keystroke would spend a tenth of it identifying one customer.
  */
  useEffect(() => {
    if (canonical === null) return
    let active = true
    void lookup(canonical)
      .then((found) => {
        if (active) setLookedUp({ phone: canonical, customer: found })
      })
      // A refusal, an exhausted rate bound and a failed request all land here
      // and all read as a miss. Which of the three it was is only useful to
      // somebody probing the directory.
      .catch(() => {
        if (active) setLookedUp({ phone: canonical, customer: null })
      })
    return () => {
      active = false
    }
  }, [canonical, lookup])

  /*
    Derived rather than stored, so an answer can never outlive the digits it was
    for: backspacing the tenth digit takes the resolution away in the same
    render, without an effect racing the keypad to clear it.
  */
  const resolution: Resolution =
    canonical === null
      ? { state: complete ? 'none' : 'idle' }
      : lookedUp?.phone !== canonical
        ? { state: 'looking' }
        : lookedUp.customer !== null
          ? { state: 'match', customer: lookedUp.customer }
          : { state: 'none' }

  /*
    The partial question, asked of this outlet's own customers once the pad has
    settled. It stops at ten digits, where the complete-number lookup takes over
    and reaches the whole business instead.
  */
  const partial = digits.length >= PARTIAL_PHONE_MIN_DIGITS && !complete ? digits : null

  useEffect(() => {
    if (partial === null) return
    let active = true
    const timer = window.setTimeout(() => {
      void suggest(partial)
        .then((found) => {
          if (active) setSuggested({ phone: partial, match: found })
        })
        // A refusal reads as nobody, for the same reason a refused lookup does.
        .catch(() => {
          if (active) setSuggested({ phone: partial, match: null })
        })
    }, SUGGEST_SETTLE_MS)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [partial, suggest])

  // Derived, so an answer cannot outlive the digits it was for.
  const suggestion = partial !== null && suggested?.phone === partial ? suggested.match : null

  const match = resolution.state === 'match' ? resolution.customer : null
  // A matched customer who never gave a name can still have one put on this
  // order, and the saved profile stays as it is either way — `createOrGet` does
  // not rewrite one from a till. So the field is offered here too.
  const labelField = match === null ? canonical !== null : match.name === null
  /*
    **A number saved for the first time must carry a name** [owner,
    2026-09-19]. This is the moment the directory row is created and it is the
    only moment: `customer_create_or_get` never rewrites a saved profile from a
    till, by design, so a row saved nameless stays nameless for good.

    Held in the UI alone and deliberately — the columns stay nullable, so this
    can be relaxed without a migration.

    It does NOT apply to a customer who already exists without a name. They are
    identified by their number, which is the point, and completing somebody
    else's profile is not this screen's job.
  */
  const nameRequired = match === null && canonical !== null
  const canConfirm = match !== null || (canonical !== null && name.trim() !== '')

  function appendDigits(value: string) {
    setDigits((current) => `${current}${value}`.slice(0, PHONE_DIGITS))
  }

  function confirm() {
    if (match !== null) {
      onChoose({
        kind: 'identified',
        phone: match.phone,
        name: match.name ?? name.trim(),
        // Only a member carries the field, so a stranger's selection reads
        // exactly as it did before memberships existed.
        ...(match.tier ? { tier: match.tier } : {}),
      })
      return
    }
    if (canonical === null) return
    onChoose({ kind: 'identified', phone: canonical, name: name.trim() })
  }

  return (
    <Modal
      open
      onClose={onClose}
      aria-label="Customer"
      className="m-auto w-[min(94vw,26rem)] rounded-2xl p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-black text-content outline-none">
          Customer
        </h2>
        {/*
          **Leaving without deciding has to be possible** [owner, 2026-09-19].
          A biller opens this expecting a number and the customer starts
          changing their order instead; without a way out the only exit is Skip,
          which records a decision they did not mean to make and would have to
          remember to undo.

          Closing changes nothing, and nothing is lost by it: the row stays as
          it was, so Order and Mark Paid stay disabled and the undecided bill
          cannot be rung by accident. The disabled buttons are the reminder.
        */}
        <Button
          variant="ghost"
          size="phone"
          className="-mr-2 -mt-1 w-10 shrink-0 px-0"
          aria-label="Close without deciding"
          data-testid="customer-dismiss"
          onClick={onClose}
        >
          <X aria-hidden size={18} />
        </Button>
      </div>

      {/*
        A real form, so Enter on a keyboard and the Go key on a tablet's own
        keypad both save without reaching for the button. Every key on the pad is
        a `type="button"`, so none of them can submit it by accident.
      */}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (canConfirm) confirm()
        }}
      >
        <p
          className="mt-2 text-center text-3xl font-black tabular-nums text-content"
          data-testid="customer-phone-readout"
        >
          {/*
              The country code stands in for a placeholder [owner, 2026-09-19].
              `+91` on an empty readout says "a number goes here" without a word
              of instruction, and it is the one part of the number the biller
              never types.
            */}
          <span className="text-content-muted">+91</span>{' '}
          {/*
            The number itself turns red once ten digits have failed the rule
            [owner, 2026-09-19], so the thing that is wrong is the thing that
            changes colour rather than a line underneath it.
          */}
          <span className={invalid ? 'text-danger' : undefined}>{grouped}</span>
        </p>

        {/*
            Silence is the correct message below three digits, and while the
            lookup is in flight: a spinner between the ninth digit and the
            answer is a third state nobody asked about.
          */}
        <div className="mt-3 min-h-16" data-testid="customer-resolution">
          {match !== null && (
            <div
              className="rounded-xl border border-primary bg-surface p-3"
              data-testid="customer-match"
            >
              {/*
                  The name, and under it the number [owner, 2026-09-19]. No
                  "Returning customer" heading over the top: the biller is
                  looking for a person, and a heading saying what kind of row this
                  is pushes the one fact they want down the card.
                */}
              {/*
                  The mark sits on the match **before** it is accepted, while
                  there is still a choice to make about the order — which is
                  the whole of its use at a counter. No date and nothing else.
                */}
              <p className="flex min-w-0 items-center gap-1.5 font-bold text-content">
                <span className="truncate">{match.name ?? 'No saved name'}</span>
                {match.tier === 'gold' && <MemberMark />}
              </p>
              <p className="text-sm tabular-nums text-content-muted">
                +91 {formatIndianPhone(match.phone)}
              </p>
              {match.remembered && (
                <p className="mt-1 text-xs font-semibold text-content-muted">
                  From this tablet&rsquo;s last online read. It will be checked again on sync.
                </p>
              )}
            </div>
          )}

          {suggestion !== null && (
            /*
              Tapping it fills the number in rather than choosing the customer
              outright. The complete number then resolves through the ordinary
              directory lookup, so what is finally carried onto the bill has been
              identified the same way every other customer is.
            */
            <button
              type="button"
              data-testid="customer-suggestion"
              onClick={() => setDigits(suggestion.customer.phone.slice(-PHONE_DIGITS))}
              className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left hover:bg-surface-raised focus-visible:focus-ring"
            >
              <UserRoundCheck aria-hidden className="shrink-0 text-primary" size={18} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5 font-bold text-content">
                  <span className="truncate">{suggestion.customer.name ?? 'No saved name'}</span>
                  {suggestion.customer.tier === 'gold' && <MemberMark />}
                </span>
                {/*
                  The digits already typed are dimmed and the rest are not
                  [owner, 2026-09-19], because the part worth reading is the
                  part still to be checked against what the customer just said.
                  Emphasising the typed prefix instead would highlight the only
                  digits the biller already knows are right.
                */}
                <span className="block text-sm tabular-nums">
                  <span className="text-content-muted">
                    +91 {typedPart(suggestion.customer.phone, digits)}
                  </span>
                  <span className="font-bold text-content">
                    {untypedPart(suggestion.customer.phone, digits)}
                  </span>
                </span>
              </span>
              {suggestion.otherMatches > 0 && (
                /*
                  Not a control, and deliberately not tappable: its whole job is
                  to say "this is a guess, keep typing". Something that opened
                  the other matches would be the browse path this product does
                  not have.
                */
                <span
                  data-testid="customer-suggestion-others"
                  className="shrink-0 self-start rounded-full bg-surface-raised px-2 py-0.5 text-xs font-semibold text-content-muted"
                >
                  +{suggestion.otherMatches} more
                </span>
              )}
            </button>
          )}

          {/*
            **Only the number that cannot be saved gets a sentence.** A number
            that simply belongs to nobody yet is announced by the name field
            appearing and asking for one [owner, 2026-09-19] — saying it in prose
            as well was the same fact twice, a line apart. There is nothing to
            say it with when the number is unsaveable, because no field appears.
          */}
          {resolution.state === 'none' && canonical === null && (
            <p
              className="flex items-center justify-center gap-1.5 text-sm font-bold text-danger"
              data-testid="customer-no-match"
              role="alert"
            >
              {/*
                A lucide icon rather than an emoji: it takes the danger token in
                both themes, where an emoji keeps its own colours and renders
                differently on every device.
              */}
              <TriangleAlert aria-hidden size={16} />
              Invalid mobile number!
            </p>
          )}

          {labelField && (
            <>
              <label className="sr-only" htmlFor="customer-name">
                Customer name
              </label>
              <Input
                id="customer-name"
                className="mt-2"
                autoComplete="off"
                /*
                  What a tablet's own keyboard does with this field, and all of
                  it is a hint to that keyboard rather than a rule about the
                  value [owner, 2026-09-19]:

                  - `words` opens it shifted and re-shifts after each space, so
                    `John Doe` is what comes out of ordinary typing. A physical
                    keyboard ignores it, and so does a paste.
                  - autocorrect off, because a name is not a dictionary word and
                    iOS will happily turn one into the nearest one it knows.
                  - the action key says Done and submits the form, so the number
                    never needs the button.

                  **The value itself is left exactly as typed.** Title-casing it
                  in code would mangle the names this counter actually serves —
                  `Sk Abdul`, `MD Rahim`, initials, `d'Souza` — and the first
                  name saved is the only name, since `customer_create_or_get`
                  never rewrites a profile from a till.
                */
                autoCapitalize="words"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                required={nameRequired}
                placeholder={nameRequired ? 'Enter New Customer’s Name' : 'Name (optional)'}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </>
          )}
        </div>

        <div className="mx-auto mt-3 grid w-[13rem] grid-cols-3 gap-2" aria-label="Phone keypad">
          {KEYS.map((key) => (
            <Button
              key={key}
              variant="secondary"
              size="control"
              className="min-w-0 px-0 text-lg"
              disabled={complete}
              onClick={() => appendDigits(key)}
            >
              {key}
            </Button>
          ))}
          <Button
            variant="secondary"
            size="control"
            className="min-w-0 px-0"
            aria-label="Delete last digit"
            disabled={digits === ''}
            onClick={() => setDigits((current) => current.slice(0, -1))}
          >
            <Delete aria-hidden size={18} />
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {/*
              **One tap, and no confirmation** [owner, 2026-09-19]. Skipping is
              not a thing to be sure about; it is the answer when nobody offered
              a number, and a second screen asking "really?" would be ceremony
              over the commonest case.

              It lives in here rather than on the composer, and that is the
              load-bearing decision of this whole change. Opening the dialog
              first is the moment a biller notices they are declining to ask for
              a number. The row can be tapped again afterwards, so nothing about
              this is final.
            */}
          <Button
            variant="secondary"
            size="control"
            data-testid="customer-skip"
            onClick={() =>
              onChoose({
                kind: 'skipped',
                // A name an older order already carries rides along. Nothing
                // here can type one, and wiping the name an order was rung
                // under is not what skipping means.
                name: selection?.kind === 'skipped' ? selection.name : '',
              })
            }
          >
            Skip
          </Button>
          <Button
            type="submit"
            size="control"
            disabled={!canConfirm}
            data-testid="customer-confirm"
          >
            {match !== null ? 'Use' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * A canonical phone split where the biller has got to, as the readout groups it
 * — `98765 43210`. The space after the fifth digit means the cut is one
 * character further along once five digits are in.
 */
function splitAt(phone: string, typed: string): number {
  const formatted = formatIndianPhone(phone)
  const digits = Math.min(typed.length, formatted.replace(/\D/g, '').length)
  return digits <= 5 ? digits : digits + 1
}

function typedPart(phone: string, typed: string): string {
  return formatIndianPhone(phone).slice(0, splitAt(phone, typed))
}

function untypedPart(phone: string, typed: string): string {
  return formatIndianPhone(phone).slice(splitAt(phone, typed))
}
