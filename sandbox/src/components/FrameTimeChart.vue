<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const MAX_MS = 50
const SAMPLE_LIMIT = 180
/**
 * One display refresh at 60 Hz. Frame gaps cannot go below this, so "worst frame 16.7 ms" is a
 * perfect result, not a budget overrun. Werk slice times are measured separately in the run cards.
 */
const VSYNC_MS = 16.7

const canvas = ref<HTMLCanvasElement | null>(null)
const samples: number[] = []

let context: CanvasRenderingContext2D | null = null
let observer: ResizeObserver | null = null
let rafId = 0
let lastFrame = 0
let width = 0
let height = 0

function draw(): void {
  if (context === null) return

  const ctx = context
  const w = width
  const h = height
  ctx.clearRect(0, 0, w, h)

  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(148, 166, 199, 0.08)'
  ctx.beginPath()
  ctx.moveTo(0, 0.5)
  ctx.lineTo(w, 0.5)
  ctx.stroke()

  // One-vsync reference: bars at or below this line mean the browser hit every refresh.
  const vsyncLine = h - (VSYNC_MS / MAX_MS) * h
  ctx.strokeStyle = 'rgba(125, 152, 255, 0.35)'
  ctx.setLineDash([3, 4])
  ctx.beginPath()
  ctx.moveTo(0, Math.round(vsyncLine) + 0.5)
  ctx.lineTo(w, Math.round(vsyncLine) + 0.5)
  ctx.stroke()
  ctx.setLineDash([])

  if (samples.length === 0) return

  const step = w / SAMPLE_LIMIT
  const barWidth = Math.max(1, step - 1)

  for (let index = 0; index < samples.length; index += 1) {
    const duration = samples[index] ?? 0
    const clamped = Math.min(duration, MAX_MS)
    const barHeight = Math.max(1, (clamped / MAX_MS) * (h - 2))
    const x = w - (samples.length - index) * step

    ctx.fillStyle = duration >= 50 ? '#ff8a8a' : duration > VSYNC_MS * 1.75 ? '#f4b45e' : '#61d99c'
    ctx.fillRect(Math.max(0, x), h - barHeight, barWidth, barHeight)
  }
}

function resize(): void {
  const element = canvas.value
  if (element === null) return

  const rect = element.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  width = Math.max(1, Math.round(rect.width))
  height = Math.max(1, Math.round(rect.height))
  element.width = Math.round(width * ratio)
  element.height = Math.round(height * ratio)
  context = element.getContext('2d')
  context?.setTransform(ratio, 0, 0, ratio, 0, 0)

  draw()
}

function tick(now: number): void {
  if (lastFrame === 0) {
    lastFrame = now
  } else {
    const delta = now - lastFrame
    lastFrame = now

    if (delta > 0 && delta < 1_000) {
      samples.push(delta)
      if (samples.length > SAMPLE_LIMIT) {
        samples.splice(0, samples.length - SAMPLE_LIMIT)
      }
    }
  }

  draw()
  rafId = requestAnimationFrame(tick)
}

onMounted(() => {
  resize()
  observer = new ResizeObserver(() => {
    resize()
  })
  if (canvas.value !== null) {
    observer.observe(canvas.value)
  }
  rafId = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div class="frame-chart">
    <div class="frame-chart-head">
      <span>Frame time · 60 Hz floor 16.7 ms</span>
      <span>0–50 ms</span>
    </div>
    <canvas
      ref="canvas"
      role="img"
      aria-label="Recent frame times on a 50 millisecond scale, with a 16.7 millisecond one-refresh floor"
    ></canvas>
  </div>
</template>

<style scoped>
.frame-chart {
  margin: 0.9rem 0 0.6rem;
}

.frame-chart-head {
  display: flex;
  justify-content: space-between;
  color: #5f6d83;
  font-size: 0.6rem;
  letter-spacing: 0.07em;
  margin-bottom: 0.35rem;
  text-transform: uppercase;
}

canvas {
  display: block;
  width: 100%;
  height: 58px;
  border: 1px solid rgba(148, 166, 199, 0.12);
  border-radius: 0.55rem;
  background: #0a0e17;
}
</style>
