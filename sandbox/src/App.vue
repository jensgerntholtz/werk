<script setup lang="ts">
import { werk } from '@werk/core'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  CATALOG,
  CATALOG_SIZE,
  type SearchHit,
  type SearchResult,
  scoreEntry,
  searchCatalog,
} from './demo/catalog'
import { measureMainThread, type RunMetrics } from './demo/measure'
import { type DemoRow, makeRows } from './demo/rows'

const SEARCH_LIMIT = 100
const rowsSource = makeRows(15_000)
const ROW_COUNT = rowsSource.length

const query = ref('sil')
const result = shallowRef<SearchResult | null>(null)
const werkElapsedMs = ref<number | null>(null)
const baselineElapsedMs = ref<number | null>(null)
const lastMode = ref<'werk' | 'baseline' | null>(null)
const heartbeat = ref(0)
const blocking = ref(false)
const compareRunning = ref(false)
const werkYields = ref(0)
const comparison = shallowRef<{
  query: string
  werk: RunMetrics
  off: RunMetrics
  werkYields: number
} | null>(null)

const searchTask = werk.task<SearchResult>(async ({ budget, signal, yieldNow, reportProgress }) => {
  const normalized = query.value.trim().toLowerCase()
  if (normalized.length === 0) {
    reportProgress(CATALOG_SIZE, CATALOG_SIZE)
    return { hits: [], totalMatches: 0 }
  }

  const found: SearchHit[] = []
  let processed = 0
  let yields = 0

  for (const entry of CATALOG) {
    if (signal.aborted) break

    const score = scoreEntry(entry, normalized)
    if (score > 0) {
      found.push({ entry, score })
    }
    processed += 1

    if (budget.exceeded()) {
      yields += 1
      reportProgress(processed, CATALOG_SIZE)
      await yieldNow()
    }
  }

  werkYields.value = yields
  reportProgress(CATALOG_SIZE, CATALOG_SIZE)
  found.sort((left, right) => right.score - left.score)
  return { hits: found.slice(0, SEARCH_LIMIT), totalMatches: found.length }
})

const searchPending = computed(() => searchTask.pending.value)
const searchProgress = computed(() => searchTask.progress.value)
const searchError = computed(() => {
  const error = searchTask.error.value
  if (error === null) return ''
  return error instanceof Error ? error.message : String(error)
})
const searchPercent = computed(() => {
  const progress = searchProgress.value
  if (progress?.kind !== 'determinate') return null
  return Math.round((progress.completed / progress.total) * 100)
})
const searchCompleted = computed(() => {
  const progress = searchProgress.value
  return progress?.kind === 'determinate' ? progress.completed : null
})
const searchTotal = computed(() => {
  const progress = searchProgress.value
  return progress?.kind === 'determinate' ? progress.total : null
})
const hits = computed(() => result.value?.hits ?? [])
const totalMatches = computed(() => result.value?.totalMatches ?? 0)
const comparisonMaxTask = computed(() =>
  Math.max(
    comparison.value?.werk.longestLongTaskMs ?? 0,
    comparison.value?.off.longestLongTaskMs ?? 0,
    1,
  ),
)

function blockWidth(milliseconds: number): string {
  return `${Math.max(4, Math.round((milliseconds / comparisonMaxTask.value) * 100))}%`
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined
let heartbeatTimer: ReturnType<typeof setInterval> | undefined

async function runWerk(): Promise<void> {
  comparison.value = null
  const started = performance.now()
  try {
    const next = await searchTask.run()
    if (next === undefined) return
    result.value = next
    werkElapsedMs.value = performance.now() - started
    lastMode.value = 'werk'
  } catch (cause) {
    console.error('werk search failed', cause)
  }
}

async function runComparison(): Promise<void> {
  if (compareRunning.value) return

  compareRunning.value = true
  comparison.value = null
  searchTask.cancel()
  const queryAtStart = query.value

  try {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })

    blocking.value = true
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    const off = await measureMainThread(() => {
      result.value = searchCatalog(queryAtStart)
    })
    baselineElapsedMs.value = off.elapsedMs
    lastMode.value = 'baseline'
    blocking.value = false

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })

    const werk = await measureMainThread(async () => {
      const next = await searchTask.run()
      if (next !== undefined) {
        result.value = next
      }
    })
    werkElapsedMs.value = werk.elapsedMs
    lastMode.value = 'werk'
    comparison.value = { query: queryAtStart, werk, off, werkYields: werkYields.value }
  } catch (cause) {
    console.error('comparison failed', cause)
  } finally {
    blocking.value = false
    compareRunning.value = false
  }
}

const ingestCount = ref(0)
const ingestPreview = shallowRef<DemoRow[]>([])
const ingestProgress = ref<{ completed: number; total: number } | null>(null)
const ingestElapsedMs = ref<number | null>(null)
const ingesting = ref(false)
const ingestCancelled = ref(false)
let ingestController: AbortController | null = null

