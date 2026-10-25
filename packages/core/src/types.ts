import type { ShallowRef } from 'vue'

export type SchedulerPriority = 'user-blocking' | 'user-visible' | 'background'

export interface YieldOptions {
  priority?: SchedulerPriority
  signal?: AbortSignal
}

export type YieldFn = (options?: YieldOptions) => Promise<void>

export interface Budget {
  readonly budgetMs: number
  exceeded(): boolean
  remaining(): number
  reset(): void
}

export type TaskStatus = 'idle' | 'pending' | 'success' | 'error' | 'cancelled'

export type TaskProgress =
  | { kind: 'determinate'; completed: number; total: number }
  | { kind: 'indeterminate'; lastActivityAt: number }

export interface TaskContext {
  readonly budget: Budget
  readonly signal: AbortSignal
  yieldNow(options?: Omit<YieldOptions, 'signal'>): Promise<void>
  throwIfCancelled(): void
  reportProgress(completed: number, total?: number): void
}

export type TaskFn<T> = (context: TaskContext) => Promise<T> | T

export interface TaskOptions {
  budgetMs?: number
}

export interface TaskHandle<T> {
  readonly data: ShallowRef<T | undefined>
  readonly pending: ShallowRef<boolean>
  readonly error: ShallowRef<unknown | null>
  readonly status: ShallowRef<TaskStatus>
  readonly progress: ShallowRef<TaskProgress | null>
  run(): Promise<T | undefined>
  cancel(): void
}

export interface EffectOptions {
  budgetMs?: number
}

export interface EffectHandle {
  readonly done: Promise<void>
  cancel(): void
}

export interface IngestOptions {
  budgetMs?: number
  signal?: AbortSignal
  maxBatchSize?: number
  onProgress?: (progress: TaskProgress) => void
}

export interface IngestResult {
  committed: number
  batches: number
  cancelled: boolean
}

export interface WerkOptions {
  budgetMs?: number
  now?: () => number
  yield?: YieldFn
}

export interface Werk {
  readonly budgetMs: number
  createBudget(budgetMs?: number): Budget
  yieldNow: YieldFn
  task<T>(fn: TaskFn<T>, options?: TaskOptions): TaskHandle<T>
  effect(fn: TaskFn<void>, options?: EffectOptions): EffectHandle
  ingest<T>(
    items: Iterable<T>,
    apply: (batch: readonly T[]) => void,
    options?: IngestOptions,
  ): Promise<IngestResult>
}
