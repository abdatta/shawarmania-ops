/**
 * The address a customer opens to read an outlet's menu.
 *
 * Served by the same Cloudflare Worker on the brand site as the public receipt
 * (`shawarmania.in/menu/<slug>/`), which reads the menu through
 * `public_menu` with a server-side credential. So, like {@link receiptLink}, it
 * is built from the configured brand-site base rather than from this app's own
 * origin — and pointing `VITE_RECEIPT_BASE_URL` at `wrangler dev` points this at
 * the local Worker too.
 *
 * The slug is the outlet's stored `menu_slug`, not anything derived here: it is
 * what printed table QR codes carry, and the database is the one place that
 * decides it (the-menu-is-public, design D1).
 */
import { RECEIPT_BASE_URL } from './receipt-link'

/** The public shape of a slug, mirroring the database's `outlets_menu_slug_shape`. */
export const MENU_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const MENU_SLUG_MAX_LENGTH = 60

/** The brand-site host a manager reads beside the field, without the scheme. */
export function publicMenuHost(base: string = RECEIPT_BASE_URL): string {
  return `${base.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/menu/`
}

/** The public menu URL for a stored slug, or null for an outlet without one. */
export function publicMenuLink(
  slug: string | null | undefined,
  base: string = RECEIPT_BASE_URL,
): string | null {
  if (!slug) return null
  return `${base.replace(/\/+$/, '')}/menu/${encodeURIComponent(slug)}/`
}

/**
 * The slug the database derives from a name (`menu_slug_from`): lowercase
 * letters and digits, words joined by single hyphens. Used by demo mode, which
 * has no database to derive it, and by the Outlets form to show the address a
 * new outlet will get before it is saved.
 */
export function menuSlugFrom(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * What the owner typed, as the database will store it: trimmed and lowercased.
 * Blank stays blank — on create that means "derive it from the name", on edit
 * "keep the one it has".
 */
export function normaliseMenuSlug(typed: string): string {
  return typed.trim().toLowerCase()
}

/** Why a typed slug would be refused, or null when it is fine (or blank). */
export function menuSlugProblem(typed: string): string | null {
  const slug = normaliseMenuSlug(typed)
  if (slug === '') return null
  if (slug.length > MENU_SLUG_MAX_LENGTH) {
    return `A public menu address can be at most ${MENU_SLUG_MAX_LENGTH} characters.`
  }
  if (!MENU_SLUG_PATTERN.test(slug)) {
    return 'A public menu address uses only letters, digits and single hyphens between words, like “kalyani-cafe”.'
  }
  return null
}
