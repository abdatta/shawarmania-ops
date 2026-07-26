import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'

import { registerServiceWorker } from '@/pwa/register-sw'
import { router } from '@/routes'
import { syncThemeColorMeta } from '@/theme/theme'

import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element in index.html')

syncThemeColorMeta()

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

registerServiceWorker()
