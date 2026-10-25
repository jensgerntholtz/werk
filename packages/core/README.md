# @werk/core

Budget-aware scheduling primitives for Vue applications.

> Status: early preview, not published. Implemented: cooperative budget, yielding, `werk.task`,
> `werk.effect`, `werk.ingest`, cancellation, and progress refs. Workers, transport protocols,
> route scopes, and adaptive sizing are not implemented yet.

## Usage

```ts
import { werk } from '@werk/core'

const search = werk.task(async ({ budget, reportProgress, yieldNow }) => {
  const rows = await loadRows()
  const matches: string[] = []

  for (let index = 0; index < rows.length; index += 1) {
    matches.push(rows[index])
    if (budget.exceeded()) {
      reportProgress(index + 1, rows.length)
      await yieldNow()
    }
  }

  return matches
})

await search.run()
```

`search.data` is a `shallowRef` with the last committed result. `pending`, `error`, `status`, and
`progress` are refs describing the in-flight state. The async boundary stays visible; there is no
async `computed`.

Calling `run()` again aborts the previous run. Results from an aborted run are discarded.
`cancel()` aborts the current run and preserves previously committed data.

## Ingestion

```ts
await werk.ingest(rows, (batch) => {
  target.value.push(...batch)
}, {
  maxBatchSize: 400,
  onProgress: (progress) => {
    if (progress.kind === 'determinate') progressPercent.value = progress.completed / progress.total
  },
})
```

Each batch is applied atomically, then the scheduler yields. Cancellation keeps already applied
batches and drops the uncommitted tail.

## Effect

```ts
const { done, cancel } = werk.effect(async ({ budget, yieldNow, signal }) => {
  for (const item of items) {
    if (signal.aborted) return
    process(item)
    if (budget.exceeded()) await yieldNow()
  }
})
```

`werk.effect` starts immediately and rejects `done` on a real error. It is the async
watch-callback pattern with budget helpers.

## Factory and testing

```ts
import { createWerk } from '@werk/core'

const testWerk = createWerk({
  budgetMs: 5,
  now: () => fakeClock,
  yield: async () => {
    fakeClock += 100
  },
})
```

`werk` is the default instance. `createWerk` isolates tests from wall-clock timing and global
scheduler behavior.

## Semantics

- Default budget: 5 ms.
- Yield preference: `scheduler.yield()` → `scheduler.postTask()` → `MessageChannel` →
  `setTimeout`.
- `yieldNow()` inside a task context resets the budget after resuming.
- `reportProgress(completed, total)` publishes determinate progress; omit `total` for liveness.
- Vue scope disposal cancels tasks and effects created inside a component scope.

The normative contracts live in [docs/runtime-contracts.md](../../docs/runtime-contracts.md).
