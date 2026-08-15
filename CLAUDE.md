# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root unless noted. This is an npm-workspaces
monorepo (`apps/*` + `packages/*`); workspace scripts are invoked with
`-w @genoffice/<name>`.

```bash
npm install            # postinstall downloads Electron binaries
npm run fixtures       # generate test .docx fixtures (one-time, and after docx-engine changes)
npm run dev            # all five editors + shell against Vite dev servers (URLs use 127.0.0.1 — see below)
npm run dev:docs       # single app (same pattern works per workspace)
npm test               # unit tests across every workspace (includes Rust sidecar tests)
npm run test -w @genoffice/docx-engine -- tests/foo.test.ts   # single test file
npm run test:watch -w @genoffice/docs                          # watch mode
npm run typecheck      # tsc --noEmit across every workspace
npm run lint           # eslint . — 0 errors required, warnings allowed
npm run format         # Prettier on uncommitted changed/new files ONLY (incremental by design)
npm run format:check   # same, check mode — this is the CI gate
npm run check:theme-colors  # CI guard for renderer CSS theming rules (see below)
npm run build:all      # build all six apps
npm run test:e2e       # Playwright e2e — requires `npm run build:all` first
npm run dist:mac|win|linux   # package installers
```

- E2E tests (`e2e/`) launch the real built app via `electron.launch`, so they
  run serially (`workers: 1`) and need the build.
- Formatting is intentionally incremental: never reformat untouched files,
  and check changed files with `npm run format:check`.
- The sheets xlsx sidecar is Rust (`apps/sheets/native/xlsx-engine`); `cargo`
  must be on PATH. `npm run build -w @genoffice/sheets` compiles it
  automatically.
- Dev servers bind `host: '127.0.0.1'` and the root `dev` script uses
  `127.0.0.1` URLs, never `localhost`: on Windows Node binds `localhost` to
  `::1` only while Chromium may resolve it to `127.0.0.1` first, which hangs
  the editor tabs. Keep the host and URLs in sync when changing ports.
- Editor-tab preloads are built fresh by the `predev` hook
  (`tools/build-dev-preloads.mjs`, esbuild CJS into `apps/*/out/preload`).
  Don't remove `predev` — without it, tabs load blank on fresh checkouts.
  `npm run build:all` is still required before packaging.
- Useful env vars (all optional; full table in CONTRIBUTING.md):
  `GENOFFICE_USER_DATA` (Electron userData override for test isolation),
  `XLSX_SIDECAR_PATH` (point at a locally built sidecar),
  `DEEPSEEK_API_KEY` (DeepSeek key for the AI model provider, injected in-memory),
  `GSK_API_KEY` / `GSK_CLI_PATH` (Genspark credentials for the gsk search/image tools).

## Architecture

**Monorepo layout.** `apps/*` are six Electron apps: five editors (docs,
sheets, slides, pdf, markdown) plus `shell`, which hosts the editors as tabs
and is the distributable product. `packages/*` are pure-TypeScript engines
and shared code — no Electron dependency, unit-tested.

**App anatomy.** Each app has `src/main` (Electron main process),
`src/preload` (context-bridge), `src/renderer` (React UI), and `src/shared`
(IPC channel contracts shared by main/preload/renderer). Builds use
electron-vite. A key quirk: the shell's main process imports the other apps'
`src/main` TypeScript directly (`apps/shell/src/main/index.ts` imports
`docs/src/main/docs-main`), bundling them into one shell main build — see the
Build gotchas below.

**Dev mode.** Each renderer runs on its own Vite dev server (docs 5173,
sheets 5174, slides 5175, pdf 5176, markdown 5177, shell 5199). The root
`dev` script wires the shell to those URLs via `*_RENDERER_URL` env vars.

**Fidelity-first engine philosophy.** This is the core product promise and
shapes every engine API: the original file is the source of truth, edits are
applied as narrow patches, and everything untouched survives the round trip
byte-for-byte. Concretely for docx (README has the diagram):

```
open ─► archive original by hash ─► docx-engine parses word/document.xml
     ─► block tree, each block anchored by docxIndex + original XML slice
     ─► Tiptap editor (manual + AI edits, dirty tracking)
save ─► dirty blocks → OOXML fragments → spliced into original document.xml
     ─► repack zip; all other entries copied byte-for-byte
```

