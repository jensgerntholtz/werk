import { throwIfAborted } from './errors.js'
import type { SchedulerPriority, YieldFn } from './types.js'

export interface SchedulerLike {
  yield?: (options?: { priority?: SchedulerPriority }) => Promise<unknown>
  postTask?: (callback: () => void, options?: { priority?: SchedulerPriority }) => Promise<unknown>
}

const DEFAULT_PRIORITY: SchedulerPriority = 'user-visible'

export function createYieldNow(scheduler?: SchedulerLike): YieldFn {
  const activeScheduler = scheduler ?? (globalThis as { scheduler?: SchedulerLike }).scheduler

  // postTask hands the thread back to the event loop, so the renderer can produce frames between
  // slices. scheduler.yield() reschedules its continuation ahead of rendering in current Chromium:
  // with a 5 ms budget it starves frames for ~100 ms at a time even though no task exceeds 50 ms
  // (Long Tasks stays 0 while worst frame is 117 ms). Keep it only for explicitly injected
  // schedulers and for browsers that expose yield without postTask.
  if (activeScheduler?.postTask) {
    const postTask = activeScheduler.postTask.bind(activeScheduler)
    return async (options) => {
      throwIfAborted(options?.signal)
      await postTask(() => {}, { priority: options?.priority ?? DEFAULT_PRIORITY })
      throwIfAborted(options?.signal)
    }
  }

  if (activeScheduler?.yield) {
    const scheduleYield = activeScheduler.yield.bind(activeScheduler)
    return async (options) => {
      throwIfAborted(options?.signal)
      await scheduleYield({ priority: options?.priority ?? DEFAULT_PRIORITY })
      throwIfAborted(options?.signal)
    }
  }

  return async (options) => {
    throwIfAborted(options?.signal)
    await messageChannelYield()
    throwIfAborted(options?.signal)
  }
}

function messageChannelYield(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      channel.port2.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}
