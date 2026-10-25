import { describe, expect, it } from 'vitest'
import { TopHits } from '../src/demo/top-hits'

interface Hit {
  name: string
  score: number
}

describe('TopHits', () => {
  it('keeps the highest-scoring entries', () => {
    const top = new TopHits<Hit>(3)

    for (const [name, score] of [
      ['five', 5],
      ['one', 1],
      ['nine', 9],
      ['seven', 7],
      ['three', 3],
      ['eight', 8],
    ] as const) {
      top.add({ name, score })
    }

    expect(top.sorted().map((hit) => hit.name)).toEqual(['nine', 'eight', 'seven'])
  })

  it('handles fewer entries than the limit', () => {
    const top = new TopHits<Hit>(10)
    top.add({ name: 'one', score: 1 })
    top.add({ name: 'two', score: 2 })

    expect(top.sorted().map((hit) => hit.score)).toEqual([2, 1])
  })

  it('rejects invalid limits', () => {
    expect(() => new TopHits<Hit>(0)).toThrow(RangeError)
    expect(() => new TopHits<Hit>(1.5)).toThrow(RangeError)
  })
})
