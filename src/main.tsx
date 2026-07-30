import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'

import { registerServiceWorker } from '@/pwa/register-sw'
import { InstallPromptProvider } from '@/pwa/install-prompt'
import { router } from '@/routes'
import { syncThemeColorMeta } from '@/theme/theme'

import './index.css'

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

registerServiceWorker()
