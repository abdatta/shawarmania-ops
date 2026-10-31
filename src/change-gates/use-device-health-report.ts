import { useEffect } from 'react'

import type { ChangeGatesAdapter } from '@/data-access/adapters'
import { deviceRequestHealth, HEALTH_WINDOW_MS } from '@/data-access/request-health'
import { BUILD_SHA } from '@/pwa/build-info'

import { useChangeGateSnapshot } from './context'
import { CHANGE_GATE_KEYS } from './gates'
import { offerGateAnswers } from './refresh'

/**
 * A tablet reports its health once as its page loads and every minute after —
 * its build, the gates this page loaded with on, and the last minute's requests,
 * failures and slowest request (a-release-can-be-switched-off, D13). A report
 * that fails is not sent again: the owner's page reads the silence as a silent
 * tablet.
 *
 * The report is answered with every gate's answer, handed to the running refresh
 * in place of its own minute read (the-app-asks-the-server-less, D8). A report
 * that fails is followed by a plain read, so a turned gate still reaches the
 * tablet within the minute.
 */
export function useDeviceHealthReport(
  adapter: Pick<ChangeGatesAdapter, 'reportHealthReadingGates' | 'read'> | null | undefined,
): void {
  const snapshot = useChangeGateSnapshot()

  useEffect(() => {
    if (!adapter) return
    const bootedGates = CHANGE_GATE_KEYS.filter((key) => snapshot[key])
    const report = () =>
      void adapter
        .reportHealthReadingGates({
          build: BUILD_SHA,
          bootedGates,
          ...deviceRequestHealth.window(),
        })
        .then(offerGateAnswers)
        .catch(() =>
          adapter
            .read()
            .then(offerGateAnswers)
            .catch(() => undefined),
        )
    report()
    const timer = window.setInterval(report, HEALTH_WINDOW_MS)
    return () => window.clearInterval(timer)
  }, [adapter, snapshot])
}
