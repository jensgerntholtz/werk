import { describe, expect, it } from 'vitest'
import { createWerk, type TaskProgress } from '../src/index'

describe('werk.ingest', () => {
  it('applies items in bounded batches', async () => {
    const batches: number[][] = []
    const result = await createWerk({ now: () => 0, yield: async () => {} }).ingest(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      (batch) => batches.push([...batch]),
      { maxBatchSize: 3 },
    )

    expect(batches).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]])
    expect(result).toEqual({ committed: 10, batches: 4, cancelled: false })
  })

  it('reports determinate progress for array input', async () => {
    const progress: TaskProgress[] = []
    await createWerk({ now: () => 0, yield: async () => {} }).ingest([1, 2, 3], () => {}, {
      maxBatchSize: 2,
      onProgress: (next) => progress.push(next),
    })

    expect(progress.at(-1)).toEqual({
      kind: 'determinate',
      completed: 3,
      total: 3,
    })
  })

  it('coalesces progress instead of publishing on every batch', async () => {
    const progress: TaskProgress[] = []
    const batches = Array.from({ length: 40 }, (_, index) => index)

    await createWerk({ now: () => 0, yield: async () => {} }).ingest(batches, () => {}, {
      maxBatchSize: 1,
      onProgress: (next) => progress.push(next),
    })

    // One immediate publish, then everything else coalesced into the final flush.
    expect(progress).toHaveLength(2)
    expect(progress.at(-1)).toEqual({ kind: 'determinate', completed: 40, total: 40 })
  })

  it('does not yield on batch boundaries while the budget is intact', async () => {
    let yields = 0
    await createWerk({
      now: () => 0,
      yield: async () => {
        yields += 1
      },
    }).ingest(
      Array.from({ length: 20 }, (_, index) => index),
      () => {},
      { maxBatchSize: 2 },
    )

    expect(yields).toBe(0)
  })

  it('keeps committed batches and stops on abort', async () => {
    const controller = new AbortController()
    let now = 0
    let yields = 0
    const batches: number[][] = []
    const items = {
      *[Symbol.iterator]() {
        for (let index = 0; index < 6; index += 1) {
          now += 6
          yield index
        }
      },
    }

    const result = await createWerk({
      budgetMs: 5,
      now: () => now,
      yield: async () => {
        yields += 1
        if (yields === 1) {
          controller.abort()
        }
      },
    }).ingest(items, (batch) => batches.push([...batch]), {
      signal: controller.signal,
      maxBatchSize: 2,
    })

    expect(result).toEqual({ committed: 1, batches: 1, cancelled: true })
    expect(batches).toEqual([[0]])
  })

  it('slices on budget exhaustion, not only batch size', async () => {
    let now = 0
    const batches: number[][] = []
    const items = {
      *[Symbol.iterator]() {
        for (let index = 0; index < 4; index += 1) {
          now += 6
          yield index
        }
      },
    }

    await createWerk({
      budgetMs: 5,
      now: () => now,
      yield: async () => {
        now += 10
      },
    }).ingest(items, (batch) => batches.push([...batch]), { maxBatchSize: 100 })

    expect(batches).toEqual([[0], [1], [2], [3]])
  })

  it('rejects invalid batch sizes and propagates apply errors', async () => {
    const runtime = createWerk({ now: () => 0, yield: async () => {} })

    await expect(runtime.ingest([1], () => {}, { maxBatchSize: 0 })).rejects.toThrow(RangeError)

    const failure = new Error('apply failed')
    await expect(
      runtime.ingest([1], () => {
        throw failure
      }),
    ).rejects.toBe(failure)
  })
})
