import { cva } from 'class-variance-authority'

/**
 * Kept out of button.tsx so the component file exports only components — and
 * so a non-button element that must look like one (a react-router `Link`, for
 * instance) can borrow the classes without importing a component it will not
 * render.
 *
 * Sizes come from docs/DESIGN_SYSTEM.md and are deliberately larger at the
 * counter than on a phone: billing happens fast, one-handed, sometimes with wet
 * or greasy hands, while a customer waits. A missed tap costs real time in
 * front of a real queue.
 */
export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 rounded-lg font-semibold ' +
    'transition-[filter,background-color] disabled:pointer-events-none disabled:opacity-50 ' +
    'focus-visible:focus-ring',
  {
    variants: {
      variant: {
        // No border needed: the ember fill is 5.2:1 against a light card and
        // 6.2:1 against a dark one, so the button's own boundary is legible.
        // The contrast validator asserts this, passing "via --primary".
        primary: 'bg-primary text-on-primary hover:brightness-95',
        secondary: 'border border-border bg-surface text-content hover:bg-surface-raised',
        ghost: 'text-content hover:bg-surface-raised',
        danger: 'bg-danger text-surface hover:brightness-95',
      },
      size: {
        /** 48px — standard control on the counter tablet. */
        control: 'h-[var(--size-control)] px-5 text-base',
        /** 44px — standard control on a manager phone. */
        phone: 'h-[var(--size-control-phone)] px-4 text-sm',
        /** 56px — menu item tile. The largest target in the app, on purpose. */
        tile: 'h-[var(--size-tile)] min-w-[var(--size-tile)] px-4 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'control' },
  },
)
