import type { ReactNode, Ref } from 'react'

import { cn } from '@/lib/cn'

/**
 * The wrapper a form field is pointed at through (see `use-field-attention`).
 * While flagged it is outlined in the danger colour and its message sits right
 * under it; otherwise it draws nothing of its own.
 *
 * The outline is its own layer, a little outside the field, so it has room to
 * read as a frame and nothing on the page moves when it appears.
 */
export function AttentionField({
  attentionRef,
  message,
  className,
  testId,
  children,
}: {
  attentionRef: Ref<HTMLDivElement>
  message: string | null
  className?: string
  testId?: string
  children: ReactNode
}) {
  return (
    <div
      ref={attentionRef}
      data-invalid={message ? '' : undefined}
      data-testid={testId}
      className={cn('relative', className)}
    >
      {message && (
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-2 rounded-xl ring-2 ring-danger"
        />
      )}
      {children}
      {message && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {message}
        </p>
      )}
    </div>
  )
}
