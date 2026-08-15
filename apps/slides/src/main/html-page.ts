/**
 * Local HTML → single-slide pptx conversion for the Slides AI pipeline.
 *
 * Genspark's cloud slide_generate used to write one page's HTML and convert it
 * server-side; this module replaces that step for the no-cloud fork. The LLM
 * (SLIDES_AI override, else the user's provider) writes one slide in a
 * constrained HTML dialect — 1280×720 canvas, absolutely-positioned
 * div/p/span/img with inline px styles — and this converter materializes it
 * into a real one-slide pptx via the same pptx-engine primitives the
 * slides:add-element handler uses. The resulting bytes flow through the
 * existing merge/landing machinery (slides:html-to-pptx), so undo snapshots,
 * drafts, and mode semantics are unchanged.
 *
 * Leniency rules: unknown tags and styles degrade to plain text instead of
 * throwing; a failed image fetch becomes a muted gray placeholder rectangle
 * (recorded in imageFailures) so one bad URL never blocks the page.
 */
import { fetchRemoteImage } from '@genoffice/electron-utils'
import {
  addElement,
  addPicture,
  createBlankPptx,
  openPptx,
  savePptx,
  setSlideBackground,
  type Paragraph,
  type TextRun,
} from '@genoffice/pptx-engine'
import { EMU_PER_PT, EMU_PER_PX_96 } from '@genoffice/pptx-render'

/** px → EMU at 96dpi (the HTML canvas is authored at the slide's natural 1280×720) */
const toEmu = (px: number): number => Math.round(px * EMU_PER_PX_96)

/** Text containers get extra vertical headroom so PowerPoint text frames don't overflow-clip */
const TEXT_HEIGHT_PAD = 1.15
/** Fallback fill for images that fail to download */
const PLACEHOLDER_GRAY = 'D9D9D9'
/** Per-image fetch deadline — a stuck CDN must not hang page generation */
const IMAGE_FETCH_TIMEOUT_MS = 15_000

const CANVAS_W = 1280
const CANVAS_H = 720

export interface HtmlPageResult {
  bytes: Uint8Array
  imageFailures: { page: number; url: string }[]
}

interface HtmlNode {
  tag: string
  attrs: Record<string, string>
  style: Record<string, string>
  children: Array<HtmlNode | string>
}

// ---- parsing ----

const TAG_RE = /<\/?(?:[^<>"']|"[^"]*"|'[^']*')*>/g

function parseStyle(styleAttr: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!styleAttr) return out
  for (const part of styleAttr.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const key = part.slice(0, i).trim().toLowerCase()
    const value = part
      .slice(i + 1)
      .trim()
      .toLowerCase()
    if (key && value) out[key] = value
  }
  return out
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([a-zA-Z_:][a-zA-Z0-9:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    out[m[1]!.toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? ''
  }
  return out
}

/** Normalize a CSS color to #RRGGBB; anything non-hex (rgb()/named) is ignored. */
function hexColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value)
  if (!m) return undefined
  const raw = m[1]!
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  return full.toUpperCase()
}

/** font-size → pt (px in the HTML dialect is authored 1:1 with pt) */
function fontSizePt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const m = /^([\d.]+)/.exec(value)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 && n <= 409 ? n : undefined
}

function numPx(value: string | undefined): number | undefined {
  if (!value) return undefined
  const m = /^([\d.-]+)/.exec(value)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

/** Build a lenient node tree from a slice of HTML (body contents preferred). */
function parseHtml(html: string): HtmlNode {
  let body = html
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)
  if (bodyMatch) body = bodyMatch[1]!
  body = body
    .replace(/<!doctype[\s\S]*?>/i, '')
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(html|head|body|meta|link)\b[^>]*>/gi, '')

  const root: HtmlNode = { tag: '#root', attrs: {}, style: {}, children: [] }
  const stack: HtmlNode[] = [root]
  let last = 0
  const re = new RegExp(TAG_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const text = body.slice(last, m.index)
    if (text) stack[stack.length - 1]!.children.push(text)
    const tagStr = m[0]
    const isClose = tagStr.startsWith('</')
    const name = /^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(tagStr)?.[1]?.toLowerCase() ?? ''
    const selfClosing = tagStr.endsWith('/>')
    const attrs = parseAttrs(tagStr.slice(name.length + 1))
    if (isClose) {
      // pop until the matching open tag (lenient: mismatches are ignored)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === name) {
          stack.splice(i)
          break
        }
      }
    } else {
      const node: HtmlNode = {
        tag: name,
        attrs,
        style: parseStyle(attrs.style),
        children: [],
      }
      stack[stack.length - 1]!.children.push(node)
      if (!selfClosing && !VOID_TAGS.has(name)) stack.push(node)
    }
    last = re.lastIndex
  }
  const tail = body.slice(last)
  if (tail) root.children.push(tail)
  return root
}

