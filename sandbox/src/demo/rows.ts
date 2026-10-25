export interface DemoRow {
  id: number
  region: string
  sku: string
  amount: number
  status: 'ok' | 'warn' | 'fail'
}

const REGIONS = ['north', 'south', 'east', 'west', 'central'] as const

export function makeRows(count: number): DemoRow[] {
  return Array.from({ length: count }, (_, id) => {
    const status = id % 17 === 0 ? 'fail' : id % 5 === 0 ? 'warn' : 'ok'
    return {
      id,
      region: REGIONS[id % REGIONS.length] ?? 'unknown',
      sku: `SKU-${String(id).padStart(6, '0')}`,
      amount: ((id * 37) % 10_000) / 100,
      status,
    }
  })
}
