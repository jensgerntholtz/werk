# Werk

[![CI](https://github.com/jensgerntholtz/werk/actions/workflows/ci.yml/badge.svg)](https://github.com/jensgerntholtz/werk/actions/workflows/ci.yml)

**Werk is a frame budgeter for large client-rendered Vue applications.**

> Status: **foundation**. This repository currently contains workspace tooling and design
> contracts only. The runtime API lands in the next commit and nothing is published.

Werk is built around one invariant: no werk-managed task runs longer than a small JavaScript
budget (roughly 5–8 ms) before yielding, leaving headroom for style, layout, paint, and the
browser's own work. It does not make Vue's rendering, third-party scripts, or garbage collection
free. It owns the work that crosses its boundary and shows everything else in the inspector.

## Two independent products

Werk is not one framework. It is two products that can be adopted separately.

### 1. Runtime: budget scheduler

One scheduler, three backends:

- **Cooperative yielding (default)** — stay on the main thread and yield between units with
  `scheduler.yield()` / `scheduler.postTask()`. No serialization, no cold start, reactivity
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
packages/core/        @werk/core — runtime scheduler (stub until commit 2)
```

Future packages (`@werk/app`, `create-werk`, build layer) are intentionally not scaffolded yet.
See [docs/architecture.md](docs/architecture.md) for the package graph and seams.

## Development

Requires Node `>=22.12.0` and pnpm `12.14.0`.

```sh
pnpm install
pnpm check       # Biome
pnpm typecheck   # tsc -b (same incremental graph as build)
pnpm test        # Vitest
pnpm build
```

On a clean checkout, `pnpm typecheck` emits into `dist/` as well. Project-reference builds have
no `--noEmit` mode, and the generated output is ignored by git.

## Documentation

- [Architecture](docs/architecture.md) — products, boundaries, package shape.
- [Runtime contracts](docs/runtime-contracts.md) — normative v1 semantics.
- [Build layer](docs/build-layer.md) — generated graph, chunks, flags, checker, inspector.
- [Roadmap](docs/roadmap.md) — phasing, exit criteria, open risks.
- [ADR 0001](docs/adr/0001-foundation.md) — foundation decisions.

## License

MIT. See [LICENSE](LICENSE).
