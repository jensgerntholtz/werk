export interface RunMetrics {
  elapsedMs: number
  longTasks: number
  worstFrameMs: number
}

interface FrameStats {
  worstFrameMs: number
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function startFrameMonitor(): { stop: () => FrameStats } {
  let previous = performance.now()
  let worstFrameMs = 0
  let active = true
  let rafId = 0

  const tick = (now: number): void => {
    if (!active) return

    const delta = now - previous
    previous = now
    if (delta > worstFrameMs) {
      worstFrameMs = delta
    }
    rafId = requestAnimationFrame(tick)
  }

  rafId = requestAnimationFrame(tick)

  return {
    stop: () => {
      active = false
      cancelAnimationFrame(rafId)
      return { worstFrameMs }
    },
  }
}

/**
 * Measures a unit of work with two signals:
 *
 * - Long Tasks API: individual main-thread tasks over 50 ms.
 * - Frame monitor: the longest gap between animation frames. Many smaller tasks can still add up
 *   past the frame budget without producing a single >50 ms task, so this is the useful metric.
 *
 * The frame monitor is stopped after one frame following the run, so a blocking tail is recorded.
 * Observer delivery is async, so the helper waits briefly before returning the long-task count.
 */
export async function measureMainThread(run: () => Promise<void> | void): Promise<RunMetrics> {
  let longTaskCount = 0
  let observer: PerformanceObserver | undefined

  try {
    observer = new PerformanceObserver((list) => {
      longTaskCount += list.getEntries().length
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    observer = undefined
  }

  const frames = startFrameMonitor()
  const started = performance.now()

  try {
    await run()
    const elapsedMs = performance.now() - started
    await nextFrame()
    const frameStats = frames.stop()

    await new Promise((resolve) => {
      setTimeout(resolve, 120)
    })

    return {
      elapsedMs,
      longTasks: longTaskCount,
      worstFrameMs: frameStats.worstFrameMs,
    }
  } finally {
    frames.stop()
    observer?.disconnect()
  }
}
