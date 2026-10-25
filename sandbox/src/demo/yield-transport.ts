import type { SchedulerPriority, YieldFn } from '@werk/core'
import type { YieldTransport } from './dials'

export interface TransportOption {
  value: YieldTransport
  label: string
  hint: string
}

export const YIELD_TRANSPORTS: readonly TransportOption[] = [
  {
    value: 'auto',
    label: 'Auto',
    hint: 'Core default: scheduler.postTask(), then scheduler.yield(), then MessageChannel as the last fallback. The yield branch only runs when postTask is unavailable, because current Chromium stalls rendering for ~100 ms at a time on it.',
  },
  {
    value: 'postTask',
    label: 'postTask',
    hint: 'scheduler.postTask() between slices. Yields to the renderer, so the worst frame drops sharply at the same budget. Falls back to MessageChannel when the Scheduler API is unavailable.',
  },
  {
    value: 'messageChannel',
    label: 'MessageChannel',
    hint: 'MessageChannel fallback. Needs no Scheduler API and also lets frames through, with slightly more yield overhead.',
  },
  {
    value: 'schedulerYield',
    label: 'scheduler.yield',
    hint: 'Forced scheduler.yield() between slices. Reproduces the starvation: ~100-117 ms worst frame at 600k records with a 5 ms budget while Long Tasks stays 0.',
  },
]

interface SchedulerLike {
  yield?: (options?: { priority?: SchedulerPriority }) => Promise<unknown>
  postTask?: (callback: () => void, options?: { priority?: SchedulerPriority }) => Promise<unknown>
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
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

function abortable(yieldOnce: () => Promise<void>): YieldFn {
  return async (options) => {
    if (options?.signal?.aborted) throw abortError()
    await yieldOnce()
    if (options?.signal?.aborted) throw abortError()
  }
}

/**
 * Builds a yield function for the selected transport. `auto` is not handled here: it uses the
 * shared werk runtime, which already applies the core fallback chain.
 */
export function createTransportYield(transport: Exclude<YieldTransport, 'auto'>): YieldFn {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler

  if (transport === 'postTask') {
    const postTask = scheduler?.postTask?.bind(scheduler)
    if (postTask !== undefined) {
      return abortable(async () => {
        await postTask(() => {}, { priority: 'user-visible' })
      })
    }
  }

  if (transport === 'schedulerYield') {
    const scheduleYield = scheduler?.yield?.bind(scheduler)
    if (scheduleYield !== undefined) {
      return abortable(async () => {
        await scheduleYield({ priority: 'user-visible' })
      })
    }
  }

  return abortable(messageChannelYield)
}

export function transportLabel(transport: YieldTransport): string {
  return YIELD_TRANSPORTS.find((option) => option.value === transport)?.label ?? transport
}

export function transportHint(transport: YieldTransport): string {
  return YIELD_TRANSPORTS.find((option) => option.value === transport)?.hint ?? ''
}
