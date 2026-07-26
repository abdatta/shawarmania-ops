import { createBrowserRouter } from 'react-router'

import { Home } from './home'
import { NotFound } from './not-found'
import { RootLayout } from './root-layout'

export const router = createBrowserRouter(
  [
    {
      path: '/',
      Component: RootLayout,
      children: [
        { index: true, Component: Home },
        { path: '*', Component: NotFound },
      ],
    },
  ],
  // Vite's base — `/shawarmania-ops/` on GitHub Pages, `/` on a custom domain.
  // Routes stay written from the root regardless.
  { basename: import.meta.env.BASE_URL },
)
