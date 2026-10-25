# Architecture

Status: runtime v0 implemented (cooperative backend); build layer design only. The normative
behavior lives in [runtime-contracts.md](runtime-contracts.md); this document explains the shape.

## The invariant

Werk owns the frame budget for work crossing its boundary. A werk-managed task must not run
longer than `budgetMs` (default 5 ms, configurable within roughly 3–8 ms) before yielding. The
headroom left after JavaScript exists for style, layout, paint, input, and the browser's own work.

The invariant is deliberately narrow. Werk cannot preempt synchronous code, Vue's renderer,
third-party scripts, or GC. It can publish honest progress, yield at safe boundaries, and expose
where the budget went.

## Two independent products

Werk is not a meta-framework. It has two products with separate value and adoption:

1. **Runtime** — budget scheduler for work that produces or consumes application state.
2. **Build** — feature-boundary compiler and bundler layer for large codebases.

They share a thesis (own the budget, keep boundaries visible) but neither requires the other.
A team can adopt `werk.task` in one file without a worker or build plugin. A build-only team can
use feature tsconfigs and chunks without changing runtime code.

## Runtime

```
application code
      |
      v
 werk.task / werk.effect / werk.ingest
      |
      v
 Budget loop  --->  yieldNow()  --->  scheduler.yield
      |                                scheduler.postTask
      |                                MessageChannel
      v                                setTimeout
 Vue refs (data, pending, error, status)
```

### Backends

- **Cooperative (default).** Main-thread work is split into units and yields between them. No
  serialization, no worker cold start. Vue reactivity continues to work between units. This is
  the correct default for most "heavy" work. **Implemented in v0.**
- **Worker (escalation).** Only for one non-decomposable CPU unit that cannot be split: parsing,
  a large sort, tokenization. The developer tags the task. The worker is bundled per task with a
  typed boundary; a broken task body becomes a compile error at the call site. **Design only.**
- **Ingest.** Results from either backend are applied to reactive state in small batches. This
  keeps the Vue scheduler and downstream render work inside the frame budget even when the
  computation itself is fast. **Implemented in v0.**

### Frame-budget model

The budget is a cooperative instrument, not a preemption mechanism. The runtime measures
JavaScript elapsed with `performance.now()`, checks after units, and yields when the slice is
spent. A single unit that overruns is a contract violation and should be moved to a worker, split,
or explicitly accepted as outside werk's boundary.

### Vue boundary

`computed` is synchronous by contract. Werk does not patch Vue or create async computed values.
`werk.task` exposes the async boundary as refs:

- `data` — a `shallowRef` with the last committed result
- `pending`, `error`, `status` — refs describing the in-flight state
- `run()` / `cancel()` — explicit triggers

Consumers trigger tasks from `watch` or an explicit event. This is the same visible-boundary shape
used by TanStack Query. `werk.effect` wraps the repeated "async watch callback with manual budget
loop" pattern. A dev-mode computed profiler warns when `computed` work exceeds a small threshold
and points at `werk.task`.

### Progress, backpressure, cancellation

These are first-class contracts because yielding creates observable interleaving. The runtime
must make progress honest (determinate capability or indeterminate liveness), prevent producer
stalls (credit/ack), and define what happens to late chunks after cancellation. Details and
defaults: [runtime-contracts.md](runtime-contracts.md).

## Build layer

The build layer treats each `src/features/*` directory as a unit:

```
features/
  dashboard/
    feature.manifest.ts
    ...
  reports/
    feature.manifest.ts
    ...

generated:
  tsconfig.features/*.json       per-feature composite configs
  tsconfig.solution.json         root project-reference solution
  chunk graph                    from feature entries
  flag stubs / full chunks       from manifest flags
```

Responsibilities:

- Generate per-feature composite tsconfigs plus the root solution config. This is the structural
  prerequisite for every later compiler-speed improvement.
- `werk check --since <ref>`: resolve the affected feature set, run the checker only on those
  projects, in parallel.
- Derive chunks from the feature graph instead of a rotting manual `manualChunks`.
- Scope HMR to a feature and its dependents.
- Emit flag-aware chunks from manifest-declared flags; integrate with an existing runtime flag
  provider instead of rebuilding the registry.
- Bundle workers per task with a typed cross-boundary contract.
- Hot-swap workers in dev without losing progress streams.
- Abstract the checker behind an interface so `vue-tsc`, `tsgo` via shim, and future native Volar
  backends are interchangeable.
- Warn before enforcing cross-feature import violations (migration mode).

The build layer ships with the **Frame Budget Inspector**: main-thread flame chart with werk tasks
overlaid, long-task attribution, progress streams, and pool health. This is how the runtime claim
becomes reviewable in a perf review.

Design details and open questions: [build-layer.md](build-layer.md).

## Package graph

```
@werk/core        must work alone; runtime primitives and Vue binding
     ^
     |
@werk/app         conventions, werk/ directory, config, route-scoped tasks
     ^
     |
create-werk       scaffold, devtools, optional modules

build layer       independent entry point; consumes feature manifests, not app runtime
```

Rules:

- `@werk/core` cannot import a higher-level package.
- `@werk/app` may depend on core; core never depends on app.
- The build layer must be usable without the runtime, and the runtime without the build layer.
- Workers are an escalation backend inside core; a future SharedWorker backend must fit behind
  the same pool seam without changing task APIs.
- The escape hatches are first-class: standalone runtime, ejectable build plugin, plain
  `vue-router`.

The build package name is not fixed yet. It is intentionally not scaffolded in the foundation
commit.

## Adoption ladder

Each rung is independently useful:

1. `werk.effect` / `werk.task` with main-thread yielding — one file, no worker, no build plugin.
2. Budgeted ingestion — per list or chart.
3. Workers — per task; inline blob workers work without the build layer.
4. Feature-boundary build — orthogonal; sold on type-check speed.

The meta-framework is a later seam, not an announcement. Rungs 1 and 2 must be proven in a real
application first.

## Adoption risks

- Feature manifests are a maintenance tax. They must pay for themselves immediately through
  faster checks, correct chunks, and typed flags.
- Generated tsconfig graphs will collide with existing path aliases and monorepo packages. Per
  feature overrides must still participate in the graph.
- Feature boundaries are a social problem before a compiler problem. Enforcement will be
  disruptive; migration mode is required.
- Nuxt's SPA mode is the incumbent for structure and devtools. Werk's differentiator is the
  main-thread and feature-boundary thesis, and it has to be demonstrably better.
- Framework tax kills adoption. Escape hatches are part of the product, not an afterthought.

## Explicit non-goals

- SSR and Nuxt support.
- Async computed.
- A zero-stutter guarantee.
- SharedWorker multi-tab backend in v1.
- Rebuilding a runtime feature-flag registry.

## Related documents

- [Runtime contracts](runtime-contracts.md)
- [Build layer](build-layer.md)
- [Roadmap](roadmap.md)
