# Contributing

## Prerequisites

- Node `>=22.12.0` (`.nvmrc` pins the CI version)
- pnpm `12.14.0` (pinned in `package.json`)

## Setup

```sh
pnpm install
pnpm dev
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

`pnpm typecheck` runs the core project-reference build (same graph as `pnpm build`) and then
typechecks the sandbox with `vue-tsc`. Project references do not support `--noEmit`, so the core
check emits into the ignored `dist/` directory. The sandbox uses TypeScript 6 because `vue-tsc`
does not yet support TypeScript 7's package layout; core and the repository stay on TypeScript 7.

## Workspace rules

- `@werk/core` must succeed alone. It cannot import from any future higher-level package.
- `sandbox/` is a development demo, not a publishable package. It consumes core source through a
  Vite alias so runtime edits hot-reload.
- The build layer and the runtime are independent products. One must not require the other at
  runtime unless an ADR says otherwise.
- Runtime contracts in [docs/runtime-contracts.md](docs/runtime-contracts.md) are normative.
  Behavior changes require a docs update in the same commit.
- No SSR/Nuxt code paths. CSR/SPA only.
- No async `computed`.

## Style

- Biome owns formatting and linting: `pnpm check:fix`.
- Conventional commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Keep generated files (`dist/`, `*.tsbuildinfo`, coverage) out of commits. `pnpm-lock.yaml` is
  committed and must accompany dependency changes.

## Current phase

The cooperative runtime v0 is implemented in `packages/core`: budget, yielding, `werk.task`,
`werk.effect`, `werk.ingest`, cancellation, and progress refs. `sandbox/` exercises it.

The next slice is browser scheduler coverage, worker escalation, transport/backpressure, and the
build layer. The worker, route-scope, visibility, and adaptive-sizing contracts are documented but
not implemented.
