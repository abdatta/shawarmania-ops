import qrcode from 'qrcode-generator'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { cn } from '@/lib/cn'

/**
 * A scannable code, drawn in the page — and enlargeable, because the panel it
 * sits in has no room to draw it at a size another phone can reliably read.
 *
 * Generated here rather than fetched from an image service, for two reasons
 * that both matter: demo mode's guarantee is that no request leaves the app's
 * own origin, and the thing being encoded is a live bearer credential that has
 * no business being handed to a third party on its way to a screen.
 *
 * The colours come from `--qr-module` / `--qr-field`, which are identical in
 * both themes on purpose — most readers will not decode an inverted code, so
 * this mark cannot follow the theme (design D11).
 *
 * The enlargement lives here rather than in the screen that uses it: the
 * reason to tap a QR is always the same, so anywhere one appears should behave
 * the same way without the caller arranging it.
 */
export function QrCode({
  value,
  title,
  className,
}: {
  value: string
  /** Announced to a screen reader, which cannot scan anything. */
  title: string
  className?: string
}) {
  const [enlarged, setEnlarged] = useState(false)

  const { count, rects } = useMemo(() => {
    // Type 0 picks the smallest version that fits; M is the usual trade of
    // capacity against smudge tolerance, and an activation link fits easily.
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()

    const moduleCount = qr.getModuleCount()
    const dark: string[] = []
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) dark.push(`M${col},${row}h1v1h-1z`)
      }
    }
    return { count: moduleCount, rects: dark.join('') }
  }, [value])

  // Four modules of quiet zone on every side — below that, readers start
  // failing on busy backgrounds.
  const quiet = 4
  const size = count + quiet * 2

  const mark = (markClassName: string, hidden: boolean) => (
    <svg
      {...(hidden ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
      viewBox={`0 0 ${size} ${size}`}
      className={markClassName}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} className="fill-qr-field" />
      <g transform={`translate(${quiet},${quiet})`}>
        <path d={rects} className="fill-qr-module" />
      </g>
    </svg>
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        aria-label={`${title} — tap to enlarge`}
        className={cn('block cursor-zoom-in rounded-lg', className)}
      >
        {mark('h-full w-full rounded-lg', false)}
      </button>

      {/*
        Deliberately as large as the screen allows. The whole point of the
        enlargement is that the other phone's camera is being held at arm's
        length across a counter, and a 144px mark on a 375px screen is exactly
        the size that almost works.
      */}
      <Modal
        open={enlarged}
        onClose={() => setEnlarged(false)}
        aria-label={title}
        className="m-auto rounded-2xl p-4"
      >
        <div className="flex flex-col items-center gap-4">
          {mark('h-[min(80vw,26rem)] w-[min(80vw,26rem)] rounded-lg', true)}
          <Button variant="secondary" size="phone" onClick={() => setEnlarged(false)}>
            Close
          </Button>
        </div>
      </Modal>
    </>
  )
}
