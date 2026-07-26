#!/usr/bin/env node
/**
 * Derive the icon set from the brand master.
 *
 * Source of truth: assets/brand/shawarmania-mark-512.png — the same mark the
 * Shawarmania site serves as its favicon. Everything under public/icons/ is
 * generated from it, so replacing the master and re-running this is the whole
 * job of changing the app's icon.
 *
 *   npm run icons:generate
 *
 * Dependency-free by design (see scripts/lib/png.mjs for why). Deterministic:
 * re-running without changing the master produces byte-identical output.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { canvas, decodePng, drawOnto, encodePng, flatten, resize } from './lib/png.mjs'

const MASTER = fileURLToPath(new URL('../assets/brand/shawarmania-mark-512.png', import.meta.url))
const OUT_DIR = fileURLToPath(new URL('../public/icons', import.meta.url))

/**
 * The mark sits on a solid field with transparent rounded corners. Find that
 * field colour by taking the most common fully-opaque colour in the outer
 * ring, rather than hard-coding it — if the artwork is ever replaced, the
 * derived background follows it instead of silently disagreeing.
 */
function backgroundColour(image) {
  const ring = Math.round(image.width * 0.12)
  const counts = new Map()

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const inRing = x < ring || y < ring || x >= image.width - ring || y >= image.height - ring
      if (!inRing) continue

      const i = (y * image.width + x) * 4
      if (image.data[i + 3] !== 255) continue

      const key = `${image.data[i]},${image.data[i + 1]},${image.data[i + 2]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  if (counts.size === 0) throw new Error('No opaque pixels in the outer ring of the master')

  const [modal] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return modal.split(',').map(Number)
}

const master = decodePng(readFileSync(MASTER))
if (master.width !== master.height) {
  throw new Error(`Master must be square, got ${master.width}x${master.height}`)
}

const background = backgroundColour(master)
mkdirSync(OUT_DIR, { recursive: true })

function write(name, image) {
  writeFileSync(join(OUT_DIR, name), encodePng(image))
  process.stdout.write(`  ${name.padEnd(28)} ${image.width}px\n`)
}

/**
 * `purpose: any` icons keep the transparent rounded corners — launchers that
 * respect them get the mark's own silhouette rather than a square.
 */
write('icon-512.png', master)
write('icon-192.png', resize(master, 192, 192))

/**
 * A maskable icon is cropped to whatever shape the platform chooses, so the
 * art has to survive a circle. Full-bleed background, mark inset to the 80%
 * safe zone. Without this the rounded corners get clipped and the mark loses
 * its edges on Android.
 */
const SAFE_ZONE = 0.8
const inset = Math.round((512 * (1 - SAFE_ZONE)) / 2)
write(
  'icon-maskable-512.png',
  drawOnto(canvas(512, background), resize(master, 512 - inset * 2, 512 - inset * 2), inset, inset),
)

/**
 * iOS composites an apple-touch-icon onto white if it has transparency, which
 * would put a white ring around the mark. Flatten onto the mark's own field
 * instead so the result is what we intend rather than what Safari picks.
 */
write('apple-touch-icon-180.png', flatten(resize(master, 180, 180), background))

// Browser tabs. 32 is the common ask; 48 covers higher-DPI tab strips.
write('favicon-32.png', resize(master, 32, 32))
write('favicon-48.png', resize(master, 48, 48))

process.stdout.write(
  `\n✓ Icon set derived from assets/brand/shawarmania-mark-512.png ` +
    `(field #${background.map((c) => c.toString(16).padStart(2, '0')).join('')})\n`,
)
