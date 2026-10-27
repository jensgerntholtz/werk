# Werk

THIS REPO IS STILL IN DRAFT

__________________________________

[![CI](https://github.com/jensgerntholtz/werk/actions/workflows/ci.yml/badge.svg)](https://github.com/jensgerntholtz/werk/actions/workflows/ci.yml)

**Werk is a frame budgeter for large client-rendered Vue applications.**

> Status: **early preview**. The cooperative runtime is implemented and exercised by the
> sandbox. Nothing is published. Workers, progress transports, route scopes, and the build layer
> are still design-only.

Werk is built around one invariant: no werk-managed task runs longer than a small JavaScript
budget (roughly 5–8 ms) before yielding, leaving headroom for style, layout, paint, and the
browser's own work. The budget bounds **werk's work between two yields** (a slice). It does not
bound a frame: at 60 Hz one frame is 16.7 ms and werk can run several slices inside it. It also does
not make Vue's rendering, third-party scripts, or garbage collection free — a GC pause inside a
slice shows up as an overrun and is surfaced rather than hidden.

## Implemented today

- `werk.task` — `shallowRef` data plus pending/error/status/progress refs, latest-run-wins
  cancellation, and an explicit async boundary.
- `werk.effect` — the async watch-callback pattern with budget helpers.
- `werk.ingest` — applies iterables to Vue state in bounded batches with cooperative yields. Batch
  boundaries are flushed for atomicity but only the budget forces a yield, so an ingest is not
  punished for small batches.
- Progress publishes are coalesced to ~10 Hz (with a final flush) instead of one reactive write per
  slice, so a running task does not re-render the application every 5 ms.
- 5 ms default budget with postTask-first yielding (`scheduler.postTask()` → `scheduler.yield()` →
  `MessageChannel` → `setTimeout`); `yieldNow()` resets the budget on resume.
- A Vue sandbox that demonstrates cooperative fuzzy search and budgeted ingestion, with a
  Werk Only / Werk Off / Werk Compare switch, a Long Tasks A/B panel, and dials for the slice
  budget, catalogue size, result limit, ingest row/batch sizes, and yield transport. Each run
  reports **worst frame** next to **worst slice**: at 600,000 records and a 5 ms budget the
  postTask-first default holds a p95 slice at ~5 ms and a 16.7 ms worst frame (one 60 Hz refresh,
  so no dropped frames), while forcing `scheduler.yield()` reports a 100–117 ms worst frame for the
  same work. The sandbox probe ships that comparison as a browser check.

Not implemented yet: worker backend, progress transports, backpressure, route/session scopes,
visibility throttling, adaptive chunk sizing, and the entire build layer.

## Two independent products

Werk is not one framework. It is two products that can be adopted separately.

### 1. Runtime: budget scheduler

One scheduler, three backends:

- **Cooperative yielding (default)** — stay on the main thread and yield between units with
  `scheduler.postTask()` / `scheduler.yield()`. No serialization, no cold start, reactivity
  intact between units.
- **Workers (escalation)** — only for a single non-decomposable CPU unit that blows the budget:
  parsing, large sorts, tokenizers. Tagged explicitly by the developer.
- **Budgeted ingestion** — results from either backend applied to Vue state in ~5 ms slices,
  with yields between slices.

### 2. Build: feature-as-boundary

Each `src/features/*` directory is a build unit with a manifest. The build layer generates
per-feature composite tsconfigs and a root project-reference solution, derives chunks from
features, scopes HMR to the feature plus dependents, and emits flag-aware chunks declared by
manifests. It is sold on type-check and build speed, independently of the runtime.

## Vue integration rules

- **No async `computed`.** `computed` is synchronous by contract. `werk.task` publishes into a
  `shallowRef` with pending/error/status refs; the async boundary stays visible.
- **`werk.effect`** wraps the async watch callback with a manual budget loop.
- **Computed profiler (dev)** warns when a computed takes more than 1–2 ms and points at
  `werk.task`. The paradigm teaches itself at the point of violation.

## Ownership boundary

Werk owns JavaScript work that crosses its boundary. Vue's own patch of large lists, layout,
paint, third-party scripts, and GC remain outside scope. There is no "zero stutters" claim:
the honest claim is **“werk owns the frame budget for all work crossing its boundary.”**

## Non-goals

- No SSR and no Nuxt support. This is a non-goal, not a roadmap item.
- No async computed.
- No SharedWorker multi-tab backend in v1.
- No universal progress promise: opaque work reports indeterminate progress plus liveness.
- No replacement for Vue's renderer, router, or flag registry.

## Repository layout

```
docs/                 architecture, contracts, build-layer design, roadmap
packages/core/        @werk/core — cooperative budget runtime + Vue refs
sandbox/              Vue 3 + Vite demo consuming @werk/core from source
```

Future packages (`@werk/app`, `create-werk`, build layer) are intentionally not scaffolded yet.
See [docs/architecture.md](docs/architecture.md) for the package graph and seams.

## Development

Requires Node `>=22.12.0` and pnpm `12.14.0`.

```sh
pnpm install
pnpm dev         # sandbox at http://localhost:5180
pnpm check       # Biome
pnpm typecheck   # core tsc -b + sandbox vue-tsc
pnpm test        # Vitest
pnpm probe:check # real-Chrome slice/frame check for every yield transport (needs pnpm dev)
pnpm build       # core + sandbox production builds
```

`pnpm typecheck` runs the core project-reference build, which emits into ignored `dist/`, then
typechecks the sandbox with `vue-tsc`.

## Documentation

- [Architecture](docs/architecture.md) — products, boundaries, package shape.
- [Runtime contracts](docs/runtime-contracts.md) — normative v1 semantics.
- [Build layer](docs/build-layer.md) — generated graph, chunks, flags, checker, inspector.
- [Roadmap](docs/roadmap.md) — phasing, exit criteria, open risks.
- [Sandbox](sandbox/README.md) — how the demo works and what to look for.
- [ADR 0001](docs/adr/0001-foundation.md) — foundation decisions.

## License

MIT. See [LICENSE](LICENSE).
