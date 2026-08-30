import { describe, expect, it } from 'vitest'
import { pdfRectToCss, pdfToView } from '../src/renderer/annotations'
import type { PageGeom } from '../src/renderer/annotations'
import { textBoxAscent, textBoxBaselines, wrapTextBox } from '../src/renderer/textbox-wrap'

// jsdom has no canvas 2d context: measurePt falls back to 0.5em per char and
// textBoxAscent to 0.8 × fontSize, which keeps the helpers deterministic here.
const ARIAL = 'Arial, sans-serif'

describe('wrapTextBox', () => {
  it('keeps user hard breaks and wraps each segment independently', () => {
    expect(wrapTextBox('aaa\nbbb', 1000, 14, ARIAL)).toEqual(['aaa', 'bbb'])
  })

  it('wraps to the box width with the same fallback metrics as the paragraph editor', () => {
    // 7pt per char at 14pt (jsdom fallback): 'hello world foo bar' fits 40pt in fives
    expect(wrapTextBox('hello world foo bar', 40, 14, ARIAL)).toEqual([
      'hello',
      'world',
      'foo',
      'bar',
    ])
  })

  it('hard-breaks a single unit wider than the box', () => {
    expect(wrapTextBox('abcdef', 10, 14, ARIAL)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('returns empty lines for empty or whitespace-only input (hard breaks kept)', () => {
    expect(wrapTextBox('', 100, 14, ARIAL)).toEqual([''])
    expect(wrapTextBox('   \n  ', 100, 14, ARIAL)).toEqual(['', ''])
  })
})

describe('textBoxBaselines', () => {
  const rect: [number, number, number, number] = [100, 650, 300, 684]

  it.each([0, 90, 180, 270])('recovers display-space line tops for rot %i', (rot) => {
    const geom: PageGeom = { pw: 612, ph: 792, rot }
    const box = pdfRectToCss(geom, rect, 1)
    const ascent = textBoxAscent(14, ARIAL)
    const lines = textBoxBaselines(geom, rect, 3, 14, ARIAL)
    expect(lines).toHaveLength(3)
    lines.forEach((line, i) => {
      const [vx, vy] = pdfToView(geom, line.x, line.y)
      expect(vx).toBeCloseTo(box.left, 6)
      expect(vy).toBeCloseTo(box.top + ascent + i * 1.2 * 14, 6)
    })
  })

  it('steps baselines by fontSize × leading in display space', () => {
    const geom: PageGeom = { pw: 612, ph: 792, rot: 0 }
    const lines = textBoxBaselines(geom, rect, 2, 14, ARIAL)
    const [x0, y0] = pdfToView(geom, lines[0]!.x, lines[0]!.y)
    const [x1, y1] = pdfToView(geom, lines[1]!.x, lines[1]!.y)
    expect(x1).toBeCloseTo(x0, 6)
    expect(y1).toBeCloseTo(y0 + 1.2 * 14, 6)
  })
})
