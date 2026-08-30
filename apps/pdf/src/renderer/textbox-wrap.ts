import type { PageGeom } from './annotations'
import { pdfRectToCss, viewToPdf } from './annotations'
import { wrapText } from './text-wrap'

/**
 * Wrap text-box content to the box width: every user hard break ('\n') is kept,
 * and each hard segment is wrapped independently with the same CJK-aware
 * tokenizer (incl. kinsoku) the paragraph editor uses. Returns at least one line.
 */
export function wrapTextBox(
  text: string,
  widthPt: number,
  fontSizePt: number,
  cssFamily: string,
): string[] {
  const out: string[] = []
  for (const segment of text.split('\n')) {
    out.push(...wrapText(segment, widthPt, fontSizePt, cssFamily))
  }
  return out.length > 0 ? out : ['']
}

let ascentCtx: CanvasRenderingContext2D | null = null

/** Ascent of the box font above its baseline, in PDF pt — positions the first
    baseline below the box top edge. Falls back to 0.8 × fontSize when the browser
    reports no metrics (jsdom). */
export function textBoxAscent(fontSizePt: number, cssFamily: string): number {
  if (!ascentCtx) ascentCtx = document.createElement('canvas').getContext('2d')
  const ctx = ascentCtx
  if (!ctx) return fontSizePt * 0.8
  const font = `100px ${cssFamily}`.trim()
  if (ctx.font !== font) ctx.font = font
  const ascent = ctx.measureText('Ag').actualBoundingBoxAscent
  return ascent > 0 ? (ascent / 100) * fontSizePt : fontSizePt * 0.8
}

/**
 * Per-line baseline origins in PDF user space for a committed text box. The drag
 * rect's top-left (as displayed) anchors the first line; lines step down by
 * `leading` × fontSize. Rotation-aware: display positions map through viewToPdf,
 * so the engine's counter-rotated Tm keeps the saved text upright.
 */
export function textBoxBaselines(
  geom: PageGeom,
  rect: [number, number, number, number],
  lineCount: number,
  fontSize: number,
  cssFamily: string,
  leading = 1.2,
): { x: number; y: number }[] {
  const box = pdfRectToCss(geom, rect, 1)
  const ascent = textBoxAscent(fontSize, cssFamily)
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < lineCount; i++) {
    const [x, y] = viewToPdf(geom, box.left, box.top + ascent + i * leading * fontSize)
    out.push({ x, y })
  }
  return out
}
