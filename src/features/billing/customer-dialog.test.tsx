import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  CustomerActionError,
  type CustomerIdentity,
  type PartialPhoneMatch,
} from '@/data-access/adapters'

import { CustomerDialog, type CustomerSelection } from './customer-dialog'

/**
 * The customer dialog, on its own.
 *
 * Two of these are about **absence**, and they are the ones worth having: nine
 * digits must say nothing at all, and a refused or rate-limited lookup must be
 * indistinguishable from a number nobody has used. Both are invisible in a
 * screenshot and both are the requirement.
 */

/** The placeholder a number nobody has used asks for a name with. */
const NEW_NAME = 'Enter New Customer’s Name'

const RITIKA: CustomerIdentity = { id: 'c1', phone: '+919000000101', name: 'Ritika Sen' }
const UNNAMED: CustomerIdentity = { id: 'c2', phone: '+919000000102', name: null }

function open(
  options: {
    lookup?: (phone: string) => Promise<CustomerIdentity | null>
    selection?: CustomerSelection | null
    /** What this outlet has served, which the fake `suggest` below narrows. */
    served?: readonly CustomerIdentity[]
  } = {},
) {
  const onChoose = vi.fn()
  const onClose = vi.fn()
  const lookup = options.lookup ?? vi.fn(async () => null)
  /*
    Stands in for the outlet-scoped function: most recently served first, one
    match or none, and a count of the others. The component must never see a
    list, so neither does this.
  */
  const suggest = vi.fn(async (partial: string): Promise<PartialPhoneMatch | null> => {
    const matching = (options.served ?? []).filter((candidate) =>
      candidate.phone.slice(-10).startsWith(partial),
    )
    const [best] = matching
    return best ? { customer: best, otherMatches: matching.length - 1 } : null
  })
  render(
    <CustomerDialog
      open
      selection={options.selection ?? null}
      lookup={lookup}
      suggest={suggest}
      onClose={onClose}
      onChoose={onChoose}
    />,
  )
  return { onChoose, onClose, lookup, suggest, person: userEvent.setup() }
}

async function tap(person: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const digit of digits) {
    await person.click(screen.getByRole('button', { name: digit }))
  }
}

