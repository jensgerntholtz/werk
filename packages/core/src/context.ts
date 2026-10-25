import { throwIfAborted } from './errors.js'
import type { Runtime } from './internal.js'
import type { Budget, TaskContext, TaskProgress } from './types.js'

export function createTaskContext(
  runtime: Runtime,
  signal: AbortSignal,
  budget: Budget,
  report: (progress: TaskProgress) => void,
): TaskContext {
  return {
    budget,
    signal,
    async yieldNow(options) {
      throwIfAborted(signal)
      await runtime.yield({ ...options, signal })
      throwIfAborted(signal)
      budget.reset()
    },
    throwIfCancelled() {
      throwIfAborted(signal)
    },
    reportProgress(completed, total) {
      if (signal.aborted) return
      report(toProgress(completed, total, runtime.now))
    },
  }
}

export function toProgress(
  completed: number,
  total: number | undefined,
  now: () => number,
): TaskProgress {
  if (total !== undefined && Number.isFinite(total) && total > 0) {
    return {
      kind: 'determinate',
      completed: Math.max(0, Math.min(completed, total)),
      total,
    }
  }

  return { kind: 'indeterminate', lastActivityAt: now() }
}
