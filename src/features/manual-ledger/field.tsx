import type { ReactNode } from 'react'

/**
 * A labelled form row, shared by the day form and the expense form.
 *
 * It lived at the bottom of `ledger-day.tsx` until the expense list was lifted
 * out into its own component (design D7) and the two forms stopped being in one
 * file. Moved rather than copied: two definitions would drift, and the day form
 * and the expense form sit one tap apart on the same surface.
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
