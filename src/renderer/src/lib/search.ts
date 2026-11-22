import Fuse from 'fuse.js'
import type { ThreadSummary } from '../../../shared/types'

const FUSE_KEYS = [
  { name: 'subject', weight: 0.6 },
  { name: 'participants', weight: 0.3 },
  { name: 'snippet', weight: 0.1 }
]

export function hasGmailOperator(query: string): boolean {
  return /[a-zA-Z]+:/.test(query)
}

export function previewMatches(pooled: ThreadSummary[], query: string): ThreadSummary[] {
  return new Fuse(pooled, {
    keys: FUSE_KEYS,
    threshold: 0.4,
    ignoreLocation: true
  })
    .search(query)
    .map((r) => r.item)
}

export function rerankByFuse(threads: ThreadSummary[], query: string): ThreadSummary[] {
  if (threads.length === 0 || !query || hasGmailOperator(query)) return threads
  const fuse = new Fuse(threads, {
    keys: FUSE_KEYS,
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true
  })
  const results = fuse.search(query)
  if (results.length === 0) return threads
  const scoreById = new Map(results.map((r) => [r.item.id, r.score ?? 1]))
  return [...threads].sort((a, b) => (scoreById.get(a.id) ?? 2) - (scoreById.get(b.id) ?? 2))
}
