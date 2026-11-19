import { useEffect, useState } from 'react'

import { useAdapters } from '@/data-access'

/**
 * The name of the outlet an audience is drawn from, **only where there is more
 * than one to tell apart**. With one trading outlet the name is a word on every
 * campaign that says nothing, so this answers null and the page leaves it out.
 */
export function useOutletName(outletId: string | null): string | null {
  const { outlets } = useAdapters()
  const [names, setNames] = useState<ReadonlyMap<string, string> | null>(null)
  useEffect(() => {
    if (outletId === null) return
    let active = true
    outlets
      .listOutlets()
      .then((rows) => {
        if (active) setNames(new Map(rows.map((row) => [row.id, row.name])))
      })
      .catch(() => {
        // A name the page can do without; the audience's other words still show.
      })
    return () => {
      active = false
    }
  }, [outlets, outletId])
  if (outletId === null || names === null || names.size < 2) return null
  return names.get(outletId) ?? null
}
