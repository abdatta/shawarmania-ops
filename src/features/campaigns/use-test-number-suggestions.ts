import { useEffect, useState } from 'react'

import { useAdapters } from '@/data-access'

/** Numbers used on earlier campaigns, read once as the box opens. */
export function useTestNumberSuggestions(): string[] {
  const { campaigns } = useAdapters()
  const [phones, setPhones] = useState<string[]>([])
  useEffect(() => {
    let current = true
    campaigns
      .testNumberSuggestions()
      .then((answer) => {
        if (current) setPhones(answer)
      })
      .catch(() => {
        // Suggestions are a convenience; a number can still be typed.
      })
    return () => {
      current = false
    }
  }, [campaigns])
  return phones
}
