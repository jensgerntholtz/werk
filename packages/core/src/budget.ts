import type { Budget } from './types.js'

export function createBudget(budgetMs: number, now: () => number): Budget {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new RangeError(`budgetMs must be a positive finite number, received ${String(budgetMs)}`)
  }

  let startedAt = now()

  return {
    budgetMs,
    exceeded: () => now() - startedAt >= budgetMs,
    remaining: () => Math.max(0, budgetMs - (now() - startedAt)),
    reset: () => {
      startedAt = now()
    },
  }
}
