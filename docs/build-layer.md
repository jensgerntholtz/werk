# Build Layer

Status: design only. No build package is scaffolded in the foundation commit.

The build layer is the second independent product. It pays for itself through type-check speed,
correct chunks, and typed worker/flag boundaries — not through the runtime scheduler.

## Responsibilities

1. Generate per-feature composite `tsconfig` files and a root solution config with project
  references. This is the structural prerequisite for `incremental tsc --build` and later compiler
  speedups.
2. Derive chunks from the feature graph, replacing hand-maintained `manualChunks`.
3. Scope HMR to the edited feature and its dependents.
4. Emit flag-aware chunks from manifest-declared flags.
5. Bundle each worker task with a typed cross-boundary contract.
6. Hot-swap workers during development without losing progress streams.
7. Abstract the checker behind an interface: `vue-tsc`, a `tsgo` shim, or future native Volar.
8. Provide `werk check --since <ref>` with an affected-feature set and parallel execution.
9. Provide warn-first migration for cross-feature import violations.
10. Ship the Frame Budget Inspector.

## Feature manifest

Draft shape; not an API yet:

```ts
export interface FeatureManifest {
  /** Stable feature id; must be unique across the app. */
  name: string
  /** Entry module, relative to the feature directory. */
  entry: string
  /** Optional config merged into the generated composite tsconfig. */
  tsconfig?: string
  /** Manifest-declared feature flags. */
  flags?: Array<{ name: string; description?: string }>
  /** Other features this feature may import from. */
  dependsOn?: string[]
}
```

Open questions:

- Whether `dependsOn` is declared or inferred from imports in migration mode.
- Whether flags are declarations only or also carry defaults and ownership metadata.
- How per-feature tsconfig overrides join the graph without breaking existing path aliases or
  monorepo packages. Overrides must be mergeable, not replacement configs.
- Where generated files live and whether they are committed, gitignored, or written to a cache
  directory. Generated files must be reproducible and easy to inspect.

## Generated TypeScript graph

For each feature, generate a composite project:

- `composite: true`
- `declaration` and declaration maps for references
- feature-local `rootDir` / `outDir`
- explicit `references` to allowed dependency features
- path aliases preserved or explicitly overridden
- shared base config consumed, not copied

A root solution config references all features. `werk check --since <ref>` resolves the changed
features, walks reverse dependencies, and checks only the affected projects in parallel.

The checker is an interface, not a hard dependency:

```ts
export interface Checker {
  readonly name: string
  check(projects: string[], options?: { signal?: AbortSignal }): Promise<CheckResult>
}
```

Adapters: `vue-tsc` first, `tsgo` through a shim where possible, native Volar later. The abstraction
must not leak checker-specific flags into feature manifests.

## Chunks

- Chunk boundaries come from feature entries and the dependency graph.
- No hand-written `manualChunks` as the primary mechanism. A user override may exist, but it is an
  escape hatch, not the design.
- Shared code is attributed deliberately (shared chunk vs duplicate) based on the feature graph.
- Chunk names are stable and human-readable for the inspector.
- Budget/SAB/worker runtime code must not accidentally pull in build-only code.

## Flags

- Manifest-declared flags produce a stub chunk for the disabled path and a full chunk for the
  enabled path.
- The runtime provider (LaunchDarkly, ConfigCat, a config endpoint, or an existing plugin) decides
  which chunk loads. Werk does not rebuild the flag registry.
- Integration target: `vue-feature-toggles` / Vuetify `useFeatures` conventions where present.
- Flag-aware chunks must be tree-shakeable and must not load both implementations by default.
- There must be an explicit dev-mode warning when a flag is declared but no provider is wired.

## HMR and workers

- HMR is scoped to the edited feature plus dependents. Unrelated features must not be invalidated.
- Worker bundling follows the same feature graph.
- A worker task has a typed cross-boundary contract (`defineTask` → typed call site). Breaking the
  task body must be a compile error at the call site, not a runtime shape error.
- Worker HMR hot-swaps the worker in the pool; progress streams survive. This is required for DX,
  not an optimization.
- The pool seam is backend-agnostic so a future SharedWorker backend can be added without changing
  task APIs.

## COOP/COEP detection

- Detect cross-origin isolation requirements at build time.
- Emit the required headers guidance for the deployment target.
- If isolation is unavailable, the runtime degrades SharedArrayBuffer transport to coalesced
  messages and surfaces a visible warning once per session.
- The build must not silently ship `SharedArrayBuffer`-dependent code into a non-isolated app.

## Frame Budget Inspector

Ships with the build layer. Required views:

- Main-thread flame chart with werk tasks overlaid.
- Long-task attribution: "180 ms stall = ingestion of chunk 7 of index-report".
- Progress streams, including determinate vs indeterminate states.
- Worker pool health: spawns, crashes, replays, queue depth, credit windows.
- Computed profiler output with file/component attribution and a "consider `werk.task`" hint.

The inspector is the marketing artifact. It must make the ownership boundary legible: werk work
is shown honestly, and work outside the boundary is visible as outside, not hidden.

## Migration mode

- Default: warn on cross-feature imports.
- Enforcement is opt-in per repo, then per feature.
- Provide a report of violations and an allowlist with justification.
- Do not break the build on day one. Feature boundaries are a social change first.

## Open risks

- Generated configs colliding with existing aliases and monorepo packages.
- Manifest maintenance tax.
- Divergence between the generated chunk graph and actual runtime imports.
- Checker interface leakage (flags or semantics that only one backend supports).
- HMR of workers and progress streams is genuinely hard; it cannot be deferred to "later".
- The build layer must remain usable without the runtime package.

## Related documents

- [Architecture](architecture.md)
- [Runtime contracts](runtime-contracts.md)
- [Roadmap](roadmap.md)
