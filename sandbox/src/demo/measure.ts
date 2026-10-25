export interface RunMetrics {
  elapsedMs: number
  longTasks: number
  longestLongTaskMs: number
}

/**
 * Measures a unit of work with the Long Tasks API.
 *
 * Long tasks are main-thread tasks over 50 ms. A cooperative task should produce none; a
 * synchronous search of the same work usually produces one. The observer delivery is async, so
 * the helper waits briefly after the work before returning.
 */
export async function measureMainThread(run: () => Promise<void> | void): Promise<RunMetrics> {
  const longTasks: number[] = []
  let observer: PerformanceObserver | undefined

  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push(entry.duration)
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    observer = undefined
  }

  const started = performance.now()

  try {
    await run()
    const elapsedMs = performance.now() - started

    await new Promise((resolve) => {
      setTimeout(resolve, 120)
    })

    return {
      elapsedMs,
      longTasks: longTasks.length,
      longestLongTaskMs: longTasks.reduce((longest, duration) => Math.max(longest, duration), 0),
    }
  } finally {
    observer?.disconnect()
  }
}
