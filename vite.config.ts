import { execFileSync } from 'node:child_process'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, type Plugin } from 'vitest/config'

/**
 * GitHub Pages serves a project repo from `/<repo>/`, so that sub-path is the
 * default — `npm run build` produces a deployable artifact with no extra flag,
 * and dev, preview and the E2E suite all run under the same base as production.
 *
 * A custom domain serves from the root. Moving to one is `BASE_PATH=/` at build
 * time and nothing else.
 */
const base = process.env['BASE_PATH'] ?? '/shawarmania-ops/'

/** Short commit SHA, or `unknown` outside a git checkout (e.g. a source tarball). */
function buildSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

/**
 * GitHub Pages has no rewrite rules, so a deep link like `/reports/today` hits
 * static hosting that has no such file and returns its 404 page. Serving a copy
 * of the shell as `404.html` lets the SPA boot and route the URL itself.
 *
 * `.nojekyll` stops Pages from running the artifact through Jekyll, which
 * would drop any path segment beginning with an underscore.
 */
function githubPagesFallback(): Plugin {
  return {
    name: 'shawarmania:github-pages-fallback',
    apply: 'build',
    closeBundle() {
      const outDir = fileURLToPath(new URL('./dist', import.meta.url))
      copyFileSync(join(outDir, 'index.html'), join(outDir, '404.html'))
      writeFileSync(join(outDir, '.nojekyll'), '')
    },
  }
}

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // We register and update the worker ourselves in src/pwa/register-sw.ts,
      // so a new build is never applied mid-shift.
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Shawarmania Ops',
        short_name: 'Shawarmania',
        description: 'Cash-counter and outlet management for Shawarmania',
        // Base-relative, so the same config is correct under a project
        // sub-path and under a custom domain at the root.
        start_url: '.',
        scope: base,
        display: 'standalone',
        orientation: 'any',
        // The splash background matches the icon's own field (--brand-bg), so
        // an installed launch fades from the mark rather than flashing a pale
        // card behind it. theme_color is the light canvas; a manifest cannot
        // reference a CSS custom property, so it mirrors --brand-stone-50 by
        // hand, and the running app keeps its theme-color meta in sync with
        // the live token.
        background_color: '#14100b',
        theme_color: '#fafaf9',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
    githubPagesFallback(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
})
