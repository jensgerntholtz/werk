# Runtime Contracts (v1)

Status: normative design. The v0 cooperative implementation covers budget, yielding,
`werk.task`, `werk.effect`, ingestion, cancellation, and determinate/indeterminate progress refs.
Worker transport, backpressure, route scopes, visibility, and adaptive sizing are not implemented
yet. Defaults marked **initial** may be tuned against a real application but may not be silently
changed: a change requires an ADR and a docs update.

The key words MUST, MUST NOT, SHOULD, and MAY are used in the RFC 2119 sense.

## 1. Frame budget

- A werk-managed task MUST check the budget after each unit of work and yield when
  `budget.exceeded()` is true.
- The default `budgetMs` is **initial** `5` ms. Applications MAY configure it in the 3–8 ms range.
- `yieldNow()` MUST reset the budget on resume, so the common loop works without manual resets:

  ```ts
  for (const item of items) {
    process(item)
    if (budget.exceeded()) await yieldNow()
  }
  ```

- The budget measures JavaScript elapsed via `performance.now()`. It MUST NOT include time spent
  waiting for a yield.
- A single atomic unit that exceeds the budget is a violation. The runtime cannot preempt it. The
  developer MUST split it or escalate the whole unit to a worker.
- Yield preference: `scheduler.yield()` → `scheduler.postTask()` → `MessageChannel` →
  `setTimeout(0)`. The chosen adapter SHOULD be observable for diagnostics.
- `yieldNow()` MUST reject with an `AbortError` when the task signal is aborted, so cooperative
  loops can exit without a second check after every yield.

## 2. Progress

Progress is a declared capability, not a universal promise.

- A chunkable task knows its units and MAY report determinate progress
  (`{ kind: 'determinate', completed, total }`).
- An opaque task MUST report indeterminate progress plus liveness (`{ kind: 'indeterminate',
  lastActivityAt }`). It MUST NOT fabricate a percentage.
- Publishing SHOULD be coalesced to roughly 4–10 Hz. It MUST NOT publish on every chunk.
- Transport preference:
  1. `SharedArrayBuffer` + `Atomics`, read on `requestAnimationFrame` with zero clone.
  2. Coalesced structured messages at 4–10 Hz.
  3. `ReadableStream` only for incremental results, not high-frequency counters.
- `SharedArrayBuffer` requires cross-origin isolation. The build layer detects COOP/COEP at build
  time; the runtime MUST degrade to coalesced messages and show one visible warning per session.
- A stalled task without progress for the configured liveness window MUST surface as stalled, not
  as an error and not as 100%.

## 3. Backpressure

- Worker producers MUST use a credit/ack protocol. A worker pauses when unacknowledged chunks
  exceed the configured window (**initial** 4 chunks) and resumes when the consumer acks.
- The consumer acks after the chunk has been applied (or explicitly discarded), not when it was
  received.
- Backpressure is required for "uses a worker" to mean "does not stutter." An unbounded message
  queue is a contract violation.
- The window SHOULD be expressed in chunks for simplicity in v1; a byte-based window may replace
  it later without changing the task API.

## 4. Interleaving and transactional boundaries

- Every yield is an observable boundary. User events, other tasks, and other updates may run
  between slices.
- Each applied batch MUST be atomic: consumers never observe a half-written batch.
- Intermediate state MUST be either unobservable or explicitly labeled partial. `werk.task.data`
  commits only the final result by default. Budgeted ingestion exposes committed-batch state and
  progress; it MUST NOT imply the overall operation is complete.
- A progress bar may only represent committed units. Work that has been computed but not applied
  is not complete.
- If an API exposes partial state, it MUST provide a `partial: true` marker or an equivalent
  version/token that lets consumers distinguish partial from final data.

## 5. Cancellation

- Cancellation uses `AbortSignal`. In-flight work stops at the next checkpoint or yield; the
  runtime cannot interrupt synchronous code.
- Chunks arriving after cancellation MUST be discarded. They MUST NOT commit into reactive state.
- The default cancellation policy is **commit-on-cancel**: applied batches remain; uncommitted
  work is dropped. A caller that needs all-or-nothing behavior owns staging and rollback.
- `cancel()` MUST NOT clear previously committed `data`. The handle status becomes `cancelled`;
  cancellation is not an error.
- `run()` resolving after cancellation MUST resolve as cancelled (`undefined` or a typed cancelled
  result), never as a successful late commit.

## 6. Route boundaries

- Tasks declare a lifetime: `scope: 'task' | 'route' | 'session'`. The default is `task`.
- `route` tasks are cancelled when navigation leaves the owning route. They MUST NOT continue to
  mutate the previous route's state.
- `session` tasks survive navigation and run on a persistent worker pool. They MUST have explicit
  ownership so they are not accidentally duplicated or orphaned.
- Core provides the lifetime primitive; router integration and route matching belong to the
  higher-level app package.

## 7. Worker crash recovery

- Worker crashes MUST NOT require a page reload.
- Default policy: respawn the worker and replay from the last acknowledged chunk **once** per
  task run. If the replay crashes again, fail with a typed `WerkWorkerError`.
- Replay is only valid for tasks declared idempotent. A non-idempotent task MUST fail immediately
  with `WerkWorkerError`; the runtime MUST NOT guess.
- The error path MUST clear pending state and preserve the last committed data.
- Pool health (spawns, crashes, replays, queue depth) is part of the inspector's diagnostics.

## 8. Visibility

- On `visibilitychange` to hidden, background-priority tasks SHOULD suspend at the next yield.
  User-blocking tasks MAY continue.
- Progress publishing MUST stop while hidden. It MAY resume with a fresh snapshot on visible; it
  MUST NOT replay a backlog.
- On resume, the runtime SHOULD avoid a catch-up burst and SHOULD reset adaptive sizing to the
  configured starting value.

## 9. Adaptive chunk sizing

- The runtime SHOULD observe `PerformanceObserver({ entryTypes: ['longtask'] })` and correlate
  long tasks with its own slices.
- When a long task is attributable to a werk slice, the next slice SHOULD shrink (for example by
  half) down to a floor of 1 ms.
- After a clean window, chunk size SHOULD grow slowly back toward the configured budget.
- Adaptation MUST be per task and MUST NOT be driven by unrelated long tasks elsewhere on the
  page.

## 10. Public surface (v0)

The cooperative backend implements these names:

- `werk.task` — task handle with data/pending/error/status refs and `run`/`cancel`
- `werk.effect` → `{ cancel, done }`
- `werk.ingest(items, apply, options)` → committed result
- `yieldNow`
- `Budget` / task context with `budget`, `yieldNow`, `signal`

Rules for the surface:

- No async `computed` export, ever.
- Data is published with `shallowRef`; the async boundary is visible.
- Task handles MUST be cancelable by Vue scope disposal when created inside a component scope.
- No hidden global scheduler in tests: `createWerk` exists for isolated tests and custom clocks.

Not implemented in v0: worker backend and worker crash recovery, SharedArrayBuffer/coalesced/stream
transports, credit/ack backpressure, route/session scopes, visibility suspension, and adaptive
chunk sizing.

## 11. Not specified in v1

These are deliberately left open and must not be implied by the API:

- The exact worker serialization format.
- SharedArrayBuffer memory layout and ownership.
- The exact credit window algorithm beyond the initial chunk window.
- Multi-tab coordination / SharedWorker.
- Cross-origin isolation setup instructions.
- Framework adapters beyond Vue.

## Related documents

- [Architecture](architecture.md)
- [Roadmap](roadmap.md)
