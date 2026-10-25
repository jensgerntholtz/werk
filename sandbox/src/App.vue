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

type Mode = 'only' | 'off' | 'compare'

interface RunCard {
  id: 'on' | 'off'
  title: string
  tag: string
  metrics: RunMetrics
  yields: number
}

interface RunState {
  query: string
  cards: RunCard[]
}

const MODE_OPTIONS: readonly { value: Mode; label: string }[] = [
  { value: 'only', label: 'Werk Only' },
  { value: 'off', label: 'Werk Off' },
  { value: 'compare', label: 'Werk Compare' },
]

const SEARCH_LIMIT = 100
const rowsSource = makeRows(15_000)
const ROW_COUNT = rowsSource.length

const mode = ref<Mode>('compare')
const modeRunning = ref(false)
const runState = shallowRef<RunState | null>(null)
const query = ref('sil')
const result = shallowRef<SearchResult | null>(null)
const heartbeat = ref(0)
const blocking = ref(false)
const werkYields = ref(0)

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

const currentModeLabel = computed(
  () => MODE_OPTIONS.find((option) => option.value === mode.value)?.label ?? '',
)
const modeNote = computed(() => {
  if (mode.value === 'off') return 'Same work, no cooperative yields.'
  if (mode.value === 'only') return 'Cooperative path only, no baseline.'
  return 'Runs both paths back to back and compares them.'
})
const runLabel = computed(() => {
  if (mode.value === 'off') return 'Run werk off'
  if (mode.value === 'only') return 'Run werk only'
  return 'Compare werk on vs off'
})
const runTitle = computed(() => (mode.value === 'compare' ? 'A/B comparison' : 'Run metrics'))
const runNote = computed(() => {
  if (mode.value === 'off') {
    return 'Synchronous path only. The main thread is held for the whole search.'
  }
  if (mode.value === 'only') {
    return 'Cooperative path only. Werk yields every 5 ms; the browser keeps painting.'
  }
  return 'Both paths use the same scorer and 100-hit limit. Werk on yields every 5 ms; werk off does the same work in one block.'
})

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
const maxLongTask = computed(() =>
  Math.max(...(runState.value?.cards.map((card) => card.metrics.longestLongTaskMs) ?? [0]), 1),
)

function taskWidth(milliseconds: number): string {
  return `${Math.max(4, Math.round((milliseconds / maxLongTask.value) * 100))}%`
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function onCard(metrics: RunMetrics): RunCard {
  return { id: 'on', title: 'werk on', tag: 'cooperative', metrics, yields: werkYields.value }
}

function offCard(metrics: RunMetrics): RunCard {
  return { id: 'off', title: 'werk off', tag: 'blocking', metrics, yields: 0 }
}

async function measureOn(): Promise<RunMetrics> {
  return measureMainThread(async () => {
    const next = await searchTask.run()
    if (next !== undefined) {
      result.value = next
    }
  })
}

async function runMode(): Promise<void> {
  if (modeRunning.value) return

  modeRunning.value = true
  const activeMode = mode.value
  const queryAtStart = query.value
  runState.value = null
  werkYields.value = 0
  searchTask.cancel()

  try {
    await nextFrame()

    if (activeMode === 'only') {
      const onMetrics = await measureOn()
      runState.value = { query: queryAtStart, cards: [onCard(onMetrics)] }
      return
    }

    blocking.value = true
    await nextFrame()
    const offMetrics = await measureMainThread(() => {
      result.value = searchCatalog(queryAtStart)
    })
    blocking.value = false

    if (activeMode === 'off') {
      runState.value = { query: queryAtStart, cards: [offCard(offMetrics)] }
      return
    }

    await nextFrame()
    const onMetrics = await measureOn()
    runState.value = {
      query: queryAtStart,
      cards: [onCard(onMetrics), offCard(offMetrics)],
    }
  } catch (cause) {
    console.error('search run failed', cause)
  } finally {
    blocking.value = false
    modeRunning.value = false
  }
}

function setMode(next: Mode): void {
  if (modeRunning.value || mode.value === next) return
  window.clearTimeout(debounceTimer)
  mode.value = next
  void runMode()
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

let debounceTimer: ReturnType<typeof setTimeout> | undefined
let heartbeatTimer: ReturnType<typeof setInterval> | undefined

watch(query, () => {
  if (modeRunning.value) return
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    void runMode()
  }, 150)
})

