import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { expect, it } from 'vitest'

import { AdaptersContext } from '@/data-access/adapters-context'
import { createMockAdapters } from '@/data-access/mock'
import { OUTLET_KALYANI_ID } from '@/data-access/mock/fixtures/outlets'
import { SessionContext } from '@/session/context'
import { chooseOutlet } from '@/test/outlet-scope'
import { demoSessionFor } from '@/test/session'

import { DeliverySyncSurface } from './delivery-sync-surface'

/**
 * While a sync runs, the page asks again every three seconds
 * (the-app-asks-the-server-less, D7).
 */
it('checks a running sync every three seconds', async () => {
  const adapters = createMockAdapters('super_admin')
  const readsHealth = adapters.aggregatorSync.getHealth
  let healthReads = 0
  adapters.aggregatorSync.getHealth = async (outletId) => {
    healthReads += 1
    return { ...(await readsHealth(outletId)), running: true }
  }

  render(
    <MemoryRouter initialEntries={['/demo/owner/ledger/delivery/zomato']}>
      <SessionContext.Provider value={demoSessionFor('super_admin')}>
        <AdaptersContext.Provider value={adapters}>
          <Routes>
            <Route path="/demo/owner/ledger/delivery/:channel" element={<DeliverySyncSurface />} />
          </Routes>
        </AdaptersContext.Provider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
  await chooseOutlet(OUTLET_KALYANI_ID)
  await screen.findByTestId('hyperpure-health')
  const settled = healthReads

  // Long enough for three 0.7 s checks, and short of one three-second one.
  await new Promise((resolve) => setTimeout(resolve, 2_400))

  expect(healthReads - settled).toBe(0)

  // And it does still check: past three seconds, at least once more.
  await new Promise((resolve) => setTimeout(resolve, 1_200))
  expect(healthReads - settled).toBeGreaterThanOrEqual(1)
}, 15_000)
