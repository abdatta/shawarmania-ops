import { createBrowserRouter, redirect, type RouteObject } from 'react-router'

import { Activate } from '@/auth/activate'
import { RealRoot } from '@/auth/real-root'
import { RealSessionProvider } from '@/auth/real-session-provider'
import { SignIn } from '@/auth/sign-in'
import { DemoGate } from '@/demo/demo-gate'
import { DemoRoot } from '@/demo/demo-root'

import { NotFound } from './not-found'
import { RootLayout } from './root-layout'
import { RootResolver } from './root-resolver'
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
 * **Two of those three branches are nested under a pathless provider, and demo
 * is not** (the-root-resolves-instead-of-greeting, design D5). The public and
 * real branches share one resolved session, so a visit asks who somebody is
 * once instead of once per screen; `RealSessionProvider` is where that happens.
 * A pathless route contributes no URL segment, so nesting changes no path and no
 * ranking — the property below is a function of the child paths, which are
 * untouched.
 *
 * **Demo mode stays a sibling on purpose, and the reason is worth stating.**
 * `getSupabaseClient()` throws while demo scope is active, and `resolveSession`
 * turns any throw into `indeterminate` — so a provider above /demo would trip
 * the demo tripwire and have it swallowed, which is a silent failure rather than
 * the loud one the tripwire exists to produce. Keeping them apart in the tree
 * makes the situation impossible instead of merely detected.
 *
 * Static segments outrank the dynamic one in React Router's ranking, so
 * `/sign-in`, `/activate` and `/demo` are never swallowed by `/:roleSegment`.
 *
 * Exported so tests can mount the same tree in a memory router.
 */
export const appRoutes: RouteObject[] = [
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
    Component: RealSessionProvider,
    children: [
      // Outside RootLayout, deliberately. The root renders only transient
      // states, and each of them belongs to a whole screen rather than to a
      // content area: the placeholder reserves a shell, and the "could not
      // confirm" card centres itself in the viewport. Wrapped in the public
      // chrome it would draw a header strip beneath the real header, and hand a
      // signed-in person the public layout on the way to their own shell
      // (the-root-resolves-instead-of-greeting, design D4).
      { path: '/', Component: RootResolver },
      {
        Component: RootLayout,
        children: [
          { path: 'sign-in', Component: SignIn },
          { path: 'activate', Component: Activate },
          { path: '*', Component: NotFound },
        ],
      },
      {
        path: '/:roleSegment',
        Component: RealRoot,
        children: roleSurfaceRoutes,
      },
    ],
  },
]

export const router = createBrowserRouter(appRoutes, {
  // Vite's base — `/shawarmania-ops/` on GitHub Pages, `/` on a custom domain.
  // Routes stay written from the root regardless.
  basename: import.meta.env.BASE_URL,
})
