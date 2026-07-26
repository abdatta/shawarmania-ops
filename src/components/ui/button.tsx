import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/cn'

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}
