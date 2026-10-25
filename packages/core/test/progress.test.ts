import { describe, expect, it } from 'vitest'
import type { TaskProgress } from '../src/index'
import { createProgressPublisher } from '../src/progress'

describe('createProgressPublisher', () => {
  it('publishes the first value immediately, then coalesces inside the interval', () => {
    let now = 0
    const published: TaskProgress[] = []
    const publisher = createProgressPublisher(
      (next) => published.push(next),
      () => now,
      100,
    )
    const progress = (completed: number): TaskProgress => ({
      kind: 'determinate',
      completed,
      total: 100,
    })

    publisher.publish(progress(1))
    publisher.publish(progress(2))
    publisher.publish(progress(3))

    expect(published).toEqual([progress(1)])

    now = 99
    publisher.publish(progress(4))
    expect(published).toEqual([progress(1)])

    now = 100
    publisher.publish(progress(5))
    expect(published).toEqual([progress(1), progress(5)])

    publisher.publish(progress(6))
    publisher.flush()
    expect(published).toEqual([progress(1), progress(5), progress(6)])
  })

  it('flushes nothing when every value was already published', () => {
    let now = 0
    const published: number[] = []
    const publisher = createProgressPublisher(
      (next) => published.push(next.kind === 'determinate' ? next.completed : -1),
      () => now,
      100,
    )

    now = 1
    publisher.publish({ kind: 'determinate', completed: 1, total: 2 })
    publisher.flush()

    expect(published).toEqual([1])
  })
})
