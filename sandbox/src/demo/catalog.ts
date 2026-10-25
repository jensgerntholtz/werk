export interface CatalogEntry {
  id: number
  title: string
  author: { name: string; country: string }
  tags: string[]
  summary: string
  titleLower: string
  summaryLower: string
  metadata: {
    year: number
    rating: number
    language: string
    formats: string[]
  }
  searchText: string
}

export interface SearchHit {
  entry: CatalogEntry
  score: number
}

export interface SearchResult {
  hits: SearchHit[]
  totalMatches: number
}

const ADJECTIVES = [
  'silent',
  'crimson',
  'fractal',
  'northern',
  'quantum',
  'hidden',
  'electric',
  'fading',
  'iron',
  'velvet',
  'salt',
  'glass',
  'hollow',
  'brass',
  'amber',
  'neon',
  'slow',
  'wild',
  'paper',
  'midnight',
] as const

const NOUNS = [
  'river',
  'atlas',
  'garden',
  'signal',
  'machine',
  'archive',
  'orchard',
  'circuit',
  'harbor',
  'library',
  'engine',
  'forest',
  'lattice',
  'mirror',
  'factory',
  'island',
  'station',
  'cipher',
  'meadow',
  'reactor',
] as const

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const

const FIRST_NAMES = [
  'Ada',
  'Bram',
  'Cora',
  'Dane',
  'Elin',
  'Fenn',
  'Greta',
  'Hale',
  'Iris',
  'Juno',
  'Kai',
  'Lior',
  'Mira',
  'Noor',
  'Oren',
] as const

const LAST_NAMES = [
  'Aalto',
  'Brenner',
  'Calder',
  'Dahl',
  'Eriksen',
  'Fischer',
  'Gallo',
  'Holm',
  'Ibarra',
  'Jansen',
  'Keller',
  'Lund',
  'Moreau',
  'Nakamura',
  'Okafor',
] as const

const COUNTRIES = ['NO', 'SE', 'DK', 'FI', 'NL', 'DE', 'FR', 'JP', 'BR', 'ZA'] as const
const LANGUAGES = ['English', 'Norwegian', 'Japanese', 'Portuguese', 'German'] as const
const FORMATS = ['hardcover', 'paperback', 'audio', 'digital', 'large print'] as const

const TAGS = [
  'architecture',
  'maps',
  'typography',
  'systems',
  'botany',
  'radio',
  'memory',
  'urbanism',
  'signal',
  'futures',
  'archives',
  'craft',
  'climate',
  'networks',
  'ritual',
] as const

const SUMMARY_OPENERS = [
  'A field guide to',
  'Notes on',
  'A practical study of',
  'Fragments from',
  'An illustrated atlas of',
  'A quiet history of',
] as const

const SUMMARY_TOPICS = [
  'moving libraries',
  'coastal infrastructure',
  'forgotten operating systems',
  'seasonal gardens',
  'low-power radio',
  'paper archives',
  'night trains',
  'public records',
  'small machines',
  'shared workspaces',
] as const

function mulberry32(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let next = value
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(values: readonly T[], random: () => number): T {
  const value = values[Math.floor(random() * values.length)]
  if (value === undefined) {
    throw new Error('Cannot pick from an empty collection')
  }
  return value
}

function buildCatalog(count: number): CatalogEntry[] {
  const random = mulberry32(0x5eed)

  return Array.from({ length: count }, (_, id) => {
    const adjective = pick(ADJECTIVES, random)
    const noun = pick(NOUNS, random)
    const suffix = random() > 0.7 ? ` ${pick(NUMERALS, random)}` : ''
    const title = `${adjective} ${noun}${suffix}`
    const author = {
      name: `${pick(FIRST_NAMES, random)} ${pick(LAST_NAMES, random)}`,
      country: pick(COUNTRIES, random),
    }
    const tags = [
      ...new Set(Array.from({ length: 2 + Math.floor(random() * 3) }, () => pick(TAGS, random))),
    ]
    const formats = Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
      pick(FORMATS, random),
    )
    const metadata = {
      year: 1950 + Math.floor(random() * 76),
      rating: Math.round((2.5 + random() * 2.5) * 10) / 10,
      language: pick(LANGUAGES, random),
      formats,
    }
    const summary = `${pick(SUMMARY_OPENERS, random)} ${pick(SUMMARY_TOPICS, random)}, ${pick(
      SUMMARY_TOPICS,
      random,
    )}, and ${pick(FORMATS, random)} editions.`

    const entry: CatalogEntry = {
      id,
      title,
      author,
      tags,
      summary,
      titleLower: title.toLowerCase(),
      summaryLower: summary.toLowerCase(),
      metadata,
      searchText: '',
    }

    entry.searchText = [
      title,
      author.name,
      author.country,
      tags.join(' '),
      summary,
      metadata.language,
      metadata.formats.join(' '),
      String(metadata.year),
    ]
      .join(' ')
      .toLowerCase()

    return entry
  })
}

export const CATALOG: readonly CatalogEntry[] = buildCatalog(600_000)
export const CATALOG_SIZE = CATALOG.length

export function fuzzyScore(text: string, query: string): number {
  let queryIndex = 0
  let score = 0
  let previous = -2

  for (let index = 0; index < text.length && queryIndex < query.length; index += 1) {
    if (text.charCodeAt(index) !== query.charCodeAt(queryIndex)) continue

    score += index === previous + 1 ? 3 : 1
    if (index === 0) score += 2
    previous = index
    queryIndex += 1
  }

  if (queryIndex !== query.length) return 0

  const direct = text.indexOf(query)
  if (direct === 0) return score + 30
  if (direct > 0) return score + 10
  return score
}

export function scoreEntry(entry: CatalogEntry, normalizedQuery: string): number {
  const base = fuzzyScore(entry.searchText, normalizedQuery)
  if (base === 0) return 0

  const title = fuzzyScore(entry.titleLower, normalizedQuery)
  const summary = fuzzyScore(entry.summaryLower, normalizedQuery)
  const titleBoost = entry.titleLower.includes(normalizedQuery) ? 24 : 0
  return base + title * 3 + summary + titleBoost
}

export function searchCatalog(query: string, limit = 100): SearchResult {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0) {
    return { hits: [], totalMatches: 0 }
  }

  const found: SearchHit[] = []
  for (const entry of CATALOG) {
    const score = scoreEntry(entry, normalized)
    if (score > 0) {
      found.push({ entry, score })
    }
  }

  found.sort((left, right) => right.score - left.score)
  return { hits: found.slice(0, limit), totalMatches: found.length }
}
