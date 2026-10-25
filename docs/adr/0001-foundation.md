# ADR 0001 — Repository foundation

- Status: accepted
- Date: 2026-10-25

## Context

Werk is a new repository with a product thesis but no code. The first substantive commit must make
the workspace reviewable and set boundaries before the runtime or build layer is written. Scope for
this commit is foundation only: tooling, a package stub, documentation, CI, and license. Runtime
behavior starts in the next commit.

## Decisions

1. **pnpm workspace.** The repository is a monorepo from day one (`@werk/core`, later `@werk/app`
   and `create-werk`). pnpm workspaces, a single lockfile, and pnpm's strict layout fit the
   package-boundary thesis.
2. **TypeScript project references.** `tsc -b` is the build and typecheck entry point. Composite
   projects and a root solution config are the prerequisite for the build layer's feature tsconfigs.
   Note: `tsc -b --noEmit` is incompatible with project references, so typechecking emits build
   outputs; those are ignored.
3. **Vitest** for unit tests in Node. A test double for the scheduler is required so timing tests
   do not depend on wall-clock speed. Test infrastructure starts with one entry smoke test and grows
   into contract tests in the runtime commit.
4. **Biome** for formatting and linting; one fast tool instead of an ESLint/Prettier stack.
5. **MIT license.** Permissive, standard for developer tooling, low adoption friction.
6. **Vue is a peer dependency** of `@werk/core` from day one. Werk is Vue-specific by design; a
   framework-agnostic abstraction would hide the async-boundary work the product exists to solve.
7. **CSR/SPA only.** SSR and Nuxt are non-goals, not a future backlog item. This is a product
   decision, not an implementation limitation.
8. **`@werk/core` is private until first release.** The npm name is currently available, but the
   package is not publishable while its public API is empty.
9. **The build package name is deferred.** The brief does not name it; scaffolding a name now would
   create a false commitment.
10. **Docs are normative.** Runtime contracts live in `docs/runtime-contracts.md`; behavior changes
    require a docs update in the same commit.

## Consequences

- The first commit has no runtime API. README and package entry state that plainly.
- Tooling is intentionally minimal: no changesets, no release workflow, no examples, no playground,
  no browser test runner. Those are added when they have something to verify.
- The project-reference graph is the single TypeScript graph. Contributors may see `dist/` after
  typechecking; it is gitignored.
- If pnpm or TypeScript causes friction on a real app, this ADR is superseded rather than silently
  drifting.
