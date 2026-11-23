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
  const code = (
    e as {
      code?: unknown
    }
  )?.code
  if (code === 404) return true
  const message = e instanceof Error ? e.message : String(e)
  return /404|notfound|requested entity was not found/i.test(message)
}
import { getMailSession, invalidateStoredGrant, isSignedIn } from '../auth'
import { SESSION_EXPIRED_ERROR } from '../../shared/types'
export function rethrowDeadGrant(e: unknown): void {
  if (!isInvalidGrant(e)) return
  invalidateStoredGrant()
  throw new Error(SESSION_EXPIRED_ERROR)
}
export async function withQuotaRetry<T>(
  fn: () => Promise<T>,
  session = getMailSession()
): Promise<T> {
  function assertCurrentSession(): void {
    if (getMailSession() !== session) {
      throw new Error(isSignedIn() ? 'Mail account changed' : 'Not signed in yet')
    }
  }
  let attempt = 0
  for (;;) {
    assertCurrentSession()
    try {
      return await fn()
    } catch (e) {
      assertCurrentSession()
      rethrowDeadGrant(e)
      if (!isQuotaError(e) || attempt >= QUOTA_MAX_RETRIES) throw e
      await sleep(1000 * 2 ** attempt)
      attempt++
    }
  }
}
export function isInvalidGrant(e: unknown): boolean {
  const responseError = (
    e as {
      response?: {
        data?: {
          error?: string
        }
      }
    }
  )?.response?.data?.error
  if (responseError === 'invalid_grant') return true
  return e instanceof Error && /invalid_grant/.test(e.message)
}
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
