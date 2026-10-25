import { createBudget as makeBudget } from './budget.js'
import { createEffect } from './effect.js'
import { runIngest } from './ingest.js'
import type { Runtime } from './internal.js'
import { createTask } from './task.js'
import type { Werk, WerkOptions } from './types.js'
import { createYieldNow } from './yield.js'

export const DEFAULT_BUDGET_MS = 5

export function createWerk(options: WerkOptions = {}): Werk {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS

  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new RangeError(`budgetMs must be a positive finite number, received ${String(budgetMs)}`)
  }

  const now = options.now ?? (() => performance.now())
  const runtime: Runtime = {
    budgetMs,
    now,
    yield: options.yield ?? createYieldNow(),
  }

  return {
    budgetMs,
    createBudget: (limit = budgetMs) => makeBudget(limit, now),
    yieldNow: runtime.yield,
    task: (fn, taskOptions) => createTask(runtime, fn, taskOptions),
    effect: (fn, effectOptions) => createEffect(runtime, fn, effectOptions),
    ingest: (items, apply, ingestOptions) => runIngest(runtime, items, apply, ingestOptions),
  }
}

export const werk: Werk = createWerk()

export const task = werk.task
export const effect = werk.effect
export const ingest = werk.ingest
export const yieldNow = werk.yieldNow
export const createBudget = werk.createBudget
