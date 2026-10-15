import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import type { EmailSummary, EmailDetail as EmailDetailData, InboxPage } from '../../shared/types'
import { EmailDetail } from './components/EmailDetail'

const INBOX_PAGE_SIZE = 30
// Smaller pages for server search: each result costs a messages.get call,
// so a smaller page proportionally lowers the quota cost per keystroke.
const SEARCH_PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 800

function hasGmailOperator(query: string): boolean {
  return /[a-zA-Z]+:/.test(query)
}

function formatFetchError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  if (/quota|rate.?limit|429|userRateLimitExceeded/i.test(message)) {
    return 'Gmail rate limit hit — wait about a minute, then press Enter to retry your search.'
  }
  return message
}

function rerankWithFuse(emails: EmailSummary[], query: string): EmailSummary[] {
  if (emails.length === 0 || !query || hasGmailOperator(query)) return emails
  const fuse = new Fuse(emails, {
    keys: [
      { name: 'subject', weight: 0.6 },
      { name: 'from', weight: 0.3 },
      { name: 'snippet', weight: 0.1 }
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true
  })
  const results = fuse.search(query)
  if (results.length === 0) return emails
  const scoreById = new Map(results.map((r) => [r.item.id, r.score ?? 1]))
  return [...emails].sort((a, b) => (scoreById.get(a.id) ?? 2) - (scoreById.get(b.id) ?? 2))
}

function App(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [emails, setEmails] = useState<EmailSummary[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<EmailDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const sidebarRef = useRef<HTMLElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const requestIdRef = useRef(0)
  const lastFetchedQueryRef = useRef<string | null>(null)
  // Cache of server search first-pages: retyping/backspacing to a previous
  // query reuses it instead of spending quota again. Inbox ('') is never
  // cached so clearing the search always refreshes.
  const pageCacheRef = useRef(new Map<string, InboxPage>())
  // Last unfiltered inbox page, used as a Fuse fallback when the server
  // returns zero hits (e.g. typo that Gmail can't match).
  const [inboxCache, setInboxCache] = useState<EmailSummary[]>([])

  const hasMore = nextPageToken !== null
  const isSearchActive = committedQuery.length > 0
  const hasPendingInput = searchInput.trim() !== committedQuery

  const displayedEmails = useMemo(() => {
    // While typing (before the debounced commit fires), instantly preview
    // Fuse matches over already-loaded mail. Free, no API cost, and makes
    // search feel instant while the server query is still debouncing.
    const pending = searchInput.trim()
    if (
      hasPendingInput &&
      pending.length >= 2 &&
      !hasGmailOperator(pending) &&
      (emails.length > 0 || inboxCache.length > 0)
    ) {
      const seen = new Map<string, EmailSummary>()
      for (const e of [...emails, ...inboxCache]) if (!seen.has(e.id)) seen.set(e.id, e)
      const preview = new Fuse([...seen.values()], {
        keys: [
          { name: 'subject', weight: 0.6 },
          { name: 'from', weight: 0.3 },
          { name: 'snippet', weight: 0.1 }
        ],
        threshold: 0.4,
        ignoreLocation: true
      })
        .search(pending)
        .map((r) => r.item)
      if (preview.length > 0) return preview
    }
    if (!isSearchActive) return emails
    if (emails.length > 0) return rerankWithFuse(emails, committedQuery)
    // Server returned nothing: fuzzy-search the cached inbox so a typo
    // can still surface locally-loaded mail instead of a dead end.
    if (inboxCache.length > 0 && !hasGmailOperator(committedQuery)) {
      const fuse = new Fuse(inboxCache, {
        keys: [
          { name: 'subject', weight: 0.6 },
          { name: 'from', weight: 0.3 },
          { name: 'snippet', weight: 0.1 }
        ],
        threshold: 0.4,
        ignoreLocation: true
      })
      const fallback = fuse.search(committedQuery).map((r) => r.item)
      if (fallback.length > 0) return fallback
    }
    return emails
  }, [emails, committedQuery, isSearchActive, inboxCache, searchInput, hasPendingInput])

  const selectedEmail = displayedEmails.find((e) => e.id === selectedId) ?? null

  async function handleSelect(id: string): Promise<void> {
    setSelectedId(id)
    setDetail(null)
    setDetailLoading(true)
    setError(null)
    try {
      setDetail(await window.api.getMessage(id))
    } catch (e) {
      setError(formatFetchError(e))
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleSignIn(): Promise<void> {
    setError(null)
    try {
      await window.api.signIn()
      // The [committedQuery, signedIn] effect below loads the inbox;
      // fetching here too would double the quota cost.
      lastFetchedQueryRef.current = null
      setSignedIn(true)
    } catch (e) {
      setError(formatFetchError(e))
    }
  }

  function handleClearSearch(): void {
    setSearchInput('')
    if (committedQuery !== '') setCommittedQuery('')
  }

  function handleSearchSubmit(): void {
    // Enter commits immediately instead of waiting out the debounce.
    setCommittedQuery(searchInput.trim())
  }

  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingMore || searching || nextPageToken === null) return
    setLoadingMore(true)
    try {
      const page = await window.api.getInbox({
        maxResults: committedQuery ? SEARCH_PAGE_SIZE : INBOX_PAGE_SIZE,
        pageToken: nextPageToken ?? undefined,
        ...(committedQuery ? { q: committedQuery } : {})
      })
      setEmails((prev) => [...prev, ...page.emails])
      setNextPageToken(page.nextPageToken)
    } catch (e) {
      setError(formatFetchError(e))
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, searching, nextPageToken, committedQuery])

  useEffect(() => {
    const sentinel = sentinelRef.current
    const root = sidebarRef.current
    if (!sentinel || !root || nextPageToken === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { root, rootMargin: '400px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, nextPageToken])

  // Debounced as-you-type commit. Single characters never hit the API
  // (not worth a ~10-call query); clearing to empty still commits so the
  // inbox restores immediately.
  useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed.length === 1) return
    const timer = setTimeout(() => {
      setCommittedQuery(trimmed)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Single source for inbox/search fetching. Skips duplicate queries so
  // re-renders and the initial mount can't double-fire the same request,
  // and reuses cached search pages instead of spending quota again.
  useEffect(() => {
    if (signedIn !== true) return
    if (lastFetchedQueryRef.current === committedQuery && emails.length > 0) return
    const cached = committedQuery ? pageCacheRef.current.get(committedQuery) : undefined
    if (cached) {
      setEmails(cached.emails)
      setNextPageToken(cached.nextPageToken)
      lastFetchedQueryRef.current = committedQuery
      return
    }
    const requestId = ++requestIdRef.current
    setSearching(true)
    setError(null)
    setSelectedId(null)
    setDetail(null)
    window.api
      .getInbox({
        maxResults: committedQuery ? SEARCH_PAGE_SIZE : INBOX_PAGE_SIZE,
        ...(committedQuery ? { q: committedQuery } : {})
      })
      .then((page) => {
        if (requestIdRef.current !== requestId) return
        setEmails(page.emails)
        setNextPageToken(page.nextPageToken)
        if (!committedQuery) setInboxCache(page.emails)
        else {
          pageCacheRef.current.set(committedQuery, page)
          if (pageCacheRef.current.size > 20) {
            pageCacheRef.current.delete(pageCacheRef.current.keys().next().value!)
          }
        }
        lastFetchedQueryRef.current = committedQuery
      })
      .catch((e: unknown) => {
        if (requestIdRef.current !== requestId) return
        setError(formatFetchError(e))
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setSearching(false)
      })
    // `emails.length` is intentionally read, not depended on: depending on
    // it would refetch after every result arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedQuery, signedIn])

  useEffect(() => {
    let cancelled = false

    async function initialize(): Promise<void> {
      let isAuthenticated: boolean
      try {
        isAuthenticated = await window.api.isSignedIn()
      } catch (e) {
        if (!cancelled) {
          setError(formatFetchError(e))
        }
        return
      }

      if (cancelled) return
      // Inbox loading is handled by the search effect above; fetching here
      // too would cost a duplicate page (1 list + 30 gets) on every launch.
      setSignedIn(isAuthenticated)
    }

    void initialize()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app">
      <div className="actions">
        {signedIn === false && <button onClick={handleSignIn}>Sign in with Google</button>}
        {searching && emails.length === 0 && !isSearchActive && (
          <span role="status">Loading inbox...</span>
        )}
        {searching && isSearchActive && <span role="status">Searching…</span>}
      </div>

      {error && <p className="error">{error}</p>}

      <main className="mail-layout">
        <aside className="email-sidebar" aria-label="Inbox" ref={sidebarRef}>
          <form
            className="search-bar"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              handleSearchSubmit()
            }}
          >
            <input
              type="search"
              placeholder="Search emails…"
              aria-label="Search emails"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleClearSearch()
              }}
            />
            {searchInput && (
              <button type="button" onClick={handleClearSearch} aria-label="Clear search">
                Clear
              </button>
            )}
          </form>
          {isSearchActive && !searching && !hasPendingInput && (
            <p className="snippet" role="status">
              {displayedEmails.length > 0
                ? `${displayedEmails.length} result${displayedEmails.length === 1 ? '' : 's'} for “${committedQuery}”`
                : `No results for “${committedQuery}”`}
            </p>
          )}
          <ul className="emails">
            {displayedEmails.map((email) => (
              <li key={email.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(email.id)}
                  style={{ all: 'unset', display: 'block', cursor: 'pointer', width: '100%' }}
                >
                  <strong className="email-text">{email.subject}</strong>
                  <div className="from email-text">{email.from}</div>
                  <div className="snippet email-text">{email.snippet}</div>
                </button>
              </li>
            ))}
          </ul>
          {hasMore ? (
            <>
              <div ref={sentinelRef} aria-hidden="true" />
              {loadingMore ? (
                <p role="status">Loading more...</p>
              ) : (
                !searching && (
                  <button type="button" onClick={() => void loadMore()}>
                    Load more
                  </button>
                )
              )}
            </>
          ) : (
            displayedEmails.length > 0 &&
            !searching && (
              <p className="snippet">
                {isSearchActive ? 'End of results' : 'You’re all caught up'}
              </p>
            )
          )}
        </aside>

        <section className="email-content" aria-label="Email content">
          {selectedEmail ? (
            <EmailDetail
              key={selectedEmail.id}
              email={selectedEmail}
              detail={detail}
              detailLoading={detailLoading}
            />
          ) : (
            <p>Nothing open yet :P</p>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