onMounted(() => {
  heartbeatTimer = window.setInterval(() => {
    heartbeat.value += 1
  }, 50)
  void runMode()
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
        panel applies {{ ROW_COUNT.toLocaleString() }} rows in bounded slices. Switch between modes
        to compare the same work with and without werk.
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

        <div class="mode-switch" role="group" aria-label="Execution mode">
          <button
            v-for="option in MODE_OPTIONS"
            :key="option.value"
            type="button"
            class="mode-option"
            :class="{ active: mode === option.value }"
            :aria-pressed="mode === option.value"
            :disabled="modeRunning"
            @click="setMode(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <p class="mode-note">{{ modeNote }}</p>

        <label class="field">
          <span>Query</span>
          <input
            v-model="query"
            type="search"
            placeholder="Try “sil”, “atlas”, or “glass”"
            autocomplete="off"
            spellcheck="false"
            :disabled="modeRunning"
          />
        </label>

        <div class="actions">
          <button class="button primary" :disabled="modeRunning" @click="runMode">
            {{ modeRunning ? 'Running…' : runLabel }}
          </button>
        </div>

        <div class="heartbeat" :class="{ paused: blocking }">
          <span class="pulse"></span>
          <span>UI heartbeat</span>
          <strong>{{ heartbeat }}</strong>
          <span class="muted">50 ms interval</span>
        </div>

        <div
          v-if="modeRunning || (searchPercent !== null && mode !== 'off')"
          class="progress"
        >
          <div class="bar" :class="{ indeterminate: searchPercent === null || blocking }">
            <span
              :style="
                searchPercent === null || blocking ? undefined : { width: `${searchPercent}%` }
              "
            ></span>
          </div>
          <div class="progress-meta">
            <span>{{
              blocking ? 'blocking' : searchPercent === null ? 'yielding' : `${searchPercent}%`
            }}</span>
            <span v-if="!blocking && searchCompleted !== null && searchTotal !== null">
              {{ searchCompleted.toLocaleString() }} / {{ searchTotal.toLocaleString() }}
            </span>
          </div>
        </div>

        <p v-if="searchError" class="error">{{ searchError }}</p>

        <div class="meta">
          <span><strong>{{ totalMatches.toLocaleString() }}</strong> matches</span>
          <span class="muted">mode: {{ currentModeLabel }}</span>
          <span v-if="werkYields > 0">{{ werkYields }} yields</span>
        </div>

        <div v-if="runState" class="comparison">
          <div class="comparison-head">
            <div>
              <span class="eyebrow">{{ runTitle }}</span>
              <span class="muted">query “{{ runState.query }}” · same dataset</span>
            </div>
            <span class="badge">{{ CATALOG_SIZE.toLocaleString() }} records</span>
          </div>

          <div class="comparison-grid" :class="{ single: runState.cards.length === 1 }">
            <article
              v-for="card in runState.cards"
              :key="card.id"
              class="compare-card"
              :class="card.id"
            >
              <header>
                <strong>{{ card.title }}</strong>
                <span class="compare-tag">{{ card.tag }}</span>
              </header>
              <dl>
                <div>
                  <dt>total</dt>
                  <dd>{{ formatMs(card.metrics.elapsedMs) }}</dd>
                </div>
                <div>
                  <dt>long tasks</dt>
                  <dd>{{ card.metrics.longTasks }}</dd>
                </div>
                <div>
                  <dt>longest task</dt>
                  <dd>{{ formatMs(card.metrics.longestLongTaskMs) }}</dd>
                </div>
                <div>
                  <dt>yields</dt>
                  <dd>{{ card.yields }}</dd>
                </div>
              </dl>
              <div class="meter">
                <span :style="{ width: taskWidth(card.metrics.longestLongTaskMs) }"></span>
              </div>
            </article>
          </div>

          <p class="comparison-note">{{ runNote }}</p>
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
