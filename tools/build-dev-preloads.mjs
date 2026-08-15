/**
 * Builds every editor app's preload into apps/<app>/out/preload/index.js.
 *
 * The shell's dev flow (`npm run dev`) loads each tab's preload from that
 * path, but nothing in the dev pipeline produces it — a fresh clone (or a
 * stale checkout) gets blank tabs because the contextBridge never attaches.
 * Runs as the root `predev` hook, so every `npm run dev` starts with fresh
 * preloads; the build is esbuild-only (plain CJS, external electron) and
 * takes well under a second per app. Production builds still come from each
 * app's own `electron-vite build`; this output is equivalent for dev use.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'

const APPS = ['docs', 'sheets', 'slides', 'pdf', 'markdown']

for (const app of APPS) {
  const entry = join('apps', app, 'src', 'preload', 'index.ts')
  const outfile = join('apps', app, 'out', 'preload', 'index.js')
  mkdirSync(dirname(outfile), { recursive: true })
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // preloads only touch electron (sandboxed, must stay external) and local shared files
    external: ['electron'],
    target: 'node22',
    logLevel: 'warning',
  })
  console.log(`built ${outfile}`)
}
