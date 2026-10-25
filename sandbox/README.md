# Werk Sandbox

A Vue 3 + Vite sandbox for the cooperative Werk runtime. It exists to make the frame-budget claim
visible, not to be a production example.

Two numbers are easy to confuse, so the panel keeps them apart:

- **Worst slice** — the longest span of werk's own work between two yields. This is what the slice
  budget bounds.
- **Worst frame** — the longest gap between animation frames. At 60 Hz one refresh is 16.7 ms, so a
  16.7–17 ms worst frame means the browser hit every refresh. It is the floor, not an overrun.

## Run

```sh
pnpm install
pnpm dev
```

Open <http://localhost:5180>.

The sandbox imports `@werk/core` from `packages/core/src` through a Vite alias, so runtime changes
hot-reload without rebuilding the package.

## What to look at

**Dials.** Five sliders and one transport switch change the defaults the demos run with. Every
control maps to a werk boundary:

| Dial | Default | Effect |
| --- | --- | --- |
| Slice budget | 5 ms | `budgetMs` for `werk.task` and `werk.ingest`. Lower yields more often, so frames stay tighter but the total time grows. |
| Catalogue records | 600,000 | How many generated records the search scans. Changing it rebuilds the catalogue in cooperative slices before rerunning. |
| Result limit | 100 | Size of the bounded top-K heap and the number of rendered results. |
| Ingest rows | 15,000 | Rows applied by the ingestion demo. |
| Ingest batch | 400 | Maximum rows committed per ingest slice. |
| Yield transport | Auto | How each slice hands the main thread back: `Auto` follows core (`scheduler.postTask()` → `scheduler.yield()` → `MessageChannel`); the other options force one primitive so the frame-time difference is measurable. |

Budget, result limit, record count, and transport rerun the last mode when changed; the ingest dials
apply on the next ingest. **Reset to defaults** restores all six. The search controls disable while a
run or rebuild is in flight and the ingest dials disable while ingesting, so a change never races the
measurement.

The transport switch is also a diagnostic, and Auto is the frame-safe default. At 600,000 records and
a 5 ms budget the Werk On card measures **16.7 ms** worst frame (one 60 Hz refresh) with Auto,
postTask, or MessageChannel, a p95 slice at the 5 ms budget, and 0 long tasks. Forcing
`scheduler.yield` reproduces the starvation: **100–117 ms** worst frame while long tasks stay at 0,
at a total roughly 5–10 % lower. The comparison line records which transport produced the numbers.

Werk reports slices that ran more than half a millisecond past the budget as an **over** count on the
run card. Those outliers are almost always a garbage collection or JIT pause landing inside a slice,
not the loop checking the budget too rarely: at a 1 ms budget the worst slice is still ~5 ms, which
is the pause, not the budget. The sandbox still holds p95 at the configured budget.

The catalogue is generated in the browser, so no dataset is committed. Generation runs through
`werk.task` too: the rebuild reports progress and keeps painting. Most of the frame cost is memory:
600,000 records is roughly 0.5 GB of heap, and 1,000,000 is close to 0.9 GB. Bigger sizes cost
rebuild time and more GC pressure even though the cooperative slices remain short.

**Fuzzy search.** Searches the dialled number of deterministically generated nested catalogue
records (600,000 by default). The query is scored as a subsequence across title, author, tags, and
summary. The work runs through `werk.task` with the dialled budget, progress refs, and
latest-run-wins cancellation. Results use a bounded top-K heap, so the cooperative path never sorts
the full 590k-match set in one task.

- Switch between **Werk Only**, **Werk Off**, and **Werk Compare**. The switch controls both the run
  button and the automatic rerun when a dial or the query changes.
  - **Werk Only** runs the cooperative path only.
  - **Werk Off** runs the same search synchronously.
  - **Werk Compare** runs both back to back and shows an A/B panel.
- Each run reports total time, long tasks over 50 ms, worst frame gap, worst slice, slices over the
  budget, and cooperative yields. Long Tasks stay at zero while worst frame shows whether rendering
  actually kept up; worst slice shows whether werk's own budget held.
- The query stays editable while a run is in flight. If it changes, the next run is queued.
- The frame-time chart tracks recent `requestAnimationFrame` gaps on a fixed 0–50 ms scale. During
  werk-off the chart stalls and then shows the long frame; werk-on keeps drawing. A dashed marker
  at 16.7 ms is the one-refresh floor, not the slice budget — several 5 ms slices can share one
  frame.

The comparison uses the browser's `PerformanceObserver` Long Tasks API (Chromium-based browsers).
Werk-on should report zero long tasks while yielding; werk-off reports one synchronous block.

**Budgeted ingestion.** Applies the dialled row count through `werk.ingest` in batches capped by the
ingest batch dial. The count and preview update between yields. Cancel keeps committed batches and
drops the tail. Batch boundaries no longer force a yield: the budget does. 15,000 rows commit in one
slice with no yields.

## Browser probe

The sandbox ships a zero-dependency browser probe for the budget claim. Start the dev server, then:

```sh
pnpm probe:check
# or: node sandbox/probe/check.mjs 'http://localhost:5180/probe/probe.html' 5
```

It loads the probe page in installed Chrome through the DevTools protocol, measures each slice
directly (not via frame timings), and runs every yield transport. The check fails when a transport's
p95 slice exceeds `budget + 1 ms`, when a Long Task appears during a slice-driven run, or when the
frame-safe transports miss the frame limit. The Chromium `scheduler.yield()` frame result is reported
rather than asserted, because it is a browser behaviour the sandbox documents rather than fixes.

```bash
# Print raw measurements for one configuration
pnpm probe "http://localhost:5180/probe/probe.html?records=600000&budgetMs=5&transport=auto"

# Print what a real UI run reports (metrics panel and ingest)
node sandbox/probe/app.mjs
```

`CHROME_BIN` overrides the Chrome/Chromium binary and `CDP_PORT` the DevTools port. Set `SHOT=/path.png`
to save a full-page screenshot of the panel. No Playwright or other dependency is installed; Node's
global `WebSocket` talks CDP directly.

## Structure

```
src/App.vue                          both demos, dials, and mode control
src/components/DialControl.vue       labelled range slider for one dial
src/components/FrameTimeChart.vue    canvas frame-time chart with 60 Hz floor marker
src/demo/catalog.ts                  deterministic lazy dataset + scoring
src/demo/dials.ts                    dial defaults, ranges, and reset predicate
src/demo/yield-transport.ts          explicit yield functions for the transport switch
src/demo/rows.ts                     generated ingestion rows
src/demo/measure.ts                  Long Tasks API comparison harness
probe/probe.html, probe/probe.ts      browser measurement page and slice-timing loop
probe/run.mjs, probe/app.mjs          CDP drivers for the probe page and the app panel
probe/check.mjs                       per-transport budget/frame check
```

The dataset is generated in the browser so the repository stays small. The generator is seeded and
deterministic; every prefix of a catalogue is shared, so shrinking the record dial never reshuffles
the remaining records.

## TypeScript versions

The sandbox typechecks Vue SFCs with `vue-tsc` on TypeScript 6. The package `vue-tsc` does not yet
support TypeScript 7's package layout. `@werk/core` and the repository's project-reference build
stay on TypeScript 7.

The sandbox is not part of the published package graph and has no release story.
