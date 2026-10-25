import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { createWerk, type TaskHandle } from '../src/index'

const runtime = () => createWerk({ budgetMs: 5, now: () => 0, yield: async () => {} })

describe('werk.task', () => {
  it('publishes data and status on success', async () => {
    const handle = runtime().task(({ reportProgress }) => {
      reportProgress(1, 2)
      return { ok: true }
    })

    expect(handle.status.value).toBe('idle')
    expect(handle.data.value).toBeUndefined()

    const result = await handle.run()

    expect(result).toEqual({ ok: true })
    expect(handle.data.value).toEqual({ ok: true })
    expect(handle.pending.value).toBe(false)
    expect(handle.status.value).toBe('success')
    expect(handle.progress.value).toEqual({ kind: 'determinate', completed: 1, total: 2 })
  })

  it('tracks pending state while running', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const handle = runtime().task(async () => {
      await gate
      return 42
    })

    const run = handle.run()

    expect(handle.pending.value).toBe(true)
    expect(handle.status.value).toBe('pending')

    release()
    await expect(run).resolves.toBe(42)
    expect(handle.pending.value).toBe(false)
  })

  it('publishes errors and rejects the run promise', async () => {
    const failure = new Error('boom')
    const handle = runtime().task(() => {
      throw failure
    })

    await expect(handle.run()).rejects.toBe(failure)

    expect(handle.error.value).toBe(failure)
    expect(handle.status.value).toBe('error')
    expect(handle.pending.value).toBe(false)
  })

  it('discards late results after cancellation', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const handle = runtime().task(async () => {
      await gate
      return 'late'
    })

    const run = handle.run()
    handle.cancel()
    release()

    await expect(run).resolves.toBeUndefined()
    expect(handle.data.value).toBeUndefined()
    expect(handle.status.value).toBe('cancelled')
    expect(handle.pending.value).toBe(false)
  })

  it('lets the latest run win', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let calls = 0
    const handle = runtime().task(async () => {
      calls += 1
      if (calls === 1) {
        await firstGate
      }
      return calls
    })

    const first = handle.run()
    const second = handle.run()

    await expect(second).resolves.toBe(2)
    releaseFirst()
    await expect(first).resolves.toBeUndefined()

    expect(handle.data.value).toBe(2)
    expect(handle.status.value).toBe('success')
  })

  it('resets the budget after yielding', async () => {
    let now = 0
    const observed: boolean[] = []
    const handle = createWerk({
      budgetMs: 5,
      now: () => now,
      yield: async () => {
        now = 100
      },
    }).task(async ({ budget, yieldNow }) => {
      now = 6
      observed.push(budget.exceeded())
      await yieldNow()
      observed.push(budget.exceeded())
    })

    await handle.run()

    expect(observed).toEqual([true, false])
  })

  it('cancels when the owning Vue scope is disposed', async () => {
    const scope = effectScope()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let handle: TaskHandle<void> | undefined

    scope.run(() => {
      handle = runtime().task(async () => {
        await gate
      })
    })

    const run = handle?.run()
    expect(handle?.pending.value).toBe(true)

    scope.stop()

    expect(handle?.status.value).toBe('cancelled')
    release()
    await expect(run).resolves.toBeUndefined()
  })
})
