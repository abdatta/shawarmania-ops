import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { manifestNames, parseAppEnvironment } from '@/env/app-environment'

import { StagingRibbon } from './staging-ribbon'

/**
 * A staging build says so on every screen, with a ribbon in its corner, and in
 * its installed name
 * (a-release-can-be-switched-off, D19); a production build does neither.
 */
describe('the staging ribbon', () => {
  it('shows on a staging build, saying Staging, and naming itself to a screen reader', () => {
    render(<StagingRibbon environment="staging" />)
    const ribbon = screen.getByRole('note', { name: 'Staging · not a real outlet' })
    expect(ribbon).toHaveTextContent('Staging')
    expect(ribbon).toHaveAttribute('data-testid', 'staging-ribbon')
  })

  it('floats over the corner, letting every tap through to what is under it', () => {
    render(<StagingRibbon environment="staging" />)
    const ribbon = screen.getByTestId('staging-ribbon')
    expect(ribbon).toHaveClass('fixed', 'pointer-events-none')
    expect(ribbon.firstElementChild).toHaveClass('whitespace-nowrap')
  })

  it('is absent from a production build, and from this test build', () => {
    const { container } = render(<StagingRibbon environment="production" />)
    expect(container).toBeEmptyDOMElement()
    render(<StagingRibbon />)
    expect(screen.queryByTestId('staging-ribbon')).toBeNull()
  })

  it('is decided only by VITE_APP_ENVIRONMENT=staging; anything else is production', () => {
    expect(parseAppEnvironment('staging')).toBe('staging')
    for (const value of [undefined, '', 'production', 'Staging', 'stage']) {
      expect(parseAppEnvironment(value)).toBe('production')
    }
  })

  it('names an installed staging app so it cannot pass for the counter’s', () => {
    expect(manifestNames('staging').name).toBe('Shawarmania Ops (staging)')
    expect(manifestNames('production')).toEqual({
      name: 'Shawarmania Ops',
      short_name: 'Shawarmania',
    })
  })
})
