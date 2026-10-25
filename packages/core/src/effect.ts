import { getCurrentScope, onScopeDispose } from 'vue'
import { createBudget } from './budget.js'
import { createTaskContext } from './context.js'
import { isAbortError, throwIfAborted } from './errors.js'
import type { Runtime } from './internal.js'
import type { EffectHandle, EffectOptions, TaskFn } from './types.js'

export function createEffect(
  runtime: Runtime,
  fn: TaskFn<void>,
  options: EffectOptions = {},
): EffectHandle {
  const controller = new AbortController()
  const budget = createBudget(options.budgetMs ?? runtime.budgetMs, runtime.now)
  const context = createTaskContext(runtime, controller.signal, budget, () => {})

  const done = (async () => {
    try {
      throwIfAborted(controller.signal)
      await fn(context)
    } catch (cause) {
      if (controller.signal.aborted || isAbortError(cause)) {
        return
      }
      throw cause
    }
  })()

  const cancel = (): void => {
    controller.abort()
  }

  if (getCurrentScope()) {
    onScopeDispose(cancel)
  }

  return { done, cancel }
}
