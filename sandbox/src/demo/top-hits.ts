interface Scored {
  score: number
}

/**
 * Bounded top-K collector backed by a min-heap.
 *
 * Keeps the highest-scoring `limit` entries without sorting the full match set. This is what
 * keeps the cooperative search from producing one giant sort task at the end.
 */
export class TopHits<T extends Scored> {
  private readonly heap: T[] = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError(`limit must be a positive integer, received ${String(limit)}`)
    }
  }

  /**
   * Returns whether a hit with this score would enter the heap.
   *
   * Lets hot scan loops skip allocating a hit object for the overwhelming majority of matches
   * that cannot make the top-K cut. Allocating one object per match is the difference between a
   * quiet scan and a major-GC stall in the middle of a run.
   */
  wouldAccept(score: number): boolean {
    if (this.heap.length < this.limit) return true
    const root = this.heap[0]
    return root !== undefined && score > root.score
  }

  add(hit: T): void {
    if (!this.wouldAccept(hit.score)) return

    const heap = this.heap

    if (heap.length < this.limit) {
      heap.push(hit)
      this.bubbleUp(heap.length - 1)
      return
    }

    heap[0] = hit
    this.sinkDown(0)
  }

  sorted(): T[] {
    return [...this.heap].sort((left, right) => right.score - left.score)
  }

  private bubbleUp(start: number): void {
    let index = start
    const heap = this.heap

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      const current = heap[index]
      const above = heap[parent]

      if (current === undefined || above === undefined || current.score >= above.score) return

      heap[index] = above
      heap[parent] = current
      index = parent
    }
  }

  private sinkDown(start: number): void {
    let index = start
    const heap = this.heap
    const current = heap[index]
    if (current === undefined) return

    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let smallest = index

      const leftHit = heap[left]
      if (leftHit !== undefined && leftHit.score < current.score) {
        smallest = left
      }

      const smallestHit = heap[smallest]
      const rightHit = heap[right]
      if (
        rightHit !== undefined &&
        smallestHit !== undefined &&
        rightHit.score < smallestHit.score
      ) {
        smallest = right
      }

      if (smallest === index) return

      const swap = heap[smallest]
      if (swap === undefined) return

      heap[smallest] = current
      heap[index] = swap
      index = smallest
    }
  }
}
