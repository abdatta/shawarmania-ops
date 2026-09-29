import { createContext, useContext, useEffect, useRef } from 'react'

/**
 * What the outlet page's two settings sections tell each other
 * (a-regular-earns-points-and-gold, [owner, 2026-09-29]).
 *
 * **Every gold setting is also shown under Gold members**, so turning gold on
 * shows at once everything gold changes — including *Free for gold members*,
 * which belongs to Orders' packaging and sits a section above. The two copies
 * are one value: the Loyalty section's copy edits Orders' own draft through this
 * link, and Loyalty's Save saves it, so nobody has to scroll up to a second Save
 * to keep what they just switched.
 *
 * And the other way: Orders shows *Free for gold members* only while the
 * outlet has gold, and it follows Loyalty's switch as it is flicked, not only
 * once it is saved.
 *
 * Nothing here is stored or authorises anything. It is two sections of one
 * page agreeing about what is on screen; each still writes through its own
 * adapter call, which the database checks.
 */

/** Orders' free-packaging switch, as Loyalty may show and change it. */
export interface GoldPackagingLink {
  /** Whether packaging is charged at all in Orders' current draft. */
  available: boolean
  value: boolean
  /** Whether Orders has anything unsaved, which Loyalty's Save will save too. */
  dirty: boolean
  set(value: boolean): void
  /** Save Orders' draft. Resolves false when it was refused, with the reason shown in Orders. */
  save(): Promise<boolean>
}

export interface OutletSettingsLink {
  goldPackaging: GoldPackagingLink | null
  publishGoldPackaging(link: GoldPackagingLink | null): void
  /** The Gold members switch as it stands in Loyalty's draft, or null before it is known. */
  goldOn: boolean | null
  publishGoldOn(on: boolean | null): void
}

export const OutletSettingsLinkContext = createContext<OutletSettingsLink | null>(null)

/** The link, or null on a page that has only one of the sections. */
export function useOutletSettingsLink(): OutletSettingsLink | null {
  return useContext(OutletSettingsLinkContext)
}

/**
 * Orders' side: publish the free-packaging switch while it is mounted. Only
 * the three plain facts decide when it is republished; the two actions are
 * read through refs, so a new function every render does not loop the page.
 */
export function usePublishGoldPackaging(facts: {
  available: boolean
  value: boolean
  dirty: boolean
  set: (value: boolean) => void
  save: () => Promise<boolean>
}) {
  const link = useOutletSettingsLink()
  const publish = link?.publishGoldPackaging
  const setRef = useRef(facts.set)
  const saveRef = useRef(facts.save)
  useEffect(() => {
    setRef.current = facts.set
    saveRef.current = facts.save
  })
  const { available, value, dirty } = facts
  useEffect(() => {
    if (!publish) return
    publish({
      available,
      value,
      dirty,
      set: (next) => setRef.current(next),
      save: () => saveRef.current(),
    })
  }, [publish, available, value, dirty])
  useEffect(() => () => publish?.(null), [publish])
}

/** Loyalty's side: publish the Gold members switch as it stands in the draft. */
export function usePublishGoldOn(on: boolean) {
  const publish = useOutletSettingsLink()?.publishGoldOn
  useEffect(() => {
    publish?.(on)
  }, [publish, on])
  useEffect(() => () => publish?.(null), [publish])
}
