import { DEFAULT_BUDGET_MS } from '@werk/core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DIALS, DIAL_RANGES, isDefaultDials, type NumericDialKey } from '../src/demo/dials'

describe('dials', () => {
  it('keeps the core budget as its default', () => {
    expect(DEFAULT_DIALS.budgetMs).toBe(DEFAULT_BUDGET_MS)
  })

  it('defaults to the core yield transport', () => {
    expect(DEFAULT_DIALS.yieldTransport).toBe('auto')
  })

  it('places every default inside its range and on a step boundary', () => {
    for (const key of Object.keys(DIAL_RANGES) as NumericDialKey[]) {
      const range = DIAL_RANGES[key]
      const value = DEFAULT_DIALS[key]

      expect(value).toBeGreaterThanOrEqual(range.min)
      expect(value).toBeLessThanOrEqual(range.max)
      expect((value - range.min) % range.step).toBe(0)
    }
  })

  it('detects the default configuration', () => {
    expect(isDefaultDials({ ...DEFAULT_DIALS })).toBe(true)
    expect(isDefaultDials({ ...DEFAULT_DIALS, budgetMs: DEFAULT_DIALS.budgetMs + 1 })).toBe(false)
    expect(isDefaultDials({ ...DEFAULT_DIALS, recordCount: 50_000 })).toBe(false)
    expect(isDefaultDials({ ...DEFAULT_DIALS, yieldTransport: 'postTask' })).toBe(false)
    expect(isDefaultDials({ ...DEFAULT_DIALS, yieldTransport: 'schedulerYield' })).toBe(false)
  })
})
