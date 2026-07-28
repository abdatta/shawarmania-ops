import { Plus } from 'lucide-react'
import type { ComponentProps } from 'react'

import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/cn'

type AddButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  /**
   * What this adds, e.g. "Add outlet". Visible label is always the icon plus
   * "Add" — this becomes the accessible name instead, so screen reader users
   * get the same specificity sighted users get from page context.
   */
  label: string
}

/** The standard page-header "add new thing" trigger: a plus icon and the word "Add", never more. */
export function AddButton({ label, className, type = 'button', ...props }: AddButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(buttonVariants({ size: 'phone' }), 'whitespace-nowrap', className)}
      {...props}
    >
      <Plus aria-hidden size={18} />
      Add
    </button>
  )
}
