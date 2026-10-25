import { describe, expect, it } from 'vitest'
import { createWerk } from '../src/index'

describe('createBudget', () => {
  it('measures elapsed time against the limit', () => {
    let now = 0
    const budget = createWerk({ now: () => now }).createBudget(5)

    expect(budget.budgetMs).toBe(5)
    expect(budget.exceeded()).toBe(false)

    now = 4.99
    expect(budget.exceeded()).toBe(false)
    expect(budget.remaining()).toBeCloseTo(0.01)

    now = 5
    expect(budget.exceeded()).toBe(true)
    expect(budget.remaining()).toBe(0)
  })

  it('resets the window', () => {
    let now = 0
    const budget = createWerk({ now: () => now }).createBudget(5)

    now = 7
    expect(budget.exceeded()).toBe(true)

    now = 10
    budget.reset()

    expect(budget.exceeded()).toBe(false)
    expect(budget.remaining()).toBe(5)
  })

  it('rejects invalid limits', () => {
    const runtime = createWerk({ now: () => 0 })

    expect(() => runtime.createBudget(0)).toThrow(RangeError)
    expect(() => runtime.createBudget(-1)).toThrow(RangeError)
    expect(() => runtime.createBudget(Number.NaN)).toThrow(RangeError)
    expect(() => createWerk({ budgetMs: 0 })).toThrow(RangeError)
  })
})
