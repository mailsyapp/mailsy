import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import type {
  EmailSummary,
  EmailDetail as EmailDetailData,
  MailPage,
  MailFolder
} from '../../shared/types'
import { EmailDetail } from './components/EmailDetail'
import { DraftEditor } from './components/DraftEditor'
import { FolderRail } from './components/FolderRail'

const LIST_PAGE_SIZE = 30
// Smaller pages for server search: each result costs a messages.get call,
// so a smaller page proportionally lowers the quota cost per keystroke.
const SEARCH_PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 800
// How long "Message sent." stays visible before the spent draft row is
// removed from the list.
const DRAFT_PRUNE_DELAY_MS = 2000

const FOLDER_CONFIG: Record<
  MailFolder,
  { label: string; empty: string; fallbackToLocal: boolean }
> = {
  // fallbackToLocal: the folder's last unfiltered page may back the local
  // Fuse fallback when the server returns nothing. Inbox only, by design:
  // other folders must not surface messages from another folder's cache.
  inbox: { label: 'Inbox', empty: 'You’re all caught up', fallbackToLocal: true },
  drafts: { label: 'Drafts', empty: 'No drafts yet', fallbackToLocal: false },
  sent: { label: 'Sent', empty: 'No sent mail yet', fallbackToLocal: false },
  trash: { label: 'Trash', empty: 'Trash is empty', fallbackToLocal: false }
}

