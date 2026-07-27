import { createBrowserRouter, redirect, type RouteObject } from 'react-router'

import { DemoGate } from '@/demo/demo-gate'
import { DemoHome } from '@/demo/demo-home'
import { DemoRoot } from '@/demo/demo-root'

import { Landing } from './landing'
import { NotFound } from './not-found'
import { RootLayout } from './root-layout'

/**
 * Two separate branches, deliberately (design D1): the real tree at the root
 * and the demo tree under /demo/:roleSegment, each with its own provider
 * stack. Surfaces gain routes here only as the gate registry lets them
 * render — a `hidden` surface has no route at all, so a deep link to one
 * lands on NotFound rather than a greyed-out shell.
 *
 * Exported so tests can mount the same tree in a memory router.
 */
export const appRoutes: RouteObject[] = [
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: Landing },
      { path: '*', Component: NotFound },
    ],
  },
  {
    path: '/demo',
    Component: DemoGate,
    children: [
      { index: true, loader: () => redirect('/demo/owner') },
      {
        path: ':roleSegment',
        Component: DemoRoot,
        children: [
          { index: true, Component: DemoHome },
          // Hidden surfaces have no route: anything else under a role shell
          // is honestly absent, inside the shell chrome.
          { path: '*', Component: NotFound },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(appRoutes, {
  // Vite's base — `/shawarmania-ops/` on GitHub Pages, `/` on a custom domain.
  // Routes stay written from the root regardless.
  basename: import.meta.env.BASE_URL,
})
