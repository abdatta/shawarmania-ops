import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { QrCode } from './qr-code'

const LINK = 'https://ops.example/activate?code=ABCDE-FGHJK'

describe('a scannable code', () => {
  it('is drawn in the page rather than fetched from anywhere', async () => {
    render(<QrCode value={LINK} title="Activation link for Someone" />)

    const mark = screen.getByRole('img', { name: 'Activation link for Someone' })
    expect(mark.tagName.toLowerCase()).toBe('svg')
    expect(mark.querySelectorAll('path').length).toBeGreaterThan(0)
    // Nothing to point at a host: the modules are geometry, not an image.
    expect(document.querySelector('img')).toBeNull()
  })

  it('enlarges on tap, because the panel has no room to draw it readably', async () => {
    const user = userEvent.setup()
    render(<QrCode value={LINK} title="Activation link for Someone" />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /tap to enlarge/ }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('announces one code, not two, while enlarged', async () => {
    const user = userEvent.setup()
    render(<QrCode value={LINK} title="Activation link for Someone" />)
    await user.click(screen.getByRole('button', { name: /tap to enlarge/ }))
    await screen.findByRole('dialog')

    // The big one is decoration for a camera; a screen reader that met it twice
    // would be told about a thing it cannot use, twice.
    expect(screen.getAllByRole('img', { name: 'Activation link for Someone' })).toHaveLength(1)
  })

  it('closes again', async () => {
    const user = userEvent.setup()
    render(<QrCode value={LINK} title="Activation link for Someone" />)

    await user.click(screen.getByRole('button', { name: /tap to enlarge/ }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('encodes what it was given, so the enlarged mark is the same code', async () => {
    const { rerender } = render(<QrCode value={LINK} title="A" />)
    const first = screen.getByRole('img', { name: 'A' }).querySelector('path')!.getAttribute('d')

    rerender(<QrCode value={`${LINK}-different`} title="A" />)
    const second = screen.getByRole('img', { name: 'A' }).querySelector('path')!.getAttribute('d')

    expect(second).not.toBe(first)
  })
})
