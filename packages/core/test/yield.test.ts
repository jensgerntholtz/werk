import { describe, expect, it, vi } from 'vitest'
import { createYieldNow } from '../src/yield'

describe('createYieldNow', () => {
  it('prefers scheduler.postTask and passes the default priority', async () => {
    const scheduleYield = vi.fn(async () => {})
    const postTask = vi.fn(async () => {})
    const yieldNow = createYieldNow({ yield: scheduleYield, postTask })

    await yieldNow()

    expect(postTask).toHaveBeenCalledWith(expect.any(Function), { priority: 'user-visible' })
    expect(scheduleYield).not.toHaveBeenCalled()
  })

  it('falls back to scheduler.yield when postTask is unavailable', async () => {
    const scheduleYield = vi.fn(async () => {})
    const yieldNow = createYieldNow({ yield: scheduleYield })

    await yieldNow({ priority: 'background' })

    expect(scheduleYield).toHaveBeenCalledWith({ priority: 'background' })
  })

  it('uses scheduler.postTask when yield is unavailable', async () => {
    const postTask = vi.fn(async () => {})
    const yieldNow = createYieldNow({ postTask })

    await yieldNow({ priority: 'background' })

    expect(postTask).toHaveBeenCalledWith(expect.any(Function), { priority: 'background' })
  })

  it('rejects before scheduling when already aborted', async () => {
    const scheduleYield = vi.fn(async () => {})
    const yieldNow = createYieldNow({ yield: scheduleYield })
    const controller = new AbortController()
    controller.abort()

    await expect(yieldNow({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(scheduleYield).not.toHaveBeenCalled()
  })

  it('rejects when aborted during the yield', async () => {
    const controller = new AbortController()
    const yieldNow = createYieldNow({
      yield: async () => {
        controller.abort()
      },
    })

    await expect(yieldNow({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
