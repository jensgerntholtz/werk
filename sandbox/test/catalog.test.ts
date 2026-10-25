import { describe, expect, it } from 'vitest'
import { buildCatalog, catalogEntries, searchCatalog } from '../src/demo/catalog'

describe('catalogEntries', () => {
  it('is deterministic and prefix-stable across sizes', () => {
    const small = buildCatalog(120)
    const large = buildCatalog(1_200)

    expect(small).toHaveLength(120)
    expect(large.slice(0, 120)).toEqual(small)
  })

  it('yields the requested number of records', () => {
    expect([...catalogEntries(0)]).toHaveLength(0)
    expect([...catalogEntries(7)]).toHaveLength(7)
  })

  it('rejects invalid counts', () => {
    expect(() => [...catalogEntries(-1)]).toThrow(RangeError)
    expect(() => [...catalogEntries(1.5)]).toThrow(RangeError)
  })
})

describe('searchCatalog', () => {
  const catalog = buildCatalog(2_000)

  it('returns no hits for an empty query', () => {
    expect(searchCatalog('   ', 100, catalog)).toEqual({ hits: [], totalMatches: 0 })
  })

  it('honours the result limit and reports the full match count', () => {
    const all = searchCatalog('sil', Number.POSITIVE_INFINITY, catalog)
    const limited = searchCatalog('sil', 5, catalog)

    expect(limited.hits).toHaveLength(Math.min(5, all.totalMatches))
    expect(searchCatalog('sil', 5, catalog).totalMatches).toBeGreaterThan(0)
  })

  it('orders hits by descending score', () => {
    const { hits } = searchCatalog('sil', 25, catalog)
    expect(hits.length).toBeGreaterThan(1)

    for (let index = 1; index < hits.length; index += 1) {
      const previous = hits[index - 1]
      const current = hits[index]
      if (previous === undefined || current === undefined) throw new Error('missing hit')
      expect(previous.score).toBeGreaterThanOrEqual(current.score)
    }
  })
})
