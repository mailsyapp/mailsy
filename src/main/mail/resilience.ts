// Gmail's per-user rate limit tolerates only a few parallel message fetches;
// more means 429s on page loads.
export const DETAIL_CONCURRENCY = 5

const QUOTA_MAX_RETRIES = 2

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isQuotaError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e)
  return /quota|rate.?limit|429|userRateLimitExceeded/i.test(message)
}

export function isNotFoundError(e: unknown): boolean {
  // 404 means the entity vanished mid-list (deleted elsewhere or raced by
  // another client), so one item is skippable.
  const code = (e as { code?: unknown })?.code
  if (code === 404) return true
  const message = e instanceof Error ? e.message : String(e)
  return /404|notfound|requested entity was not found/i.test(message)
}

import { invalidateStoredGrant } from '../auth'
import { SESSION_EXPIRED_ERROR } from '../../shared/types'

// Dead-grant recovery: kill the unusable stored token so isSignedIn() stops
// reporting signed-in across launches, then rethrow a clean sentence the
// renderer matches on. No-op for every other failure.
export function rethrowDeadGrant(e: unknown): void {
  if (!isInvalidGrant(e)) return
  invalidateStoredGrant()
  throw new Error(SESSION_EXPIRED_ERROR)
}

// Quota errors are transient: a fetch just over the per-minute line should
// wait and succeed rather than error the user.
export async function withQuotaRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (e) {
      rethrowDeadGrant(e)
      if (!isQuotaError(e) || attempt >= QUOTA_MAX_RETRIES) throw e
      await sleep(1000 * 2 ** attempt)
      attempt++
    }
  }
}

// Google answers the token refresh with invalid_grant when the stored grant
// was expired or revoked. gaxios carries the structured body, but the whole
// Error stack can be flattened on the way out (IPC, logging), so the
// message text is a fallback.
export function isInvalidGrant(e: unknown): boolean {
  const responseError = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
  if (responseError === 'invalid_grant') return true
  return e instanceof Error && /invalid_grant/.test(e.message)
}

// Settles ALL workers before returning so a sibling failure can't strand an
// in-flight result as an unhandled rejection.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  const errors: unknown[] = []
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      try {
        results[i] = await fn(items[i]!)
      } catch (e) {
        errors.push(e)
      }
    }
  })
  await Promise.all(workers)
  if (errors.length > 0) throw errors[0]
  return results
}
