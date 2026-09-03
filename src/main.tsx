import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'

import { registerServiceWorker } from '@/pwa/register-sw'
import { InstallPromptProvider } from '@/pwa/install-prompt'
import { router } from '@/routes'
import { syncThemeColorMeta } from '@/theme/theme'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element in index.html')

syncThemeColorMeta()

createRoot(container).render(
  <StrictMode>
    <InstallPromptProvider>
      <RouterProvider router={router} />
    </InstallPromptProvider>
  </StrictMode>,
)

// Returns a disposer the app never needs — it lives as long as the document —
// but which the tests do, and which keeps the timers and listeners it owns
// accounted for rather than merely abandoned.
registerServiceWorker()
