import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { manifestNames, parseAppEnvironment } from '@/env/app-environment'

import { StagingBand } from './staging-band'

/**
 * A staging build says so on every screen and in its installed name
 * (a-release-can-be-switched-off, D19); a production build does neither.
 */
describe('the staging band', () => {
  it('shows on a staging build', () => {
    render(<StagingBand environment="staging" />)
    expect(screen.getByTestId('staging-band')).toHaveTextContent('Staging · not a real outlet')
  })

  it('is absent from a production build, and from this test build', () => {
    const { container } = render(<StagingBand environment="production" />)
    expect(container).toBeEmptyDOMElement()
    render(<StagingBand />)
    expect(screen.queryByTestId('staging-band')).toBeNull()
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