const FUSE_KEYS = [
  { name: 'subject', weight: 0.6 },
  { name: 'from', weight: 0.3 },
  { name: 'snippet', weight: 0.1 }
]

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
    keys: FUSE_KEYS,
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
  const [emails, setEmails] = useState<EmailSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [nextPageToken, setNextPageToken] = useState<string | null | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<EmailDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const [activeFolder, setActiveFolder] = useState<MailFolder>('inbox')

  const selectionRef = useRef<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const requestIdRef = useRef(0)
  // Last list actually on screen, so re-renders and the initial mount can't
  // double-fire the same request. Keyed by folder+query fields, not a string.
  const lastFetchedRef = useRef<{ folder: MailFolder; q: string } | null>(null)
  // Server search first-pages per folder: retyping/backspacing to a previous
  // query in the same folder reuses it instead of spending quota again.
  // Unfiltered ('') lists are never cached here so clearing the search
  // always refreshes.
  const searchPageCacheRef = useRef(new Map<MailFolder, Map<string, MailPage>>())
  // Last unfiltered page per folder, used by folder search fallbacks
  // (see FOLDER_CONFIG.fallbackToLocal).
  const [unfilteredByFolder, setUnfilteredByFolder] = useState(
    new Map<MailFolder, EmailSummary[]>()
  )
  // Draft rows removed shortly after sending: one timer per sent draft, so
  // removing A is never dropped because B was sent inside A's delay window.
  const draftPruneTimersRef = useRef(new Map<string, number>())

  const hasMore = nextPageToken !== null
  const isSearchActive = committedQuery.length > 0
  const hasPendingInput = searchInput.trim() !== committedQuery

  function openEmail(id: string): void {
    selectionRef.current = id
    setSelectedId(id)
  }

  function closeEmail(): void {
    selectionRef.current = null
    setSelectedId(null)
    setDetail(null)
  }

  const displayedEmails = useMemo(() => {
    const pending = searchInput.trim()
    const fallbackPool = unfilteredByFolder.get(activeFolder) ?? []
    const canFallbackLocally = FOLDER_CONFIG[activeFolder].fallbackToLocal

    // While typing (before the debounced commit fires), instantly preview
    // Fuse matches over already-loaded mail. Free, no API cost, and makes
    // search feel instant while the server query is still debouncing.
    if (
      hasPendingInput &&
      pending.length >= 2 &&
      !hasGmailOperator(pending) &&
      (emails.length > 0 || (canFallbackLocally && fallbackPool.length > 0))
    ) {
      const seen = new Map<string, EmailSummary>()
      for (const e of canFallbackLocally ? [...emails, ...fallbackPool] : emails) {
        if (!seen.has(e.id)) seen.set(e.id, e)
      }
      const preview = new Fuse([...seen.values()], {
        keys: FUSE_KEYS,
        threshold: 0.4,
        ignoreLocation: true
      })
        .search(pending)
        .map((r) => r.item)
      if (preview.length > 0) return preview
    }
    if (!isSearchActive) return emails
    if (emails.length > 0) return rerankWithFuse(emails, committedQuery)
    // Server returned nothing: fuzzy-search the folder's cached unfiltered
    // page so a typo can still surface locally-loaded mail instead of a
    // dead end (only where the folder config allows it).
    if (canFallbackLocally && fallbackPool.length > 0 && !hasGmailOperator(committedQuery)) {
      const fuse = new Fuse(fallbackPool, {
        keys: FUSE_KEYS,
        threshold: 0.4,
        ignoreLocation: true
      })
      const fallback = fuse.search(committedQuery).map((r) => r.item)
      if (fallback.length > 0) return fallback
    }
    return emails
  }, [
    emails,
    committedQuery,
    isSearchActive,
    unfilteredByFolder,
    searchInput,
    hasPendingInput,
    activeFolder
  ])

  const selectedEmail = displayedEmails.find((e) => e.id === selectedId) ?? null

  function handleSelect(id: string): void {
    openEmail(id)
    setDetail(null)
    setDetailLoading(true)
    setError(null)
    window.api
      .getMessage(id)
      .then(setDetail)
      .catch((e: unknown) => setError(formatFetchError(e)))
      .finally(() => setDetailLoading(false))
  }

  function handleSignIn(): void {
    setError(null)
    window.api
      .signIn()
      .then(() => {
        // The [committedQuery, signedIn] effect below loads the list;
        // fetching here too would double the quota cost.
        lastFetchedRef.current = null
        setSignedIn(true)
      })
      .catch((e: unknown) => setError(formatFetchError(e)))
  }

  function handleClearSearch(): void {
    setSearchInput('')
    if (committedQuery !== '') setCommittedQuery('')
  }

  function handleSearchSubmit(): void {
    // Enter commits immediately instead of waiting out the debounce.
    setCommittedQuery(searchInput.trim())
  }

  // Called by DraftEditor once a send succeeded. Removal is owned here
  // because App owns the list and never unmounts: one timer per sent draft
  // is exactly-once by construction, and pruning can't be lost to an
  // unmount of the editor.
  function handleDraftSent(id: string): void {
    if (draftPruneTimersRef.current.has(id)) return
    draftPruneTimersRef.current.set(
      id,
      window.setTimeout(() => {
        draftPruneTimersRef.current.delete(id)
        setEmails((prev) => prev.filter((e) => e.id !== id))
        // Retire the selection only if it's still this spent draft — a
        // newer selection made inside the delay window must survive.
        if (selectionRef.current === id) closeEmail()
      }, DRAFT_PRUNE_DELAY_MS)
    )
  }

  // Archive is a thread mutation while the list is one row per message, so
  // every row sharing the threadId is the archived conversation.
  function handleArchived(threadId: string): void {
    setEmails((prev) => prev.filter((e) => e.threadId !== threadId))
    closeEmail()
  }

  function handleFolderSelect(folder: MailFolder): void {
    if (folder === activeFolder) return
    setActiveFolder(folder)
    setSearchInput('')
    setCommittedQuery('')
    closeEmail()
    setError(null)
    // The list resets with the folder: a stale nextPageToken from the old
    // folder must never pair with the new folder's next-page fetch.
    setEmails([])
    setNextPageToken(undefined)
    lastFetchedRef.current = null
  }

  const loadMore = useCallback((): void => {
    if (loadingMore || searching || nextPageToken === null) return
    setLoadingMore(true)
    window.api
      .listFolder({
        maxResults: committedQuery ? SEARCH_PAGE_SIZE : LIST_PAGE_SIZE,
        pageToken: nextPageToken ?? undefined,
        folder: activeFolder,
        ...(committedQuery ? { q: committedQuery } : {})
      })
      .then((page) => {
        setEmails((prev) => [...prev, ...page.emails])
        setNextPageToken(page.nextPageToken)
      })
      .catch((e: unknown) => setError(formatFetchError(e)))
      .finally(() => setLoadingMore(false))
  }, [loadingMore, searching, nextPageToken, committedQuery, activeFolder])

  useEffect(() => {
    const sentinel = sentinelRef.current
    const root = sidebarRef.current
    if (!sentinel || !root || nextPageToken === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { root, rootMargin: '400px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, nextPageToken])

  // Debounced as-you-type commit. Single characters never hit the API
  // (not worth a ~10-call query); clearing to empty still commits so the
  // list restores immediately.
  useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed.length === 1) return
    const timer = setTimeout(() => {
      setCommittedQuery(trimmed)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Single source for list/search fetching. Skips duplicate queries so
  // re-renders and the initial mount can't double-fire the same request,
  // and reuses cached search pages instead of spending quota again.
  useEffect(() => {
    if (signedIn !== true) return
    if (
      lastFetchedRef.current &&
      lastFetchedRef.current.folder === activeFolder &&
      lastFetchedRef.current.q === committedQuery &&
      emails.length > 0
    ) {
      return
    }
    const cached = committedQuery
      ? searchPageCacheRef.current.get(activeFolder)?.get(committedQuery)
      : undefined
    if (cached) {
      setEmails(cached.emails)
      setNextPageToken(cached.nextPageToken)
      lastFetchedRef.current = { folder: activeFolder, q: committedQuery }
      return
    }
    const requestId = ++requestIdRef.current
    setSearching(true)
    setError(null)
    closeEmail()
    window.api
      .listFolder({
        maxResults: committedQuery ? SEARCH_PAGE_SIZE : LIST_PAGE_SIZE,
        folder: activeFolder,
        ...(committedQuery ? { q: committedQuery } : {})
      })
      .then((page) => {
        if (requestIdRef.current !== requestId) return
        setEmails(page.emails)
        setNextPageToken(page.nextPageToken)
        if (!committedQuery) {
          setUnfilteredByFolder((prev) => new Map(prev).set(activeFolder, page.emails))
        } else {
          const folderCache =
            searchPageCacheRef.current.get(activeFolder) ?? new Map<string, MailPage>()
          searchPageCacheRef.current.set(activeFolder, folderCache)
          folderCache.set(committedQuery, page)
          if (folderCache.size > 20) folderCache.delete(folderCache.keys().next().value!)
        }
        lastFetchedRef.current = { folder: activeFolder, q: committedQuery }
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
  }, [committedQuery, signedIn, activeFolder])

  useEffect(() => {
    let cancelled = false

    function initialize(): void {
      window.api
        .isSignedIn()
        .then((isAuthenticated) => {
          if (cancelled) return
          // List loading is handled by the search effect above; fetching
          // here too would cost a duplicate page (1 list + 30 gets) on
          // every launch.
          setSignedIn(isAuthenticated)
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(formatFetchError(e))
        })
    }

    initialize()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app">
      <div className="actions">
        {signedIn === false && <button onClick={handleSignIn}>Sign in with Google</button>}
        {searching && emails.length === 0 && !isSearchActive && <span role="status">Loading…</span>}
        {searching && isSearchActive && <span role="status">Searching…</span>}
      </div>

      {error && <p className="error">{error}</p>}

      <main className="mail-layout">
        <FolderRail activeFolder={activeFolder} onSelect={handleFolderSelect} />
        <aside
          className="email-sidebar"
          aria-label={FOLDER_CONFIG[activeFolder].label}
          ref={sidebarRef}
        >
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
                  <button type="button" onClick={loadMore}>
                    Load more
                  </button>
                )
              )}
            </>
          ) : (
            displayedEmails.length > 0 &&
            !searching && (
              <p className="snippet">
                {isSearchActive ? 'End of results' : FOLDER_CONFIG[activeFolder].empty}
              </p>
            )
          )}
        </aside>

        <section className="email-content" aria-label="Email content">
          {selectedEmail ? (
            activeFolder === 'drafts' ? (
              <DraftEditor
                key={selectedEmail.id}
                email={selectedEmail}
                detail={detail}
                detailLoading={detailLoading}
                onSent={handleDraftSent}
              />
            ) : (
              <EmailDetail
                key={selectedEmail.id}
                email={selectedEmail}
                detail={detail}
                detailLoading={detailLoading}
                folder={activeFolder}
                onArchived={handleArchived}
              />
            )
          ) : (
            <p>Nothing open yet :P</p>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