- `packages/docx-engine` — docx parse → block tree → OOXML fragment
  generation → byte-level paragraph patching. `packages/pptx-engine` /
  `pptx-render` do the same for slides.
- `apps/sheets` — UI on the open-source Univer core, with `.xlsx`
  import/export through the Rust sidecar (calamine + IronCalc) and in-house
  Konva charts.
- `packages/file-parse` — text extraction for AI attachments;
  `packages/font-metrics` — HarfBuzz/wasm text-shaping metrics.

**AI layer.** `packages/agent-core` (the agent loop and skill composition
shared by every app), `packages/ai-provider` (model backend abstraction +
streaming), `packages/ai-search` (Genspark auth + web/image search tools).
AI edits are block-granular with version snapshots and diffs; the same panel
embeds in every app.

**Tests.** Vitest per workspace (`apps/*/tests`, `packages/*/tests`; the root
`vitest.config.ts` only aggregates projects). Renderer tests run under
jsdom. E2E Playwright specs live in `e2e/`. Local acceptance driver scripts
go in `scripts/drivers/` (gitignored, not CI).

## Repository workflow

- **This GitHub repo is a mirror.** Development happens in a private tree;
  `main` advances only through single squashed snapshot commits
  (`Sync snapshot (<date>)`). Never push directly to `main`. External PRs
  are reviewed here and imported by maintainers.
- **`ee/` is off-limits.** Reserved for future enterprise modules under a
  separate license; do not modify files under `ee/` (CODEOWNERS-enforced).
- **Round-trip tests are mandatory** for changes touching open/save paths
  (docx/xlsx/pptx): add a test proving untouched content survives
  byte-for-byte.
- **English only** in code, comments, and commit messages. User-facing
  strings go through i18n resources (`src/renderer/i18n/`, plus inline
  main-process dictionaries in `src/main/`) — the only places non-English
  text belongs.
- CI runs `format:check` (changed files vs PR base), `lint` (0 errors),
  `typecheck`, `test`, and `licenses`.

## Theming rules (mandatory)

The suite supports light / dark / system UI themes. The switching mechanism is a
`data-theme` attribute on `<html>` plus CSS custom properties defined once in
`packages/ui/src/tokens.css` (light defaults in `:root`, overrides in
`[data-theme='dark']`, and a `prefers-color-scheme` media-query fallback for
system mode).

1. **UI chrome colors must use semantic tokens.** Never write raw `#hex` /
   `rgb()` in renderer CSS rules or chrome-related inline styles — reference
   `var(--surface)`, `var(--text)`, `var(--hover)`, etc. from
   `packages/ui/src/tokens.css`. Raw values are allowed only on custom-property
   definition lines (`--x: #...;` — token, accent, or app-scoped variable
   definitions). CI enforces this for new/changed renderer CSS lines
   (`tools/check-theme-colors.mjs`).
2. **Every new token gets both values.** Adding a token means adding it to all
   three blocks in `tokens.css` (light, dark, system-dark fallback).
3. **Accent colors stay per-app.** Each app defines `--accent` /
   `--accent-dark` / `--accent-soft` (and its dark-adjusted values) in its own
   `styles.css`. Shared rules reference `var(--accent)` and inherit the app's
   brand color.
4. **Document content never follows the theme.** Page surfaces, cell fills,
   slide content, PDF page bitmaps, export/print stylesheets, chart palettes,
   highlight color maps, stamps, and WordArt presets are document data: they
   stay hardcoded, must not reference chrome tokens, and must render/export
   identically in both themes. (Word-style "dark chrome, white paper".)
5. **Canvas-drawn UI affordances go through a constants table.** Konva/canvas
   editing chrome (selection frames, guides, handles) reads from the app's
   canvas color table (e.g. `canvas-colors.ts`) keyed by the current theme —
   no inline hex in draw calls.

## Build gotchas

- App main-process code (`apps/*/src/main`) is compiled into the **shell**
  build. After changing it, rebuild the shell or the change silently does not
  run.
- In dev mode, preload changes require a rebuild — a stale preload leaves the
  renderer blank.
- Workspace packages listed in an app's `dependencies` must also be added to
  the `externalizeDepsPlugin` `exclude` list, or the packaged app crashes on
  launch.
- `useI18n()`'s `t` is not referentially stable; never put it in a hook
  dependency array. Store the key and translate at render time.