const ingestPercent = computed(() => {
  const progress = ingestProgress.value
  if (progress === null) return null
  return Math.round((progress.completed / progress.total) * 100)
})
const ingestPercentLabel = computed(() =>
  ingestPercent.value === null ? '—' : `${ingestPercent.value}%`,
)
const werkElapsedLabel = computed(() => formatMs(werkElapsedMs.value))
const baselineElapsedLabel = computed(() => formatMs(baselineElapsedMs.value))
const ingestElapsedLabel = computed(() => formatMs(ingestElapsedMs.value))

async function runIngest(): Promise<void> {
  ingestController?.abort()
  const controller = new AbortController()
  ingestController = controller
  ingestCount.value = 0
  ingestPreview.value = []
  ingestProgress.value = null
  ingestElapsedMs.value = null
  ingestCancelled.value = false
  ingesting.value = true
  const started = performance.now()

  try {
    const outcome = await werk.ingest(
      rowsSource,
      (batch) => {
        ingestCount.value += batch.length
        ingestPreview.value = [...ingestPreview.value, ...batch].slice(0, 8)
      },
      {
        signal: controller.signal,
        maxBatchSize: 400,
        onProgress: (progress) => {
          if (progress.kind === 'determinate') {
            ingestProgress.value = {
              completed: progress.completed,
              total: progress.total,
            }
          }
        },
      },
    )
    ingestElapsedMs.value = performance.now() - started
    ingestCancelled.value = outcome.cancelled
  } catch (cause) {
    console.error('ingest failed', cause)
  } finally {
    if (ingestController === controller) {
      ingestController = null
      ingesting.value = false
    }
  }
}

function cancelIngest(): void {
  ingestController?.abort()
}

function formatMs(value: number | null): string {
  if (value === null) return '—'
  return value < 10 ? `${value.toFixed(1)} ms` : `${value.toFixed(0)} ms`
}

watch(query, () => {
  if (compareRunning.value) return
  comparison.value = null
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    void runWerk()
  }, 120)
})

onMounted(() => {
  heartbeatTimer = window.setInterval(() => {
    heartbeat.value += 1
  }, 50)
  void runWerk()
})

onBeforeUnmount(() => {
  window.clearTimeout(debounceTimer)
  window.clearInterval(heartbeatTimer)
  ingestController?.abort()
  searchTask.cancel()
})
</script>

