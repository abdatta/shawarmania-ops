import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AddressSearch } from './address-search'
import type { AddressSuggestion } from '@/data-access/adapters'

/**
 * The combobox, as a person operates it: with a keyboard, with a thumb, and
 * with a lookup that is sometimes slow and sometimes simply not there.
 */

const KALYANI: AddressSuggestion = {
  id: 'a',
  label: 'Central Park, B-7, Kalyani, 741235',
  placeName: 'Central Park',
  addressLine1: 'Central Park',
  addressLine2: 'B-7',
  city: 'Kalyani',
  pincode: '741235',
}

const KANCHRAPARA: AddressSuggestion = {
  id: 'b',
  label: 'Kanchrapara Station Road, Kanchrapara, 743145',
  placeName: 'Kanchrapara Station Road',
  addressLine1: 'Kanchrapara Station Road',
  addressLine2: '',
  city: 'Kanchrapara',
  pincode: '743145',
}

function setup(suggest: (query: string, signal?: AbortSignal) => Promise<AddressSuggestion[]>) {
  const onPick = vi.fn()
  render(<AddressSearch suggest={suggest} onPick={onPick} label="Find the address" />)
  return { onPick, user: userEvent.setup() }
}

describe('searching for an address', () => {
  it('offers what came back and hands the whole place to the caller', async () => {
    const { onPick, user } = setup(async () => [KALYANI, KANCHRAPARA])

    await user.type(screen.getByRole('combobox', { name: 'Find the address' }), 'kalyani')
    await user.click(await screen.findByRole('option', { name: /Central Park/ }))

    expect(onPick).toHaveBeenCalledWith(KALYANI)
  })

  it('is operable without a mouse', async () => {
    const { onPick, user } = setup(async () => [KALYANI, KANCHRAPARA])
    const box = screen.getByRole('combobox', { name: 'Find the address' })

    await user.type(box, 'road')
    await screen.findByRole('listbox')

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(box).toHaveAttribute('aria-activedescendant')
    await user.keyboard('{Enter}')

    expect(onPick).toHaveBeenCalledWith(KANCHRAPARA)
  })

  it('closes on Escape without picking anything', async () => {
    const { onPick, user } = setup(async () => [KALYANI])

    await user.type(screen.getByRole('combobox', { name: 'Find the address' }), 'kalyani')
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(onPick).not.toHaveBeenCalled()
  })

  it('asks nothing until there is enough to ask about', async () => {
    const suggest = vi.fn(async () => [KALYANI])
    const { user } = setup(suggest)

    await user.type(screen.getByRole('combobox', { name: 'Find the address' }), 'ka')

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(suggest).not.toHaveBeenCalled()
  })

  it('says so when there is nothing, because silence looks like still loading', async () => {
    const { user } = setup(async () => [])

    await user.type(screen.getByRole('combobox', { name: 'Find the address' }), 'nowhere at all')

    expect(await screen.findByTestId('address-no-matches')).toHaveTextContent(
      'Type the address in the fields below',
    )
  })

  it('shows no error when the lookup is simply unavailable', async () => {
    // The adapter resolves empty rather than throwing, and an optional shortcut
    // that failed is not something anybody needs to be told to fix.
    const { user } = setup(async () => [])

    await user.type(screen.getByRole('combobox', { name: 'Find the address' }), 'anywhere')

    expect(await screen.findByTestId('address-no-matches')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lets an aborted answer lose to the one that replaced it', async () => {
    // A slow response to the earlier keystrokes must not overwrite the list the
    // person is actually looking at.
    const suggest = vi.fn(
      (query: string, signal?: AbortSignal) =>
        new Promise<AddressSuggestion[]>((resolve) => {
          const slow = query.length < 8
          setTimeout(
            () => resolve(signal?.aborted ? [] : slow ? [KANCHRAPARA] : [KALYANI]),
            slow ? 60 : 0,
          )
        }),
    )
    const { user } = setup(suggest)

    const box = screen.getByRole('combobox', { name: 'Find the address' })
    await user.type(box, 'central park kalyani')

    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Central Park')
  })

  it('does not reopen the list over the text a pick just wrote', async () => {
    const { user } = setup(async () => [KALYANI])

    await user.type(screen.getByRole('combobox', { name: 'Find the address' }), 'kalyani')
    await user.click(await screen.findByRole('option', { name: /Central Park/ }))

    expect(screen.getByRole('combobox', { name: 'Find the address' })).toHaveValue('Central Park')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })
})
