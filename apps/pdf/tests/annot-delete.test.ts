import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFName, PDFRef } from 'pdf-lib'
import { applyAnnotDeletes } from '../src/main/annot-delete'
import { applySaveRequest } from '../src/main/save-pdf'
import type { AnnotDeleteInput, SavePdfRequest } from '../src/shared/ipc'

const request = (over: Partial<SavePdfRequest> = {}): SavePdfRequest => ({
  path: '/tmp/test.pdf',
  markups: [],
  drawings: [],
  formValues: [],
  stamps: [],
  ...over,
})

const HL_QUADS = [[100, 716, 200, 716, 100, 698, 200, 698]]
const HL2_QUADS = [[300, 616, 400, 616, 300, 598, 400, 598]]
const UL_QUADS = [[100, 666, 200, 666, 100, 648, 200, 648]]

/** A one-page PDF with a saved highlight and underline (written by the real save path) */
async function annotatedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  const { bytes } = await applySaveRequest(
    await doc.save({ useObjectStreams: false }),
    request({
      markups: [
        { pageIndex: 0, type: 'highlight', color: [1, 0.87, 0.35], quads: HL_QUADS },
        { pageIndex: 0, type: 'underline', color: [0.17, 0.4, 1], quads: UL_QUADS },
      ],
    }),
  )
  return bytes
}

interface SavedAnnot {
  objNum: number
  subtype: string
  rect: [number, number, number, number]
}

async function listAnnots(bytes: Uint8Array): Promise<SavedAnnot[]> {
  const doc = await PDFDocument.load(bytes)
  const annots = doc.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annots) return []
  return Array.from({ length: annots.size() }, (_, i) => {
    const ref = annots.get(i) as PDFRef
    const dict = annots.lookup(i)
    // @ts-expect-error pdf-lib lookup returns PDFObject; these keys exist on annot dicts
    const rect = dict.lookup(PDFName.of('Rect'), PDFArray)
    // @ts-expect-error same as above
    const subtype = dict.lookup(PDFName.of('Subtype'), PDFName).decodeText()
    return {
      objNum: ref.objectNumber,
      subtype,
      rect: Array.from({ length: 4 }, (_, j) => rect.lookup(j).numberValue) as SavedAnnot['rect'],
    }
  })
}

const toDelete = (a: SavedAnnot, subtype: AnnotDeleteInput['subtype']): AnnotDeleteInput => ({
  pageIndex: 0,
  objNum: a.objNum,
  subtype,
  rect: a.rect,
})

describe('applyAnnotDeletes', () => {
  it('removes exactly the addressed annotation by object number', async () => {
    const bytes = await annotatedPdf()
    const before = await listAnnots(bytes)
    expect(before.map((a) => a.subtype).sort()).toEqual(['Highlight', 'Underline'])
    const hl = before.find((a) => a.subtype === 'Highlight')!
    const out = await applyAnnotDeletes(bytes, [toDelete(hl, 'highlight')])
    const after = await listAnnots(out)
    expect(after.map((a) => a.subtype)).toEqual(['Underline'])
  })

  it('falls back to subtype+rect matching when the object number is stale', async () => {
    const bytes = await annotatedPdf()
    const ul = (await listAnnots(bytes)).find((a) => a.subtype === 'Underline')!
    const out = await applyAnnotDeletes(bytes, [{ ...toDelete(ul, 'underline'), objNum: 99999 }])
    expect((await listAnnots(out)).map((a) => a.subtype)).toEqual(['Highlight'])
  })

  it('does not trust a stale object number that points to another same-subtype annotation', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const { bytes } = await applySaveRequest(
      await doc.save({ useObjectStreams: false }),
      request({
        markups: [
          { pageIndex: 0, type: 'highlight', color: [1, 0.87, 0.35], quads: HL_QUADS },
          { pageIndex: 0, type: 'highlight', color: [1, 0.87, 0.35], quads: HL2_QUADS },
        ],
      }),
    )
    const [first, second] = await listAnnots(bytes)
    const out = await applyAnnotDeletes(bytes, [
      { ...toDelete(second!, 'highlight'), objNum: first!.objNum },
    ])
    const after = await listAnnots(out)
    expect(after).toHaveLength(1)
    expect(after[0]!.rect).toEqual(first!.rect)
  })

  it('does not remove anything on subtype mismatch (renumbered object safety)', async () => {
    const bytes = await annotatedPdf()
    const ul = (await listAnnots(bytes)).find((a) => a.subtype === 'Underline')!
    // Wrong subtype and a rect that matches nothing: both paths must refuse
    const out = await applyAnnotDeletes(bytes, [
      { ...toDelete(ul, 'highlight'), rect: [400, 400, 500, 420] },
    ])
    expect((await listAnnots(out)).length).toBe(2)
  })

  it('skips out-of-range pages fail-soft', async () => {
    const bytes = await annotatedPdf()
    const hl = (await listAnnots(bytes)).find((a) => a.subtype === 'Highlight')!
    const out = await applyAnnotDeletes(bytes, [{ ...toDelete(hl, 'highlight'), pageIndex: 7 }])
    expect((await listAnnots(out)).length).toBe(2)
  })
})