<template>
  <div class="page">
    <header class="hero">
      <div class="eyebrow">@werk/core · sandbox</div>
      <h1>Frame budget, demonstrated.</h1>
      <p class="lede">
        Two compute-heavy examples running on the main thread. The left panel searches
        {{ CATALOG_SIZE.toLocaleString() }} nested records with a 5 ms cooperative budget. The right
        panel applies {{ ROW_COUNT.toLocaleString() }} rows in bounded slices. Run the A/B
        comparison to see the main-thread difference.
      </p>
      <div class="stats">
        <div class="stat">
          <strong>{{ CATALOG_SIZE.toLocaleString() }}</strong>
          <span>nested records</span>
        </div>
        <div class="stat">
          <strong>{{ ROW_COUNT.toLocaleString() }}</strong>
          <span>ingest rows</span>
        </div>
        <div class="stat">
          <strong>5 ms</strong>
          <span>default budget</span>
        </div>
      </div>
    </header>

    <main class="grid">
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Fuzzy search</h2>
            <p>Subsequence scoring across title, author, tags, and summary.</p>
          </div>
          <span class="badge">werk.task</span>
        </div>

        <label class="field">
          <span>Query</span>
          <input
            v-model="query"
            type="search"
            placeholder="Try “sil”, “atlas”, or “glass”"
            autocomplete="off"
            spellcheck="false"
            :disabled="compareRunning"
          />
        </label>

        <div class="actions">
          <button
            class="button primary"
            :disabled="compareRunning || searchPending"
            @click="runComparison"
          >
            {{ compareRunning ? 'Comparing…' : 'Compare werk on vs off' }}
          </button>
          <button
            class="button ghost"
            :disabled="compareRunning || searchPending"
            @click="runWerk"
          >
            Werk only
          </button>
        </div>
        <p class="action-note">
          Runs the same query twice, back to back: first blocking, then yielding.
        </p>

        <div class="heartbeat" :class="{ paused: blocking }">
          <span class="pulse"></span>
          <span>UI heartbeat</span>
          <strong>{{ heartbeat }}</strong>
          <span class="muted">50 ms interval</span>
        </div>

        <div v-if="searchPending || searchPercent !== null" class="progress">
          <div class="bar" :class="{ indeterminate: searchPercent === null }">
            <span
              :style="searchPercent === null ? undefined : { width: `${searchPercent}%` }"
            ></span>
          </div>
          <div class="progress-meta">
            <span>{{ searchPercent === null ? 'yielding' : `${searchPercent}%` }}</span>
            <span v-if="searchCompleted !== null && searchTotal !== null">
              {{ searchCompleted.toLocaleString() }} / {{ searchTotal.toLocaleString() }}
            </span>
          </div>
        </div>

        <p v-if="searchError" class="error">{{ searchError }}</p>

        <div class="meta">
          <span><strong>{{ totalMatches.toLocaleString() }}</strong> matches</span>
          <span v-if="werkElapsedMs !== null">werk {{ werkElapsedLabel }}</span>
          <span v-if="baselineElapsedMs !== null">baseline {{ baselineElapsedLabel }}</span>
          <span v-if="lastMode !== null" class="muted">last: {{ lastMode }}</span>
        </div>

        <div v-if="comparison" class="comparison">
          <div class="comparison-head">
            <div>
              <span class="eyebrow">A/B comparison</span>
              <span class="muted">query “{{ comparison.query }}” · same dataset</span>
            </div>
            <span class="badge">{{ CATALOG_SIZE.toLocaleString() }} records</span>
          </div>

          <div class="comparison-grid">
            <article class="compare-card on">
              <header>
                <strong>werk on</strong>
                <span class="compare-tag">cooperative</span>
              </header>
              <dl>
                <div>
                  <dt>total</dt>
                  <dd>{{ formatMs(comparison.werk.elapsedMs) }}</dd>
                </div>
                <div>
                  <dt>long tasks</dt>
                  <dd>{{ comparison.werk.longTasks }}</dd>
                </div>
                <div>
                  <dt>longest task</dt>
                  <dd>{{ formatMs(comparison.werk.longestLongTaskMs) }}</dd>
                </div>
                <div>
                  <dt>yields</dt>
                  <dd>{{ comparison.werkYields }}</dd>
                </div>
              </dl>
              <div class="meter">
                <span :style="{ width: blockWidth(comparison.werk.longestLongTaskMs) }"></span>
              </div>
            </article>

            <article class="compare-card off">
              <header>
                <strong>werk off</strong>
                <span class="compare-tag">blocking</span>
              </header>
              <dl>
                <div>
                  <dt>total</dt>
                  <dd>{{ formatMs(comparison.off.elapsedMs) }}</dd>
                </div>
                <div>
                  <dt>long tasks</dt>
                  <dd>{{ comparison.off.longTasks }}</dd>
                </div>
                <div>
                  <dt>longest task</dt>
                  <dd>{{ formatMs(comparison.off.longestLongTaskMs) }}</dd>
                </div>
                <div>
                  <dt>yields</dt>
                  <dd>0</dd>
                </div>
              </dl>
              <div class="meter">
                <span :style="{ width: blockWidth(comparison.off.longestLongTaskMs) }"></span>
              </div>
            </article>
          </div>

          <p class="comparison-note">
            Long tasks are main-thread blocks over 50 ms. Both runs return the same 100 hits.
            Werk on yields every 5 ms; werk off does the same work in one block.
          </p>
        </div>

        <ul class="results">
          <li v-for="hit in hits" :key="hit.entry.id" class="result">
            <div>
              <strong>{{ hit.entry.title }}</strong>
              <span class="result-meta">
                {{ hit.entry.author.name }} · {{ hit.entry.metadata.year }} ·
                {{ hit.entry.metadata.language }}
              </span>
              <span class="tag-row">
                <span v-for="tag in hit.entry.tags.slice(0, 3)" :key="tag" class="tag">{{ tag }}</span>
              </span>
            </div>
            <span class="score">{{ hit.score }}</span>
          </li>
        </ul>
        <p v-if="hits.length === 0" class="empty">No results yet. Run a search.</p>
      </section>

      <section class="card">
        <div class="card-head">
          <div>
            <h2>Budgeted ingestion</h2>
            <p>Apply generated rows to Vue state without one long commit.</p>
          </div>
          <span class="badge">werk.ingest</span>
        </div>

        <div class="ingest-summary">
          <div>
            <strong>{{ ingestCount.toLocaleString() }}</strong>
            <span class="summary-label">rows applied</span>
          </div>
          <div>
            <strong>{{ ingestElapsedLabel }}</strong>
            <span class="summary-label">elapsed</span>
          </div>
          <div>
            <strong>{{ ingestPercentLabel }}</strong>
            <span class="summary-label">progress</span>
          </div>
        </div>

        <div class="actions">
          <button class="button primary" :disabled="ingesting" @click="runIngest">
            {{ ingesting ? 'Ingesting…' : `Ingest ${ROW_COUNT.toLocaleString()} rows` }}
          </button>
          <button v-if="ingesting" class="button ghost" @click="cancelIngest">Cancel</button>
        </div>

        <div v-if="ingestPercent !== null" class="progress">
          <div class="bar">
            <span :style="{ width: `${ingestPercent}%` }"></span>
          </div>
        </div>

        <p v-if="ingestCancelled" class="notice">Cancelled. Committed batches stay applied.</p>

        <table class="preview">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Region</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in ingestPreview" :key="row.id">
              <td>{{ row.sku }}</td>
              <td>{{ row.region }}</td>
              <td>{{ row.amount.toFixed(2) }}</td>
              <td><span class="status" :class="row.status">{{ row.status }}</span></td>
            </tr>
          </tbody>
        </table>
        <p v-if="ingestPreview.length === 0" class="empty">Apply rows to see a preview.</p>
      </section>
    </main>

    <footer class="footer">
      <span>werk owns the frame budget for work crossing its boundary.</span>
      <span>Vue, layout, paint, and GC remain outside it.</span>
    </footer>
  </div>
</template>