describe('CustomerDialog', () => {
  it('says nothing at all until the tenth digit, and asks nothing of the lookup', async () => {
    const lookup = vi.fn(async () => RITIKA)
    const { person } = open({ lookup })

    await tap(person, '900000010')

    expect(screen.getByTestId('customer-phone-readout')).toHaveTextContent('+91 90000 0010')
    // Not a spinner, not a hint, not a greyed card. Nothing.
    expect(screen.getByTestId('customer-resolution')).toBeEmptyDOMElement()
    expect(screen.getByTestId('customer-confirm')).toBeDisabled()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('resolves a saved customer to their name, and offers to use it', async () => {
    const lookup = vi.fn(async () => RITIKA)
    const { person, onChoose } = open({ lookup })

    await tap(person, '9000000101')

    // The name, and the number under it. No row-type heading over the top.
    const card = await screen.findByTestId('customer-match')
    expect(card).toHaveTextContent('Ritika Sen')
    expect(card).toHaveTextContent('+91 90000 00101')
    expect(screen.queryByText(/returning customer/i)).not.toBeInTheDocument()
    expect(lookup).toHaveBeenCalledExactlyOnceWith('+919000000101')
    // No name field: the saved name is the label, and there is nothing to type.
    expect(screen.queryByPlaceholderText('Name (optional)')).not.toBeInTheDocument()

    await person.click(screen.getByRole('button', { name: 'Use' }))
    expect(onChoose).toHaveBeenCalledWith({
      kind: 'identified',
      phone: '+919000000101',
      name: 'Ritika Sen',
    })
  })

  it('lets a matched customer who never gave a name still label this order', async () => {
    const { person, onChoose } = open({ lookup: vi.fn(async () => UNNAMED) })

    await tap(person, '9000000102')

    expect(await screen.findByText(/no saved name/i)).toBeInTheDocument()
    // Optional here, unlike the create path: this customer already exists and is
    // identified by their number, and completing their profile is not this
    // screen's job.
    expect(screen.getByPlaceholderText('Name (optional)')).not.toBeRequired()
    await person.type(screen.getByPlaceholderText('Name (optional)'), 'Window seat')
    await person.click(screen.getByRole('button', { name: 'Use' }))

    // The label goes on this order. The saved profile is not this screen's to
    // rewrite, and `createOrGet` would decline it anyway.
    expect(onChoose).toHaveBeenCalledWith({
      kind: 'identified',
      phone: '+919000000102',
      name: 'Window seat',
    })
  })

  it('will not save an unknown number without a name for it', async () => {
    const { person, onChoose } = open()

    await tap(person, '9000000999')

    // The field appearing IS the message: a number nobody has used announces
    // itself by asking for a name, not by a sentence saying the same thing a
    // line above it.
    const field = await screen.findByPlaceholderText(NEW_NAME)
    expect(screen.queryByTestId('customer-no-match')).not.toBeInTheDocument()
    // And this is the only moment that name can be set: `customer_create_or_get`
    // never rewrites a saved profile from a till, so a row saved nameless stays
    // nameless forever.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(field).toBeRequired()

    await person.type(field, 'Rahul')
    await person.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChoose).toHaveBeenCalledWith({
      kind: 'identified',
      phone: '+919000000999',
      name: 'Rahul',
    })
  })

  it('asks the tablet keyboard for a name rather than a sentence', async () => {
    const { person } = open()

    await tap(person, '9000000999')
    const field = await screen.findByPlaceholderText(NEW_NAME)

    // Hints to the on-screen keyboard, not rules about the value: `John Doe`
    // falls out of ordinary typing, and iOS does not correct a name into the
    // nearest dictionary word it knows.
    expect(field).toHaveAttribute('autocapitalize', 'words')
    expect(field).toHaveAttribute('autocorrect', 'off')
    expect(field).toHaveAttribute('spellcheck', 'false')

    // And what is typed is carried exactly as typed — title-casing in code
    // mangles the names this counter actually serves.
    await person.type(field, 'md rahim')
    expect(field).toHaveValue('md rahim')
  })

  it('saves on Enter, so the number never needs the button', async () => {
    const { person, onChoose } = open()

    await tap(person, '9000000999')
    await person.type(await screen.findByPlaceholderText(NEW_NAME), 'Rahul{Enter}')

    // The tablet's own keyboard sends the same key from its Go action, which is
    // what `enterKeyHint` labels.
    expect(onChoose).toHaveBeenCalledExactlyOnceWith({
      kind: 'identified',
      phone: '+919000000999',
      name: 'Rahul',
    })
  })

  it('does not save on Enter while the name is still missing', async () => {
    const { person, onChoose } = open()

    await tap(person, '9000000999')
    await person.type(await screen.findByPlaceholderText(NEW_NAME), '{Enter}')

    expect(onChoose).not.toHaveBeenCalled()
  })

  it('refuses to offer a save for ten digits that are not a mobile number', async () => {
    const lookup = vi.fn(async () => null)
    const { person } = open({ lookup })

    await tap(person, '1234567890')

    // The one case that still needs a sentence, because no field appears to
    // carry the message.
    expect(screen.getByTestId('customer-no-match')).toHaveTextContent(/invalid mobile number/i)
    // A form that fails on submit is worse than one that never opened.
    expect(screen.queryByPlaceholderText(NEW_NAME)).not.toBeInTheDocument()
    expect(screen.getByTestId('customer-confirm')).toBeDisabled()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('reads a rate-limited lookup exactly as a number that matched nobody', async () => {
    const { person } = open({
      lookup: vi.fn(async () => {
        throw new CustomerActionError('rate_limited', 'Too many lookups.')
      }),
    })

    await tap(person, '9000000101')

    // Which of refused, rate-limited or failed it was is only useful to
    // somebody probing the directory, so the dialog says none of it.
    // Exactly what a number nobody has used looks like: the name field, and no
    // word about why. Nothing on screen says the lookup was refused rather than
    // answered.
    await person.type(await screen.findByPlaceholderText(NEW_NAME), 'Rahul')
    expect(screen.queryByText(/too many/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('customer-no-match')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('marks a remembered match as read earlier and subject to recheck', async () => {
    const { person } = open({
      lookup: vi.fn(async () => ({ ...RITIKA, remembered: true as const })),
    })

    await tap(person, '9000000101')

    // The name still reads plainly; only the line about its age is added, and
    // only because it is true. A stale name given confidently is worse than one
    // given with its age.
    expect(await screen.findByText('Ritika Sen')).toBeInTheDocument()
    expect(screen.getByText(/checked again on sync/i)).toBeInTheDocument()
  })

  it('asks once for a complete number rather than once per digit', async () => {
    const lookup = vi.fn(async () => RITIKA)
    const { person } = open({ lookup })

    await tap(person, '9000000101')
    await waitFor(() => expect(lookup).toHaveBeenCalledOnce())

    // Nine of those ten keystrokes asked nothing. The per-caller bound on the
    // real directory is 120 in fifteen minutes, and a lookup per keystroke
    // would spend a tenth of it identifying one customer.
    await person.click(screen.getByRole('button', { name: 'Delete last digit' }))
    expect(screen.getByTestId('customer-resolution')).toBeEmptyDOMElement()
    await tap(person, '1')

    // Completing it again does ask again — the number is complete again, and
    // the answer may have changed at another till since.
    expect(await screen.findByText('Ritika Sen')).toBeInTheDocument()
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  describe('a partial number, among the customers this outlet has served', () => {
    const SERVED: CustomerIdentity[] = [
      RITIKA,
      UNNAMED,
      { id: 'c3', phone: '+919111111111', name: 'Arun Das' },
    ]

    it('says nothing below the floor, and asks nobody', async () => {
      const { person, suggest } = open({ served: SERVED })

      await tap(person, '900')

      expect(screen.getByTestId('customer-resolution')).toBeEmptyDOMElement()
      expect(suggest).not.toHaveBeenCalled()
    })

    it('offers the one best match, and says how many it is not showing', async () => {
      const { person } = open({ served: SERVED })

      await tap(person, '9000')

      const offered = await screen.findByTestId('customer-suggestion')
      expect(offered).toHaveTextContent('Ritika Sen')
      // One match, never a list — a list is a directory. The count is the only
      // thing about the others that ever reaches the screen.
      expect(screen.getAllByTestId('customer-suggestion')).toHaveLength(1)
      expect(screen.getByTestId('customer-suggestion-others')).toHaveTextContent('+1 more')
      expect(screen.queryByText('Arun Das')).not.toBeInTheDocument()
      // And it is text, not a control: opening the others is the browse path
      // this product does not have.
      expect(screen.getByTestId('customer-suggestion-others').tagName).not.toBe('BUTTON')
    })

    it('draws the digits still to be checked apart from the ones already typed', async () => {
      const { person } = open({ served: [RITIKA] })

      await tap(person, '90000')
      const offered = await screen.findByTestId('customer-suggestion')

      // `90000` is typed, `00101` is not, and the part worth reading is the
      // part the biller has yet to check against what the customer just said.
      expect(offered).toHaveTextContent('+91 90000 00101')
      expect(within(offered).getByText('00101')).toHaveClass('font-bold')
      expect(within(offered).getByText(/\+91 90000/)).toHaveClass('text-content-muted')
    })

    it('says nothing when no count is needed', async () => {
      const { person } = open({ served: [RITIKA] })

      await tap(person, '9000')

      expect(await screen.findByTestId('customer-suggestion')).toBeInTheDocument()
      expect(screen.queryByTestId('customer-suggestion-others')).not.toBeInTheDocument()
    })

    it('asks the directory nothing while the number is still partial', async () => {
      const lookup = vi.fn(async () => RITIKA)
      const { person } = open({ served: SERVED, lookup })

      await tap(person, '900000')

      expect(await screen.findByTestId('customer-suggestion')).toBeInTheDocument()
      // The whole-business lookup is for a complete number only. A partial one
      // reaches this outlet's own customers and stops there.
      expect(lookup).not.toHaveBeenCalled()
    })

    it('asks once for a number keyed straight through, not once per digit', async () => {
      const { person, suggest } = open({ served: SERVED })

      await tap(person, '900000')

      // Seven requests per customer on a bounded path is how a rate limit gets
      // spent on one person. The pad settles first.
      await screen.findByTestId('customer-suggestion')
      expect(suggest.mock.calls.length).toBeLessThan(3)
    })

    it('fills the number from the suggestion and then resolves it properly', async () => {
      const lookup = vi.fn(async () => RITIKA)
      const { person, onChoose } = open({ served: SERVED, lookup })

      await tap(person, '9000')
      await person.click(await screen.findByTestId('customer-suggestion'))

      // Tapping completes the number; the directory then answers for it like
      // any other identification, so what reaches the bill was identified the
      // same way every other customer is.
      expect(screen.getByTestId('customer-phone-readout')).toHaveTextContent('+91 90000 00101')
      expect(await screen.findByTestId('customer-match')).toHaveTextContent('Ritika Sen')
      expect(lookup).toHaveBeenCalledExactlyOnceWith('+919000000101')

      await person.click(screen.getByRole('button', { name: 'Use' }))
      expect(onChoose).toHaveBeenCalledWith({
        kind: 'identified',
        phone: '+919000000101',
        name: 'Ritika Sen',
      })
    })

    it('suggests nothing when this outlet has served nobody', async () => {
      const { person } = open({ served: [] })

      await tap(person, '9000')

      expect(screen.getByTestId('customer-resolution')).toBeEmptyDOMElement()
    })

    it('stops suggesting once the number is complete and the directory has answered', async () => {
      const { person } = open({ served: SERVED, lookup: vi.fn(async () => RITIKA) })

      await tap(person, '9000000101')

      expect(await screen.findByTestId('customer-match')).toBeInTheDocument()
      expect(screen.queryByTestId('customer-suggestion')).not.toBeInTheDocument()
    })
  })

  it('can be left without deciding anything', async () => {
    const { person, onClose, onChoose } = open()

    await tap(person, '9000')
    await person.click(screen.getByRole('button', { name: 'Close without deciding' }))

    // A biller opens this expecting a number and the customer starts changing
    // their order instead. Leaving records nothing — and because nothing was
    // recorded, Order and Mark Paid stay disabled, which is the reminder to
    // come back to it.
    expect(onClose).toHaveBeenCalledOnce()
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('skips on one tap, with nothing to confirm', async () => {
    const { person, onChoose } = open()

    await person.click(screen.getByRole('button', { name: 'Skip' }))

    // No second screen, no label to type, no Done. Skipping is the answer when
    // nobody offered a number, not a thing to be sure about.
    expect(onChoose).toHaveBeenCalledExactlyOnceWith({ kind: 'skipped', name: '' })
  })

  it('reopens a skipped row on the pad, so the decision can be taken back', async () => {
    const { person, onChoose } = open({ selection: { kind: 'skipped', name: '' } })

    // The reason a skip is reversible at all is that the customer has just
    // given their number, so that is what the dialog opens ready for.
    expect(screen.getByTestId('customer-phone-readout')).toHaveTextContent('+91')
    await tap(person, '9000000999')
    await person.type(await screen.findByPlaceholderText(NEW_NAME), 'Rahul')
    await person.click(screen.getByRole('button', { name: 'Save' }))

    expect(onChoose).toHaveBeenCalledWith({
      kind: 'identified',
      phone: '+919000000999',
      name: 'Rahul',
    })
  })

  it('keeps the name an older order was rung under, having no way to set one', async () => {
    // Every order rung before this change carries a name and no number.
    // Reopening one to add an item must not wipe that name, so it rides along
    // untouched.
    const { person, onChoose } = open({ selection: { kind: 'skipped', name: 'Demo Customer' } })

    expect(screen.queryByPlaceholderText('Order label (optional)')).not.toBeInTheDocument()
    await person.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onChoose).toHaveBeenCalledWith({ kind: 'skipped', name: 'Demo Customer' })
  })
})
