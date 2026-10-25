import { createBudget } from './budget.js'
import { toProgress } from './context.js'
import { isAbortError, throwIfAborted } from './errors.js'
import type { Runtime } from './internal.js'
import type { IngestOptions, IngestResult } from './types.js'

const DEFAULT_MAX_BATCH_SIZE = 512

export async function runIngest<T>(
  runtime: Runtime,
  items: Iterable<T>,
  apply: (batch: readonly T[]) => void,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const budget = createBudget(options.budgetMs ?? runtime.budgetMs, runtime.now)
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE

  if (!Number.isInteger(maxBatchSize) || maxBatchSize <= 0) {
    throw new RangeError(
      `maxBatchSize must be a positive integer, received ${String(maxBatchSize)}`,
    )
  }

  const total = Array.isArray(items) ? items.length : undefined
  const signal = options.signal
  let batch: T[] = []
  let committed = 0
  let batches = 0

  const publish = (): void => {
    options.onProgress?.(toProgress(committed, total, runtime.now))
  }

  const flush = (): void => {
    if (batch.length === 0) return
    apply(batch)
    committed += batch.length
    batches += 1
    batch = []
    publish()
  }

  try {
    for (const item of items) {
      batch.push(item)

      if (batch.length >= maxBatchSize || budget.exceeded()) {
        flush()
        throwIfAborted(signal)
        await runtime.yield(signal === undefined ? undefined : { signal })
        throwIfAborted(signal)
        budget.reset()
      }
    }

    flush()
    return { committed, batches, cancelled: false }
  } catch (cause) {
    if (signal?.aborted || isAbortError(cause)) {
      return { committed, batches, cancelled: true }
    }
    throw cause
  }
}
