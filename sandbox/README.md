# Werk Sandbox

A Vue 3 + Vite sandbox for the cooperative Werk runtime. It exists to make the frame-budget claim
visible, not to be a production example.

## Run

```sh
pnpm install
pnpm dev
```

Open <http://localhost:5180>.

The sandbox imports `@werk/core` from `packages/core/src` through a Vite alias, so runtime changes
hot-reload without rebuilding the package.

## What to look at

**Fuzzy search.** Searches 60,000 deterministically generated nested catalogue records. The query
is scored as a subsequence across title, author, tags, and summary. The work runs through
`werk.task` with a 5 ms budget, progress refs, and latest-run-wins cancellation.

- Switch between **Werk Only**, **Werk Off**, and **Werk Compare**. The switch controls both the run
  button and the automatic rerun when the query changes.
  - **Werk Only** runs the cooperative path only.
  - **Werk Off** runs the same search synchronously.
  - **Werk Compare** runs both back to back and shows an A/B panel.
- Each run reports total time, long tasks over 50 ms, longest task, and cooperative yields.
- The UI heartbeat freezes during werk-off. Total time is not the point; the difference is whether
  the browser gets the main thread back between slices.

The comparison uses the browser's `PerformanceObserver` Long Tasks API (Chromium-based browsers).
Werk-on should report zero long tasks while yielding; werk-off reports one synchronous block.

**Budgeted ingestion.** Applies 15,000 generated rows through `werk.ingest` in bounded batches.
The count and preview update between yields. Cancel keeps committed batches and drops the tail.

## Structure

```
src/App.vue            both demos and the heartbeat
src/demo/catalog.ts    deterministic nested dataset + fuzzy scoring
src/demo/rows.ts       generated ingestion rows
src/demo/measure.ts    Long Tasks API comparison harness
```

The dataset is generated in the browser so the repository stays small. The generator is seeded and
deterministic; every run starts with the same records.

## TypeScript versions

The sandbox typechecks Vue SFCs with `vue-tsc` on TypeScript 6. The package `vue-tsc` does not yet
support TypeScript 7's package layout. `@werk/core` and the repository's project-reference build
stay on TypeScript 7.

The sandbox is not part of the published package graph and has no release story.
