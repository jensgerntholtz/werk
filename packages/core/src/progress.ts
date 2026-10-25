import type { TaskProgress } from './types.js'

/**
 * Default publish interval for determinate progress.
 *
 * The runtime contract requires progress to be coalesced to roughly 4–10 Hz. Publishing on every
 * slice (every ~5 ms) forces a reactive write and a component re-render per slice, which costs more
 * main-thread time than the work the slice budget is trying to protect.
 */
export const PROGRESS_INTERVAL_MS = 100

export interface ProgressPublisher {
  /** Publishes now if the interval elapsed, otherwise keeps the latest value for the next publish. */
  publish(progress: TaskProgress): void
  /** Publishes the latest incomplete progress immediately, e.g. when the work finishes. */
  flush(): void
}

export function createProgressPublisher(
  publish: (progress: TaskProgress) => void,
  now: () => number,
  intervalMs: number = PROGRESS_INTERVAL_MS,
): ProgressPublisher {
  let lastPublishedAt = Number.NEGATIVE_INFINITY
  let pending: TaskProgress | null = null

  return {
    publish(next) {
      const at = now()
      if (at - lastPublishedAt >= intervalMs) {
        pending = null
        lastPublishedAt = at
        publish(next)
        return
      }
      pending = next
    },
    flush() {
      if (pending === null) return
      publish(pending)
      pending = null
      lastPublishedAt = now()
    },
  }
}