const VOID_TAGS = new Set(['img', 'br', 'hr'])

// ---- style resolution ----

interface ResolvedStyle {
  color?: string
  fontSize?: number
  fontFamily?: string
  bold: boolean
  italic: boolean
  underline: boolean
  align?: 'left' | 'center' | 'right'
}

function inheritStyle(
  node: HtmlNode,
  parent: Omit<ResolvedStyle, 'align'>,
): Omit<ResolvedStyle, 'align'> {
  const s = node.style
  const weight =
    s['font-weight'] === 'bold' ||
    s['font-weight'] === '700' ||
    node.tag === 'b' ||
    node.tag === 'strong'
  const italic = s['font-style'] === 'italic' || node.tag === 'i' || node.tag === 'em'
  const underline = s['text-decoration']?.includes('underline') || node.tag === 'u'
  return {
    color: hexColor(s.color) ?? parent.color,
    fontSize: fontSizePt(s['font-size']) ?? parent.fontSize,
    fontFamily: s['font-family']?.replace(/["']/g, '') || parent.fontFamily,
    bold: weight || parent.bold,
    italic: italic || parent.italic,
    underline: underline || parent.underline,
  }
}

// ---- text extraction ----

interface ParaBuilder {
  runs: TextRun[]
  align?: 'left' | 'center' | 'right'
}

function appendText(
  node: HtmlNode,
  style: Omit<ResolvedStyle, 'align'>,
  paras: ParaBuilder[],
  current: { runs: TextRun[] },
): void {
  for (const child of node.children) {
    if (typeof child === 'string') {
      const text = child.replace(/\s+/g, ' ')
      if (!text.trim()) continue
      const run: TextRun = {
        text,
        ...(style.bold ? { bold: true } : {}),
        ...(style.italic ? { italic: true } : {}),
        ...(style.underline ? { underline: true } : {}),
        ...(style.color ? { color: style.color } : {}),
        ...(style.fontSize ? { fontSize: style.fontSize } : {}),
        ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
      }
      const last = current.runs.at(-1)
      if (
        last &&
        last.bold === run.bold &&
        last.italic === run.italic &&
        last.underline === run.underline &&
        last.color === run.color &&
        last.fontSize === run.fontSize &&
        last.fontFamily === run.fontFamily
      ) {
        last.text += run.text
      } else {
        current.runs.push(run)
      }
      continue
    }
    if (child.tag === 'br') {
      paras.push({ runs: [] })
      current.runs = paras.at(-1)!.runs
      continue
    }
    const next = inheritStyle(child, style)
    if (child.tag === 'img') continue // images handled by the block-level pass
    appendText(child, next, paras, current)
  }
}

function containerAlign(node: HtmlNode): 'left' | 'center' | 'right' | undefined {
  const ta = node.style['text-align']
  if (ta === 'center' || ta === 'right') return ta
  if (ta === 'left') return 'left'
  return undefined
}

// ---- images ----

async function fetchImageBytes(
  url: string,
): Promise<{ bytes: Uint8Array; ext: 'png' | 'gif' | 'jpg' } | null> {
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), IMAGE_FETCH_TIMEOUT_MS),
  )
  const fetchPromise = (async (): Promise<{
    bytes: Uint8Array
    ext: 'png' | 'gif' | 'jpg'
  } | null> => {
    try {
      const resp = await fetchRemoteImage(url)
      if (!resp || !resp.ok) return null
      const ct = resp.headers.get('content-type') ?? ''
      const ext: 'png' | 'gif' | 'jpg' = ct.includes('png')
        ? 'png'
        : ct.includes('gif')
          ? 'gif'
          : 'jpg'
      return { bytes: new Uint8Array(await resp.arrayBuffer()), ext }
    } catch {
      return null
    }
  })()
  return Promise.race([fetchPromise, timeout])
}

// ---- conversion ----

interface BlockInfo {
  node: HtmlNode
  x: number
  y: number
  w: number
  h: number
  fill?: string
  stroke?: { color: string; widthEmu: number }
  radius: number
  imgUrl?: string
  text: string
  paras: ParaBuilder[]
  align?: 'left' | 'center' | 'right'
}

