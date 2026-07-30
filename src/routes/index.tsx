import { createBrowserRouter, redirect, type RouteObject } from 'react-router'

import { Activate } from '@/auth/activate'
import { OwnerRecovery } from '@/auth/owner-recovery'
import { RealRoot } from '@/auth/real-root'
import { SignIn } from '@/auth/sign-in'
import { DemoGate } from '@/demo/demo-gate'
import { DemoRoot } from '@/demo/demo-root'

import { Landing } from './landing'
import { NotFound } from './not-found'
import { RootLayout } from './root-layout'
import { roleSurfaceRoutes } from './surfaces'

/**
 * Three branches, deliberately (design D1 of #3, D2 of #4): the public one at
 * the root, the demo tree under /demo/:roleSegment, and the real role tree at
 * /:roleSegment — each with its own provider stack, and the two role trees
 * never mounted at the same time.
 *
 * The role branches share their children (`roleSurfaceRoutes`) because they
 * genuinely are the same surfaces; what differs is the gate registry's state
 * for each, which the shared `GatedSurface` consults per session.
 *
 * Static segments outrank the dynamic one in React Router's ranking, so
 * `/sign-in`, `/activate` and `/demo` are never swallowed by `/:roleSegment`.
 *
 * Exported so tests can mount the same tree in a memory router.
 */
export const appRoutes: RouteObject[] = [
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: Landing },
      { path: 'sign-in', Component: SignIn },
      { path: 'activate', Component: Activate },
      { path: 'recover', Component: OwnerRecovery },
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
        children: roleSurfaceRoutes,
      },
    ],
  },
  {
    path: '/:roleSegment',
    Component: RealRoot,
    children: roleSurfaceRoutes,
  },
]

export const router = createBrowserRouter(appRoutes, {
  // Vite's base — `/shawarmania-ops/` on GitHub Pages, `/` on a custom domain.
  // Routes stay written from the root regardless.
  basename: import.meta.env.BASE_URL,
})
