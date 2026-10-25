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

  it('keeps committed batches and stops on abort', async () => {
    const controller = new AbortController()
    let yields = 0
    const batches: number[][] = []
    const result = await createWerk({
      now: () => 0,
      yield: async () => {
        yields += 1
        if (yields === 1) {
          controller.abort()
        }
      },
    }).ingest([0, 1, 2, 3, 4, 5], (batch) => batches.push([...batch]), {
      signal: controller.signal,
      maxBatchSize: 2,
    })

    expect(result).toEqual({ committed: 2, batches: 1, cancelled: true })
    expect(batches).toEqual([[0, 1]])
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
