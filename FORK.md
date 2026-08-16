# DeepOffice — DeepSeek fork

This repository is a fork of
[genspark-ai/genoffice](https://github.com/genspark-ai/genoffice) that
replaces the Genspark LLM proxy with the DeepSeek API and fixes the
cross-platform developer experience on Windows.

All fork changes live on the **`deepseek-provider`** branch (set it as the
default branch in the repo settings). `main` can be kept in sync with
upstream — see [Syncing with upstream](#syncing-with-upstream).

## What's different from upstream

### AI backend: DeepSeek instead of Genspark

- Model calls go to the DeepSeek API (`https://api.deepseek.com/v1`,
  OpenAI-compatible) with models `deepseek-v4-flash` and `deepseek-v4-pro`
  (default `deepseek-v4-pro`).
- The Genspark LLM proxy (`www.genspark.ai/api/*`) and the gsk-login-based
  model authentication are removed — no Genspark account is needed to use the
  AI assistant. The Genspark "gsk" tools (web/image search, image
  generation/analysis, and the shell's account pane) are unchanged.
- The API key comes from the `DEEPSEEK_API_KEY` environment variable or
  `ai-settings.json`; it is injected in memory and never persisted by the UI.
- Stored settings that selected the genspark provider migrate to DeepSeek
  automatically, and the retired DeepSeek aliases (`deepseek-chat`,
  `deepseek-reasoner`) remap to `deepseek-v4-pro`.
- DeepSeek V4 is text-only, so images attached to an AI request are dropped
  (OpenAI/custom providers still receive them).
- Slides deck generation can run on its own OpenAI-compatible endpoint via
  `SLIDES_AI_BASE_URL` / `SLIDES_AI_MODEL` / `SLIDES_AI_KEY` (e.g. OpenRouter
  or local Ollama), independent of the suite-wide provider. The slides skill
  prompt also carries a built-in design system (palettes, typography, layout
  library) tuned for local generation.
- **Deck generation is fully local** (no Genspark cloud): `generate_deck` /
  `regenerate_slide` write each page's HTML with the generation model and a
  local converter (`apps/slides/src/main/html-page.ts`) turns it into real
  editable pptx elements — textboxes, cards, backgrounds, and downloaded
  images (failed fetches degrade to a gray placeholder). The Genspark cloud
  path remains for upstream parity when a gsk login exists.

### Developer experience (Windows)

- `npm run dev` works on Windows: the inline environment variables in the dev
  script are wrapped with `cross-env`, and every dev server binds `127.0.0.1`
  instead of `localhost` (on Windows, Node binds `localhost` to IPv6 only,
  which made Chromium fail to load the editor tabs).
- A `predev` hook (`tools/build-dev-preloads.mjs`) builds each app's preload
  with esbuild before the dev shell starts, so fresh checkouts get working
  tabs without a full `npm run build:all`.

## Getting started

Prerequisites: Node >= 22.12, npm >= 10, and a Rust toolchain only if you
build the sheets xlsx sidecar.

```bash
npm install
export DEEPSEEK_API_KEY=sk-...   # on Windows: set DEEPSEEK_API_KEY=sk-...
npm run dev                      # all editors + shell, or: npm run dev:docs
```

## Syncing with upstream

Upstream development happens in a private tree and lands on
`genspark-ai/genoffice` `main` as single squashed snapshot commits. The
`origin` remote in this repository points at the upstream mirror; this fork
lives under the `fork` remote.

```bash
git fetch origin
git checkout main && git pull origin main          # keep the mirror's main current
# first time only: replace GitHub's auto-generated initial commit on main
git push fork main --force
git checkout deepseek-provider && git rebase main  # replay the fork changes
git push --force-with-lease fork deepseek-provider
```

## Branding

"GenOffice" and "Genspark" are trademarks of Mainfunc, Inc., and upstream asks
forks to use their own branding (see the upstream README). This fork brands
itself **DeepOffice**; keep that name for any binaries you distribute.

## License

Apache-2.0, same as upstream (see LICENSE). The `ee/` directory is covered by
the GenOffice Enterprise License (`ee/LICENSE`) and must not be modified.
