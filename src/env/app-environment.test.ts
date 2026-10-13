import { describe, expect, it } from 'vitest'

import { iconDirectory, manifestNames, parseAppEnvironment, withIconLinks } from './app-environment'

const HEAD = `
    <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
    <link rel="icon" type="image/png" sizes="48x48" href="/icons/favicon-48.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png" />
    <link rel="stylesheet" href="/src/index.css" />`

describe('app environment', () => {
  it('is staging only when the build says so exactly', () => {
    expect(parseAppEnvironment('staging')).toBe('staging')
    expect(parseAppEnvironment(undefined)).toBe('production')
    expect(parseAppEnvironment('Staging')).toBe('production')
  })

  it('installs a staging build under its own name and its own icons', () => {
    expect(manifestNames('staging').short_name).toBe('Staging')
    expect(iconDirectory('staging')).toBe('icons/staging')
    expect(iconDirectory('production')).toBe('icons')
  })

  it('points a staging page’s icon links at the staging set, and nothing else', () => {
    const html = withIconLinks(HEAD, 'staging')
    expect(html).toContain('href="/icons/staging/favicon-32.png"')
    expect(html).toContain('href="/icons/staging/favicon-48.png"')
    expect(html).toContain('href="/icons/staging/apple-touch-icon-180.png"')
    expect(html).toContain('href="/src/index.css"')
    expect(html.match(/icons\/staging/g)).toHaveLength(3)
  })

  it('leaves a production page’s links as written', () => {
    expect(withIconLinks(HEAD, 'production')).toBe(HEAD)
  })
})
