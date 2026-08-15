// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openPptx, type TextElement } from '@genoffice/pptx-engine'
import { EMU_PER_PX_96 } from '@genoffice/pptx-render'
import { htmlStringToSlidePptx } from '../src/main/html-page'

const toEmu = (px: number) => Math.round(px * EMU_PER_PX_96)

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function okImage() {
  return new Response(PNG_BYTES, { status: 200, headers: { 'Content-Type': 'image/png' } })
}

async function convert(html: string) {
  const r = await htmlStringToSlidePptx(html)
  return { ...r, opened: await openPptx(r.bytes) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('htmlStringToSlidePptx', () => {
  it('builds background, text, card, and picture from the dialect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okImage()))
    const html = `<div style="position:absolute;left:0;top:0;width:1280px;height:720px;background-color:#faf6f0"></div>
<div style="position:absolute;left:48px;top:40px;width:600px;height:80px;font-size:40px;font-weight:bold;color:#0f766e">Quarterly Review</div>
<div style="position:absolute;left:48px;top:140px;width:400px;height:50px;background-color:#ffffff;border-radius:12px;border:1px solid #0f766e;color:#1c1917;font-size:16px">Three <b>key</b> takeaways</div>
<div style="position:absolute;left:800px;top:200px;width:300px;height:200px"><img src="https://example.com/pic.png"></div>`
    const { opened, imageFailures } = await convert(html)
    expect(imageFailures).toEqual([])
    const els = opened.deck.slides[0]!.elements
    const byType = (t: string) => els.filter((e) => e.type === t)
    expect(byType('picture')).toHaveLength(1)
    const texts = byType('text') as TextElement[]
    expect(texts.length).toBeGreaterThanOrEqual(2)
    const title = texts.find((t) => t.anchor.originalXml.includes('Quarterly Review'))
    expect(title).toBeTruthy()
    expect(title!.anchor.originalXml).toContain('sz="4000"') // 40pt run size
    const cardText = texts.find((t) => t.anchor.originalXml.includes('takeaways'))
    expect(cardText!.anchor.originalXml).toContain('b="1"') // bold run
    const shapes = els.filter((e): e is TextElement => e.type === 'shape')
    expect(shapes.length).toBeGreaterThanOrEqual(1)
    const card = shapes.find((s) => s.presetGeometry === 'roundRect')
    expect(card).toBeTruthy()
    expect(card!.fill).toMatchObject({ type: 'solid', color: '#FFFFFF' })
    expect(card!.stroke?.fill).toMatchObject({ type: 'solid', color: '#0F766E' })
  })

  it('inflates text container height by 15% against frame overflow', async () => {
    const html = `<div style="position:absolute;left:100px;top:100px;width:200px;height:100px;font-size:16px">Some body text</div>`
    const { opened } = await convert(html)
    const text = opened.deck.slides[0]!.elements.find((e) => e.type === 'text') as TextElement
    expect(text.transform.offset.cy).toBe(Math.round(toEmu(100) * 1.15))
  })

  it('degrades a failed image fetch to a gray placeholder and records it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })))
    const html = `<div style="position:absolute;left:0;top:0;width:400px;height:300px"><img src="https://example.com/broken.png"></div>`
    const { opened, imageFailures } = await convert(html)
    expect(imageFailures).toEqual([{ page: 1, url: 'https://example.com/broken.png' }])
    const shapes = opened.deck.slides[0]!.elements.filter(
      (e): e is TextElement => e.type === 'shape',
    )
    expect(shapes.some((s) => s.fill?.type === 'solid' && s.fill.color === '#D9D9D9')).toBe(true)
  })

  it('degrades unknown tags to their text instead of throwing', async () => {
    const html = `<section style="position:absolute;left:50px;top:50px;width:300px;height:60px"><mystery-tag>Hello <span style="color:#123456">world</span></mystery-tag></section>`
    const { opened } = await convert(html)
    const texts = opened.deck.slides[0]!.elements.filter((e) => e.type === 'text') as TextElement[]
    expect(texts.some((t) => t.anchor.originalXml.includes('Hello'))).toBe(true)
  })

  it('treats a full-canvas block as the slide background', async () => {
    const html = `<div style="position:absolute;left:0;top:0;width:1280px;height:720px;background-color:#1c1917"></div><div style="position:absolute;left:48px;top:40px;width:300px;height:60px;color:#fafaf9">Dark deck title</div>`
    const { opened } = await convert(html)
    // the background div must not become a foreground shape covering the text
    const shapes = opened.deck.slides[0]!.elements.filter((e) => e.type === 'shape')
    expect(shapes).toHaveLength(0)
    expect(opened.deck.slides[0]!.elements.filter((e) => e.type === 'text')).toHaveLength(1)
  })
})
