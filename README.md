# DeepOffice — DeepSeek fork

> **This repository is a fork of [genspark-ai/genoffice](https://github.com/genspark-ai/genoffice).**
> All fork changes live on the `deepseek-provider` branch — see
> [FORK.md](FORK.md) for the full list of changes and how to sync with upstream.

An open-source, AI-native office suite for macOS, Windows, and Linux: a word
processor (Docs), spreadsheet (Sheets), presentation editor (Slides), PDF
editor, and Markdown editor as five Electron apps sharing one engine layer,
hosted together by a suite shell. It opens and saves the real Microsoft
Office formats — Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`) — with
byte-preserving round trips, and builds AI editing into the workflow rather
than bolting on a chat box.

**AI backend: DeepSeek.** This fork replaces the Genspark LLM proxy with the
DeepSeek API (`deepseek-v4-flash` / `deepseek-v4-pro`). See
[Environment variables](#environment-variables) below for the required setup.

```bash
npm install
npm run dev                       # all editors + shell, or: npm run dev:docs
```

## Environment variables

> **Read this before the first run** — these are easy to overlook and the AI
> features silently fall back without them.

| Variable             | What it does                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEEPSEEK_API_KEY`   | DeepSeek API key for the suite-wide AI model provider (`deepseek-v4-flash` / `deepseek-v4-pro`)                                                            |
| `SLIDES_AI_BASE_URL` | OpenAI-compatible endpoint for the **slides deck-generation model** (e.g. `https://openrouter.ai/api/v1`, or `http://localhost:11434/v1` for local Ollama) |
| `SLIDES_AI_MODEL`    | Model id at that endpoint, vendor-prefixed for OpenRouter (e.g. `openai/gpt-5.6-luna`, `anthropic/claude-sonnet-5`, `moonshotai/kimi-k3`, `qwen/...`)      |
| `SLIDES_AI_KEY`      | API key for that endpoint (omit to reuse the custom provider's key)                                                                                        |

```bash
# Windows: set DEEPSEEK_API_KEY=sk-... etc.
export DEEPSEEK_API_KEY=sk-...
export SLIDES_AI_BASE_URL=https://openrouter.ai/api/v1
export SLIDES_AI_MODEL=openai/gpt-5.6-luna
export SLIDES_AI_KEY=sk-or-...
```

- The `SLIDES_AI_*` trio is **optional**: unset, slides generation falls back to
  `DEEPSEEK_API_KEY`; a failing generation request also falls back automatically.
- The **installed app** doesn't inherit a terminal's environment — set the
  variables as system/user environment variables (Start → "Edit environment
  variables for your account"), or put the DeepSeek key in
  `%APPDATA%\DeepOffice\ai-settings.json`:
  ```json
  {
    "provider": "deepseek",
    "providers": { "deepseek": { "apiKey": "sk-...", "model": "deepseek-v4-pro" } }
  }
  ```
- **Terminal gotcha:** `npm run dev` must be started from a terminal where the
  variables are visible (`env | grep -i slide` prints all three) — terminals
  opened _before_ the variables were set never see them, and neither does a
  running app. On startup the dev terminal prints
  `[slides-ai] local deck generation active (override: <model> @ <base>)` —
  that line proves the main process sees the override. AI failures append to
  `%TEMP%\genoffice-ai-errors.log` for debugging.

---

## Features

- **Real PDF editing** — retype text and edit images in the page itself, original fonts preserved.
- **Microsoft Word–compatible, byte-preserving `.docx` editing** — only what you touched changes; Word never notices.
- **Word-faithful pagination** — page breaks land where Word puts them.
- **Excel-compatible spreadsheets** — in-house engine with a Rust `.xlsx` sidecar, own charts, pivot tables, slicers.
- **PowerPoint-compatible presentations** — in-house `.pptx` engine with masters, layouts, smart guides, non-destructive crop.
- **Markdown to Word, fully local** — the same OOXML engine, no Pandoc, no cloud.
- **AI that edits documents** — block-level edits with snapshots and diffs, document-aware agents.
- **Agent tools built in** — web/image search, image generation, media analysis.
- **Light / dark / system themes.**
- **macOS, Windows, Linux.**
- **Free & open-source (Apache-2.0).**

## Apps

| App             | Product                 | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/docs`     | **DeepOffice Docs**     | `.docx` word processor. Byte-preserving round trip: only dirty paragraphs are regenerated (paragraph patch), everything else in the original file is kept byte-for-byte, so opening and saving never breaks layout in Word. Paginated view whose line metrics reproduce the original document's layout, tracked changes, comments, styles, equations, ink.                                                                                                                                                                                                      |
| `apps/sheets`   | **DeepOffice Sheets**   | `.xlsx` spreadsheet. UI built on the open-source [Univer](https://github.com/dream-num/univer) core (Apache-2.0) with a large layer of in-house extensions; `.xlsx` import/export runs through an in-house Rust sidecar (calamine + IronCalc), charts are rendered in-house (Konva), plus pivot tables, slicers, conditional formatting, and formula tracing.                                                                                                                                                                                                   |
| `apps/slides`   | **DeepOffice Slides**   | `.pptx` presentations. In-house `.pptx` parse/render/edit engine with masters, charts, cropping, ink, and text shaping (HarfBuzz metrics).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/pdf`      | **DeepOffice PDF**      | `.pdf` viewer/editor on [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) + [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT): annotations, forms, outlines, stamps, signatures, page operations, and printing support. True text editing — paragraph selection with in-block reflow, alignment restoration, original-font preservation — and content-stream image insert/edit, all rewriting page content streams through [PDFium](https://pdfium.googlesource.com/pdfium/) wasm (BSD-3-Clause) with subset-embedded fonts — no cover-up annotations. |
| `apps/markdown` | **DeepOffice Markdown** | `.md` / `.markdown` editor: Tiptap block editor over plain Markdown files — headings, lists, tables, images, code blocks — saved back as plain Markdown, hosted in shell tabs.                                                                                                                                                                                                                                                                                                                                                                                  |
| `apps/shell`    | **DeepOffice**          | The suite shell: home screen, tabbed hosting of the five editors, light/dark/system theme, auto-update.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Every app embeds the same AI panel: block-granular AI editing with version
snapshots and diffs in docs, a tool-calling agent over workbook/slide/PDF
state in the others.

The whole suite ships light / dark / system UI themes built on shared design
tokens (`packages/ui`), with a CI guard that keeps chrome colors on the token
system. Document surfaces stay light in dark mode — Word-style dark chrome
around white paper — so files render and export identically in both themes.

**AI backend.** Model calls go to the DeepSeek API (`https://api.deepseek.com`,
OpenAI-compatible, `deepseek-v4-flash` / `deepseek-v4-pro`), authenticated with a
`DEEPSEEK_API_KEY` environment variable or a key in the app's `ai-settings.json` —
no key is entered or stored through the UI. The Genspark ("gsk") tool endpoints the
agents build on — web and image search, image generation and editing,
image/audio/video analysis, and audio transcription — remain available through a
Genspark account sign-in and `packages/ai-search` for anyone extending the agent
layer.

**Slides deck generation.** Deck generation (`generate_deck`, `regenerate_slide`)
is **fully local — no Genspark account needed**. The generation model writes each
page's HTML and a local converter (`apps/slides/src/main/html-page.ts`) turns it
into real editable pptx elements (textboxes, cards, backgrounds, downloaded
images — failed image fetches degrade to a gray placeholder). The Genspark cloud
path remains as an upstream-parity fallback when a gsk login exists.

The deck-generation steps (style planning, page-by-page design) can run on a
different OpenAI-compatible endpoint than the rest of the suite — e.g. a
stronger model on [OpenRouter](https://openrouter.ai) or a local
[Ollama](https://ollama.com) server — while chat and the other apps keep their
configured provider. Configure it with the `SLIDES_AI_*` variables in
[Environment variables](#environment-variables).

## Engine packages

All pure TypeScript, no Electron dependency, unit-tested (except the UI kit):

- `packages/docx-engine` — docx parsing → block tree (with `docxIndex`
  anchors and passthrough), OOXML fragment generation, byte-level paragraph
  patching.
- `packages/pptx-engine` / `packages/pptx-render` — pptx model and rendering.
- `packages/file-parse` — text extraction for AI attachments (office formats,
  text formats).
- `packages/agent-core` — the AI agent loop and skill composition shared by
  every app.
- `packages/ai-provider` — provider abstraction and streaming for the model
  backends.
- `packages/ai-search` — Genspark auth + web/image search tools.
- `packages/i18n`, `packages/ui`, `packages/project-store`,
  `packages/electron-utils` — shared i18n core, React UI kit, recent-files
  store, and Electron main-process helpers.

## Development

```bash
npm install
npm run fixtures     # generate test .docx fixtures
npm test             # engine + app unit tests (docs/sheets/slides need no display)
npm run typecheck    # tsc --noEmit across every workspace
npm run dev          # all five editors + shell against Vite dev servers
npm run dev:docs     # a single app (same pattern works per workspace)
npm run dist:mac     # package macOS dmg (regenerates third-party notices)
npm run dist:win     # package Windows nsis installer
npm run dist:linux   # package Linux AppImage + deb + rpm
```

The sheets app additionally needs a Rust toolchain for its xlsx sidecar
(`cargo` on PATH); `npm run build -w @genoffice/sheets` compiles it
automatically.

## Building installers

Run from the repository root on the OS you're targeting; each command
regenerates the third-party notices, builds all six apps, and packages the
result into `apps/shell/release/`:

| Platform                 | Command              | Output                                                               |
| ------------------------ | -------------------- | -------------------------------------------------------------------- |
| macOS (run on macOS)     | `npm run dist:mac`   | `.dmg` + `.zip` (arm64; arm64+x64 when `GENOFFICE_MAC_X64=1` is set) |
| Windows (run on Windows) | `npm run dist:win`   | NSIS `.exe` installer                                                |
| Linux (run on Linux)     | `npm run dist:linux` | `.AppImage` + `.deb` + `.rpm`                                        |

Prerequisites: Node >= 22.12, npm >= 10, and a Rust toolchain (`cargo` on
PATH) for the sheets xlsx sidecar.

- **Unsigned by default.** Without Apple or Windows signing credentials in
  the environment, the macOS and Windows installers are unsigned — code
  signing is skipped with a warning rather than failing. That is the expected
  result for a local build.
- **Windows xlsx sidecar.** A native Windows build (`cargo build --release`
  → the MSVC target) is picked up automatically; only cross-compiled MinGW
  builds need `cargo build --release --target x86_64-pc-windows-gnu` from
  `apps/sheets/native/xlsx-engine`. If neither exists, electron-builder
  packages without the sidecar (Sheets can't open `.xlsx`), so run the sidecar
  build first.

- **Auto-update is off.** With `GENOFFICE_UPDATE_URL` unset, the packaged app
  ships without an update feed and in-app auto-update stays disabled (see
  `apps/shell/electron-builder.cjs`).

Local UI/e2e driver scripts (Playwright + Electron, for local acceptance, not
committed by default) live in [`scripts/drivers/`](scripts/drivers/README.md).

## Architecture notes (docx round trip)

```
open docx ─► archive original by hash (never touched)
          ─► docx-engine parses word/document.xml top-level elements (w:p / w:tbl / …)
          ─► Block tree, each block anchored by docxIndex + original XML slice
          ─► Tiptap streaming editor (manual + AI editing, dirty tracking)
save      ─► dirty blocks → OOXML fragments (referencing existing styles only)
          ─► splice into original document.xml (untouched blocks keep original bytes)
          ─► repack zip; all other entries copied byte-for-byte
```

The same philosophy holds in sheets and slides: the original file is the
source of truth, edits are applied as narrow patches, and everything the
editor didn't touch survives the round trip untouched.

## FAQ

**Is DeepOffice free?**
Yes. DeepOffice is free and open-source under the Apache-2.0 license — no
trial, no paid tier for the apps themselves.

**Can DeepOffice open Microsoft Word, Excel, and PowerPoint files?**
Yes. DeepOffice opens and saves native `.docx`, `.xlsx`, and `.pptx` files.
Saving is byte-preserving: parts of the file you didn't touch are written
back byte-for-byte, so documents keep working in Microsoft Office.

**Does DeepOffice work offline?**
Document editing is fully local — files never leave your machine to be
opened, edited, or saved. The AI features (agents, search, image tools) sign
in to a Genspark account and need a network connection.

**Can DeepOffice edit PDF files?**
Yes — real PDF text and image editing that rewrites the page content stream
with the original fonts preserved, not cover-up annotations.

## Security

See [SECURITY.md](SECURITY.md) for the process security posture (renderer
sandboxing, IPC validation, external-link gating) and the threat models for
AI-generated content.

## Acknowledgements

DeepOffice would not be possible without these open-source projects:

- [Electron](https://www.electronjs.org/) — the desktop runtime for every app.
- [Univer](https://github.com/dream-num/univer) (Apache-2.0) — the spreadsheet
  UI core that Sheets extends.
- [PDFium](https://pdfium.googlesource.com/pdfium/) (BSD-3-Clause, bundled via
  [@embedpdf/pdfium](https://github.com/embedpdf/embed-pdf-viewer)) — the
  content-stream engine behind true PDF text and image editing.
- [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) and
  [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT) — PDF rendering and
  document assembly.
- [Tiptap](https://tiptap.dev/) / [ProseMirror](https://prosemirror.net/) —
  the block editors in Docs and Markdown.
- [Konva](https://konvajs.org/) — canvas rendering for Slides and Sheets
  charts.
- [HarfBuzz](https://github.com/harfbuzz/harfbuzz) (wasm) — text-shaping
  metrics for complex scripts.
- [calamine](https://github.com/tafia/calamine) and
  [IronCalc](https://github.com/ironcalc/IronCalc) — the read and calc layers
  of the Rust xlsx sidecar.
- Liberation, Carlito, Caladea, and Noto CJK fonts (OFL/Apache-2.0) — bundled
  document fonts.

## Third-party notices

`npm run notices` regenerates the bundled third-party license summary
(`tools/gen-third-party-notices.mjs`); all runtime dependencies are
MIT/Apache-2.0/BSD-3-Clause/OFL, and the bundled fonts (Liberation, Carlito,
Caladea, Noto CJK subsets) are OFL/Apache.

## License

DeepOffice is licensed under the [Apache License 2.0](LICENSE), with one
exception: the `ee/` directory is reserved for future enterprise modules and
is covered by the [DeepOffice Enterprise License](ee/LICENSE).

The DeepOffice and Genspark names and logos are trademarks of Mainfunc, Inc.
The Apache-2.0 license does not grant permission to use them (see section 6);
forks should use their own branding.
