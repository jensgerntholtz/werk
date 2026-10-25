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

**Fuzzy search.** Searches 30,000 deterministically generated nested catalogue records. The query
is scored as a subsequence across title, author, tags, and summary. The work runs through
`werk.task` with a 5 ms budget, progress refs, and latest-run-wins cancellation.

- Type a query and watch the progress bar.
- Press **Blocking baseline** to run the same search synchronously. The UI heartbeat counter
  freezes while the main thread is blocked.
- The elapsed numbers are not the point. Wall-clock time may be similar; the difference is whether
  the browser can paint and handle input between slices.

**Budgeted ingestion.** Applies 15,000 generated rows through `werk.ingest` in bounded batches.
The count and preview update between yields. Cancel keeps committed batches and drops the tail.

## Structure

```
src/App.vue            both demos and the heartbeat
src/demo/catalog.ts    deterministic nested dataset + fuzzy scoring
src/demo/rows.ts       generated ingestion rows
src/demo/...           no committed large JSON fixture
```

The dataset is generated in the browser so the repository stays small. The generator is seeded and
deterministic; every run starts with the same records.

## TypeScript versions

The sandbox typechecks Vue SFCs with `vue-tsc` on TypeScript 6. The package `vue-tsc` does not yet
support TypeScript 7's package layout. `@werk/core` and the repository's project-reference build
stay on TypeScript 7.

The sandbox is not part of the published package graph and has no release story.