function collectBlocks(
  root: HtmlNode,
  blocks: BlockInfo[],
  inherited: Omit<ResolvedStyle, 'align'>,
): void {
  for (const child of root.children) {
    if (typeof child === 'string') continue
    const style = inheritStyle(child, inherited)
    const pos =
      child.style.position === 'absolute' ||
      child.style.left !== undefined ||
      child.style.top !== undefined
    const x = numPx(child.style.left)
    const y = numPx(child.style.top)
    const w = numPx(child.style.width)
    const h = numPx(child.style.height)
    if (pos && x !== undefined && y !== undefined && w !== undefined && h !== undefined) {
      const paras: ParaBuilder[] = [{ runs: [] }]
      appendText(child, style, paras, paras[0]!)
      const text = paras
        .map((p) => p.runs.map((r) => r.text).join(''))
        .join('\n')
        .trim()
      const fill = hexColor(child.style['background-color'])
      const strokeColor = hexColor(
        /\b(?:solid|1px)\s+(#[0-9a-f]{3,6})/i.exec(child.style.border ?? '')?.[1] ??
          child.style['border-color'],
      )
      blocks.push({
        node: child,
        x,
        y,
        w,
        h,
        ...(fill ? { fill } : {}),
        ...(strokeColor
          ? { stroke: { color: strokeColor, widthEmu: Math.round(1 * EMU_PER_PT) } }
          : {}),
        radius: Math.min(numPx(child.style['border-radius']) ?? 0, Math.min(w, h) / 2),
        ...(child.tag === 'img' || findImg(child) ? { imgUrl: imgSrc(child) } : {}),
        text,
        paras,
        ...(containerAlign(child) ? { align: containerAlign(child) } : {}),
      })
      continue
    }
    collectBlocks(child, blocks, style)
  }
}

function findImg(node: HtmlNode): boolean {
  if (node.tag === 'img') return true
  return node.children.some((c) => typeof c !== 'string' && findImg(c))
}

function imgSrc(node: HtmlNode): string | undefined {
  if (node.tag === 'img') return node.attrs.src
  for (const c of node.children) {
    if (typeof c !== 'string') {
      const s = imgSrc(c)
      if (s) return s
    }
  }
  return undefined
}

/** Find the page background: a block that fills (nearly) the whole canvas. */
function pageBackground(blocks: BlockInfo[]): string | undefined {
  for (const b of blocks) {
    if (b.fill && b.x <= 4 && b.y <= 4 && b.w >= CANVAS_W - 8 && b.h >= CANVAS_H - 8) {
      return b.fill
    }
  }
  return undefined
}

/**
 * Convert one page of dialect HTML into a one-slide pptx (16:9, 1280×720 @96dpi).
 * Image downloads are individually bounded and degrade to a gray placeholder
 * rectangle; failures are reported in imageFailures (page is always 1 here).
 */
export async function htmlStringToSlidePptx(html: string): Promise<HtmlPageResult> {
  const root = parseHtml(html)
  const blocks: BlockInfo[] = []
  collectBlocks(root, blocks, { bold: false, italic: false, underline: false })

  const opened = await openPptx(await createBlankPptx())
  const slide = opened.deck.slides[0]!
  const imageFailures: { page: number; url: string }[] = []

  const bg = pageBackground(blocks)
  if (bg) setSlideBackground(slide, bg)

  for (const b of blocks) {
    // The full-canvas background block is expressed as the slide background above,
    // never as a foreground shape covering the content
    if (b.fill === bg && b.x <= 4 && b.y <= 4 && b.w >= CANVAS_W - 8 && b.h >= CANVAS_H - 8)
      continue
    const offset = { x: toEmu(b.x), y: toEmu(b.y), cx: toEmu(b.w), cy: toEmu(b.h) }
    if (b.imgUrl) {
      const img = await fetchImageBytes(b.imgUrl)
      if (img) {
        addPicture(opened, slide, { bytes: img.bytes, ext: img.ext, offset })
      } else {
        imageFailures.push({ page: 1, url: b.imgUrl })
        addElement(slide, { kind: 'rect', offset, fillColor: PLACEHOLDER_GRAY })
      }
      continue
    }
    if (b.text) {
      // solid card behind the text, then the textbox on top (document order = z-order)
      if (b.fill) {
        addElement(slide, {
          kind: b.radius > 0 ? 'roundRect' : 'rect',
          offset,
          fillColor: b.fill,
          ...(b.stroke ? { stroke: b.stroke } : {}),
        })
      }
      const paragraphs: Paragraph[] = b.paras
        .filter((p) => p.runs.length > 0)
        .map((p) => ({ runs: p.runs, ...(b.align ? { align: b.align } : {}) }))
      if (paragraphs.length > 0) {
        addElement(slide, {
          kind: 'textbox',
          offset: { ...offset, cy: Math.round(toEmu(b.h) * TEXT_HEIGHT_PAD) },
          paragraphs,
        })
      }
      continue
    }
    if (b.fill) {
      addElement(slide, {
        kind: b.radius > 0 ? 'roundRect' : 'rect',
        offset,
        fillColor: b.fill,
        ...(b.stroke ? { stroke: b.stroke } : {}),
      })
    }
  }

  return { bytes: await savePptx(opened), imageFailures }
}
