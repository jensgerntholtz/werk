# Roadmap

No dates. Each phase has an exit criterion, and later phases do not start just because the
previous one shipped — they start when the previous one is proven in a real application.

## Phase 1 — Core runtime walking skeleton

**Status: in progress.** The cooperative runtime and sandbox have landed. Real-app validation and
browser-specific scheduler tests remain.

- Budget scheduler with a configurable `budgetMs` (default 5 ms). **Landed.**
- Cooperative yielding with `scheduler.yield` / `scheduler.postTask` fallbacks. **Landed.**
- `werk.effect`, `werk.task`, `werk.ingest`. **Landed.**
- Explicit async boundary: `shallowRef` data plus pending/error/status/progress. **Landed.**
- Cancellation semantics, including late-chunk discard. **Landed.**
- Test injection for clock and yield adapter. **Landed.**
- Sandbox with a heavy fuzzy search and budgeted ingestion. **Landed.**
- Browser-level scheduler fallback tests and a production-style app case. **Remaining.**

**Exit criteria:** one real compute-heavy app uses it; no werk-managed slice intentionally exceeds
the budget; tests cover budget, yield fallbacks, cancellation, and ingestion.

## Phase 2 — Conventions

- `werk/` directory convention.
- Typed task contracts and route-scoped task lifecycle.
- `@werk/app` package: conventions, config, route integration.
- Session-scoped warm pool.

**Exit criteria:** route navigation cancels route-scoped work; session tasks survive; a typed task
contract catches a breaking change at the call site.

## Phase 3 — Build layer

- Vite plugin.
- Feature manifests, generated composite tsconfigs, root solution config.
- `werk check --since <ref>`.
- Chunk derivation from features.
- Feature-scoped HMR.
- Worker bundling and worker HMR.
- COOP/COEP detection and transport degradation.
- Checker interface with `vue-tsc` first.
- Warn-first migration mode.

**Exit criteria:** in a representative app, type-check time drops on a one-feature change; chunks
match the feature graph; a broken worker contract fails compilation; HMR preserves progress.

## Phase 4 — Inspector and computed profiler

- Frame Budget Inspector with flame chart, werk overlays, long-task attribution, progress, pool
  health.
- Dev-mode computed profiler: measure every computed, warn over the threshold with an actionable
  pointer to `werk.task`.

**Exit criteria:** an engineer can explain a real stall from the inspector without reading source.
The inspector does not overclaim: non-werk work is visibly outside werk's boundary.

## Phase 5 — Adoption surface and first-party modules

- `create-werk` scaffolding.
- `werk/` conventions generated for new projects.
- Typed flag manifests and template support.
- Framework-tooling integrations (migration helpers, config presets).
- First-party adapters: TanStack Query, virtualization libraries, PWA/service-worker sync.
- No runtime flag registry; integrate with existing providers.

**Goal:** a new project can adopt the runtime and feature manifests without hand-writing the
scaffolding, and common integrations prove the boundaries rather than hide them.

## Phase 6 — Offline and background compute

- PWA/service-worker sync.
- Offline compute queues.
- Background task scheduling with the same budget/progress/cancellation semantics.

Only after the main-thread and worker backends are proven. This is where the pool seam pays off.

## Meta-framework seam

Do not announce a meta-framework. Design seams (conventions, config, route scope, build graph) so
one becomes possible, but prove rungs 1 and 2 in production first.

## Open risks to revisit each phase

- Feature manifests are a maintenance tax; they must pay off on day one.
- Generated tsconfig graphs fight existing aliases and monorepo packages.
- Feature boundaries are a social problem first; enforcement is disruptive.
- Nuxt SPA mode is the incumbent for structure, modules, and devtools.
- Framework tax: standalone runtime, ejectable build plugin, plain `vue-router` escape hatches
  must remain first-class.

## Non-goals

- SSR / Nuxt support.
- Async computed.
- A "zero stutters" claim.
- SharedWorker multi-tab backend in v1.
- Replacing Vue's renderer, router, or flag registry.
