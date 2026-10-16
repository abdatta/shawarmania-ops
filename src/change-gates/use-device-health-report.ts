import { useEffect } from 'react'

import type { ChangeGatesAdapter } from '@/data-access/adapters'
import { deviceRequestHealth, HEALTH_WINDOW_MS } from '@/data-access/request-health'
import { BUILD_SHA } from '@/pwa/build-info'

import { useChangeGate, useChangeGateSnapshot } from './context'
import { CHANGE_GATE_KEYS } from './gates'
import { offerGateAnswers } from './refresh'

/**
 * A tablet reports its health once as its page loads and every minute after —
 * its build, the gates this page loaded with on, and the last minute's requests,
 * failures and slowest request (a-release-can-be-switched-off, D13). Only while
 * the `tablet-health` gate was on at load; off, nothing new is sent. A report
 * that fails is dropped: the owner's page reads the silence as a silent tablet.
 *
 * With `carriesGates` (`fewer-requests` on, the-app-asks-the-server-less D8) the
 * report is answered with every gate's answer, handed to the running refresh in
 * place of its own minute read. A report that fails is followed by a plain read,
 * so a turned gate still reaches the tablet within the minute.
 */
export function useDeviceHealthReport(
  adapter:
    | (Pick<ChangeGatesAdapter, 'reportHealth'> &
        Partial<Pick<ChangeGatesAdapter, 'reportHealthReadingGates' | 'read'>>)
    | null
    | undefined,
  { carriesGates = false }: { carriesGates?: boolean } = {},
): void {
  const on = useChangeGate('tablet-health')
  const snapshot = useChangeGateSnapshot()

  useEffect(() => {
    if (!on || !adapter) return
    const bootedGates = CHANGE_GATE_KEYS.filter((key) => snapshot[key])
    const readingGates = carriesGates ? adapter.reportHealthReadingGates : undefined
    const read = adapter.read
    const report =
      readingGates && read
        ? () =>
            void readingGates
              .call(adapter, { build: BUILD_SHA, bootedGates, ...deviceRequestHealth.window() })
              .then(offerGateAnswers)
              .catch(() =>
                read
                  .call(adapter)
                  .then(offerGateAnswers)
                  .catch(() => undefined),
              )
        : () =>
            void adapter
              .reportHealth({ build: BUILD_SHA, bootedGates, ...deviceRequestHealth.window() })
              .catch(() => undefined)
    report()
    const timer = window.setInterval(report, HEALTH_WINDOW_MS)
    return () => window.clearInterval(timer)
  }, [on, adapter, snapshot, carriesGates])
}
