import { getCurrentScope, onScopeDispose, shallowRef } from 'vue'
import { createBudget } from './budget.js'
import { createTaskContext } from './context.js'
import { isAbortError, throwIfAborted } from './errors.js'
import type { Runtime } from './internal.js'
import type { TaskFn, TaskHandle, TaskOptions, TaskProgress, TaskStatus } from './types.js'

export function createTask<T>(
  runtime: Runtime,
  fn: TaskFn<T>,
  options: TaskOptions = {},
): TaskHandle<T> {
  const data = shallowRef<T | undefined>(undefined)
  const pending = shallowRef(false)
  const error = shallowRef<unknown | null>(null)
  const status = shallowRef<TaskStatus>('idle')
  const progress = shallowRef<TaskProgress | null>(null)

  let controller: AbortController | null = null
  let runToken = 0

  const cancel = (): void => {
    controller?.abort()
    if (pending.value) {
      pending.value = false
      status.value = 'cancelled'
    }
  }

  async function run(): Promise<T | undefined> {
    const token = ++runToken
    controller?.abort()

    const runController = new AbortController()
    const signal = runController.signal
    controller = runController
    pending.value = true
    error.value = null
    status.value = 'pending'
    progress.value = null

    const budget = createBudget(options.budgetMs ?? runtime.budgetMs, runtime.now)
    const report = (next: TaskProgress): void => {
      if (token === runToken && !signal.aborted) {
        progress.value = next
      }
    }
    const context = createTaskContext(runtime, signal, budget, report)

    try {
      throwIfAborted(signal)
      const result = await fn(context)

      if (token !== runToken || controller !== runController || signal.aborted) {
        return undefined
      }

      data.value = result
      status.value = 'success'
      return result
    } catch (cause) {
      if (token !== runToken || controller !== runController) {
        return undefined
      }

      if (signal.aborted || isAbortError(cause)) {
        status.value = 'cancelled'
        return undefined
      }

      error.value = cause
      status.value = 'error'
      throw cause
    } finally {
      if (token === runToken) {
        pending.value = false
        controller = null
      }
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(cancel)
  }

  return { data, pending, error, status, progress, run, cancel }
}