describe('applySaveRequest with annotDeletes', () => {
  it('removes the saved annotation and writes new markups in one save', async () => {
    const bytes = await annotatedPdf()
    const hl = (await listAnnots(bytes)).find((a) => a.subtype === 'Highlight')!
    const { bytes: out } = await applySaveRequest(
      bytes,
      request({
        annotDeletes: [toDelete(hl, 'highlight')],
        markups: [{ pageIndex: 0, type: 'strikeout', color: [0.86, 0.22, 0.18], quads: HL_QUADS }],
      }),
    )
    const after = await listAnnots(out)
    expect(after.map((a) => a.subtype).sort()).toEqual(['StrikeOut', 'Underline'])
  })
})

describe('applyAnnotDeletes with FreeText', () => {
  const FT_TEXT = 'Review this'
  const FT_RECT: [number, number, number, number] = [100, 650, 300, 684]

  /** A one-page PDF with a saved on-page text box (written by the real save path) */
  async function freeTextPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    const { bytes } = await applySaveRequest(
      await doc.save({ useObjectStreams: false }),
      request({
        drawings: [
          {
            kind: 'text',
            pageIndex: 0,
            color: [0.17, 0.4, 1],
            width: 2,
            rect: FT_RECT,
            text: FT_TEXT,
            fontSize: 14,
            font: 'arial',
            lines: [{ x: 100, y: 664 }],
          },
        ],
      }),
    )
    return bytes
  }

  it('removes a saved text box by object number with contents identity', async () => {
    const bytes = await freeTextPdf()
    const before = await listAnnots(bytes)
    expect(before.map((a) => a.subtype)).toEqual(['FreeText'])
    const out = await applyAnnotDeletes(bytes, [
      {
        pageIndex: 0,
        objNum: before[0]!.objNum,
        subtype: 'freetext',
        rect: before[0]!.rect,
        contents: FT_TEXT,
      },
    ])
    expect(await listAnnots(out)).toHaveLength(0)
  })

  it('falls back to subtype+rect+contents matching when the object number is stale', async () => {
    const bytes = await freeTextPdf()
    const out = await applyAnnotDeletes(bytes, [
      { pageIndex: 0, objNum: 99999, subtype: 'freetext', rect: FT_RECT, contents: FT_TEXT },
    ])
    expect(await listAnnots(out)).toHaveLength(0)
  })

  it('keeps the box when the rect or contents do not match', async () => {
    const bytes = await freeTextPdf()
    const wrongContents = await applyAnnotDeletes(bytes, [
      { pageIndex: 0, objNum: 99999, subtype: 'freetext', rect: FT_RECT, contents: 'other' },
    ])
    expect(await listAnnots(wrongContents)).toHaveLength(1)
    const wrongRect = await applyAnnotDeletes(bytes, [
      {
        pageIndex: 0,
        objNum: 99999,
        subtype: 'freetext',
        rect: [400, 400, 500, 420],
        contents: FT_TEXT,
      },
    ])
    expect(await listAnnots(wrongRect)).toHaveLength(1)
  })
})
