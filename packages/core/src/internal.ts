import type { YieldFn } from './types.js'

export interface Runtime {
  readonly budgetMs: number
  readonly now: () => number
  readonly yield: YieldFn
}
