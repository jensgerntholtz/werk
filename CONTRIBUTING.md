# Contributing

## Prerequisites

- Node `>=22.12.0` (`.nvmrc` pins the CI version)
- pnpm `12.14.0` (pinned in `package.json`)

## Setup

```sh
pnpm install
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

`pnpm typecheck` uses the same TypeScript project-reference graph as `pnpm build`; project
references do not support `--noEmit`, so both emit into the ignored `dist/` directories.

## Workspace rules

- `@werk/core` must succeed alone. It cannot import from any future higher-level package.
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

The repository is in the foundation phase. Runtime code starts in `packages/core` in the next
commit; until then, `packages/core/src/index.ts` intentionally exports nothing.
