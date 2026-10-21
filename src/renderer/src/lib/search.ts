import Fuse from 'fuse.js'
import type { ThreadSummary } from '../../../shared/types'

const FUSE_KEYS = [
  { name: 'subject', weight: 0.6 },
  { name: 'participants', weight: 0.3 },
  { name: 'snippet', weight: 0.1 }
]

// Gmail operator queries (`from:`, `is:`...) are the server's job; the
// local Fuse instances here only answer free-text, so tokens shaped like
// `key:value` opt every local path out.
export function hasGmailOperator(query: string): boolean {
  return /[a-zA-Z]+:/.test(query)
}

// While typing (before the debounced commit fires), Fuse previews instant
// matches over already-loaded mail. Free, no API cost, and makes search
// feel instant while the server query is still debouncing.
export function previewMatches(pooled: ThreadSummary[], query: string): ThreadSummary[] {
  return new Fuse(pooled, {
    keys: FUSE_KEYS,
    threshold: 0.4,
    ignoreLocation: true
  })
    .search(query)
    .map((r) => r.item)
}

// The server result set reordered by Fuse relevance, or the input itself
// when Fuse would drop everything (its score is a tiebreak, not a filter).
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
