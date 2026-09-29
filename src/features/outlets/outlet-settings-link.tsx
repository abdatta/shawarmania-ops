import { useMemo, useState, type ReactNode } from 'react'

import {
  OutletSettingsLinkContext,
  type GoldPackagingLink,
} from '@/features/outlets/outlet-settings-link-context'

/** Where the outlet page's Orders and Loyalty sections meet. See `outlet-settings-link-context`. */
export function OutletSettingsLinkProvider({ children }: { children: ReactNode }) {
  const [goldPackaging, publishGoldPackaging] = useState<GoldPackagingLink | null>(null)
  const [goldOn, publishGoldOn] = useState<boolean | null>(null)
  const value = useMemo(
    () => ({ goldPackaging, publishGoldPackaging, goldOn, publishGoldOn }),
    [goldPackaging, goldOn],
  )
  return (
    <OutletSettingsLinkContext.Provider value={value}>
      {children}
    </OutletSettingsLinkContext.Provider>
  )
}
