import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/**
 * A scannable code, drawn in the page.
 *
 * Generated here rather than fetched from an image service, for two reasons
 * that both matter: demo mode's guarantee is that no request leaves the app's
 * own origin, and the thing being encoded is a live bearer credential that has
 * no business being handed to a third party on its way to a screen.
 *
 * The colours come from `--qr-module` / `--qr-field`, which are identical in
 * both themes on purpose — most readers will not decode an inverted code, so
 * this mark cannot follow the theme (design D11).
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

  return (
    <svg
      role="img"
      aria-label={title}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} className="fill-qr-field" />
      <g transform={`translate(${quiet},${quiet})`}>
        <path d={rects} className="fill-qr-module" />
      </g>
    </svg>
  )
}
