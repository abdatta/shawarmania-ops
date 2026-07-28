import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VegMarker } from './veg-marker'

/**
 * The point of this component is that it does not rely on colour, so that is
 * what these assert: a different silhouette per value, and a name for anyone
 * who is not looking at it at all.
 */
describe('VegMarker', () => {
  it('draws a circle and names itself for a vegetarian item', () => {
    render(<VegMarker isVeg />)
    expect(screen.getByText('Vegetarian')).toBeInTheDocument()
    expect(screen.getByTestId('veg-marker-circle')).toBeInTheDocument()
    expect(screen.queryByTestId('veg-marker-triangle')).not.toBeInTheDocument()
  })

  it('draws a triangle and names itself for a non-vegetarian item', () => {
    render(<VegMarker isVeg={false} />)
    expect(screen.getByText('Non-vegetarian')).toBeInTheDocument()
    expect(screen.getByTestId('veg-marker-triangle')).toBeInTheDocument()
    expect(screen.queryByTestId('veg-marker-circle')).not.toBeInTheDocument()
  })

  it('reads its colour from the marker tokens, never from a status colour', () => {
    const { container: veg } = render(<VegMarker isVeg />)
    const { container: nonVeg } = render(<VegMarker isVeg={false} />)

    expect(veg.querySelector('svg')?.getAttribute('class')).toContain('text-marker-veg')
    expect(nonVeg.querySelector('svg')?.getAttribute('class')).toContain('text-marker-nonveg')
  })
})
