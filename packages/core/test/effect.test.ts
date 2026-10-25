import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { createWerk } from '../src/index'

describe('werk.effect', () => {
  it('starts immediately and resolves done', async () => {
    let ran = false
    const handle = createWerk({ yield: async () => {} }).effect(() => {
      ran = true
    })

    await handle.done

    expect(ran).toBe(true)
  })

  it('stops at the next yield after cancellation', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reachedAfter = false
    const handle = createWerk({ yield: async () => gate }).effect(async ({ yieldNow }) => {
      await yieldNow()
      reachedAfter = true
    })

    handle.cancel()
    release()
    await handle.done

    expect(reachedAfter).toBe(false)
  })

  it('rejects on a real error', async () => {
    const failure = new Error('boom')
    const handle = createWerk({ yield: async () => {} }).effect(() => {
      throw failure
    })

    await expect(handle.done).rejects.toBe(failure)
  })

  it('cancels when the owning Vue scope is disposed', async () => {
    const scope = effectScope()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reachedAfter = false
    let handle: ReturnType<ReturnType<typeof createWerk>['effect']> | undefined

    scope.run(() => {
      handle = createWerk({ yield: async () => gate }).effect(async ({ yieldNow }) => {
        await yieldNow()
        reachedAfter = true
      })
    })

    scope.stop()
    release()
    await handle?.done

    expect(reachedAfter).toBe(false)
  })
})
