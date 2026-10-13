import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'

import { registerServiceWorker } from '@/pwa/register-sw'
import { InstallPromptProvider } from '@/pwa/install-prompt'
import { ChangeGatesContext } from '@/change-gates/context'
import { bootSnapshot } from '@/change-gates/snapshot'
import { router } from '@/routes'
import { syncThemeColorMeta } from '@/theme/theme'

import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element in index.html')

syncThemeColorMeta()

createRoot(container).render(
  <StrictMode>
    {/* The change gates this page loaded with, fixed until it reloads
        (a-release-can-be-switched-off, D5). Above the router so every branch —
        phone, counter, kitchen — reads the same answers; the demo tree provides
        its own over them. */}
    <ChangeGatesContext.Provider value={bootSnapshot()}>
      <InstallPromptProvider>
        <RouterProvider router={router} />
      </InstallPromptProvider>
    </ChangeGatesContext.Provider>
  </StrictMode>,
)

// Returns a disposer the app never needs — it lives as long as the document —
// but which the tests do, and which keeps the timers and listeners it owns
// accounted for rather than merely abandoned.
registerServiceWorker()
