import type { ReactNode } from 'react'

/**
 * A labelled row shared by expense forms.
 *
 * Kept beside the promoted expense component so the retired notebook leaves no
 * UI dependency behind.
 */
export function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  )
}
