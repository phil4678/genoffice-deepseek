import { describe, expect, it } from 'vitest'
import { facadeHorizontalAlign } from '../src/renderer/univer-sync'

describe('facadeHorizontalAlign', () => {
  it('maps the workbook DSL values onto the Univer facade vocabulary', () => {
    expect(facadeHorizontalAlign('left')).toBe('left')
    expect(facadeHorizontalAlign('center')).toBe('center')
    // facade 'normal' is HorizontalAlign.RIGHT — 'right' throws on the facade
    expect(facadeHorizontalAlign('right')).toBe('normal')
  })

  it('clears to the facade default for null/undefined', () => {
    expect(facadeHorizontalAlign(null)).toBe('normal')
    expect(facadeHorizontalAlign(undefined)).toBe('normal')
  })
})
