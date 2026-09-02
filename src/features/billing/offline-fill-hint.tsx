import { useContext } from 'react'

import { CounterDeviceContext } from '@/session/counter-context'

/**
 * Why a resumed counter's columns sit on shimmer for several seconds.
 *
 * A cold start with no backend still asks the server for each read and falls
 * back to the resume record only once the browser has given up, so the menu,
 * the pipeline and Bills this shift arrive around seven seconds in
 * (`docs/LIMITATIONS.md`). Every placeholder in this app is deliberately
 * wordless — shimmer blocks shaped like the content, announced only to a screen
 * reader — which is right for a read that takes a moment and wrong for one that
 * takes seven seconds with no connection. Three columns of silent grey blocks
 * read as a frozen tablet, and the recovery an operator reaches for is another
 * force-close, which starts the seven seconds over.
 *
 * So: one short line, saying the true thing. It is per column rather than one
 * banner because it must disappear exactly when *that* column arrives, which
 * makes it progress rather than a standing notice.
 *
 * `useContext` directly, not `useCounterDevice`, because these placeholders also
 * render on manager surfaces outside the tablet tree, where the hook throws by
 * design and the honest answer here is simply nothing.
 */
export function OfflineFillHint() {
  const device = useContext(CounterDeviceContext)
  if (!device?.offlineResume) return null

  return (
    <p className="text-xs font-semibold text-content-muted" data-testid="offline-fill-hint">
      Checking the server first — your saved copy loads in a moment.
    </p>
  )
}
