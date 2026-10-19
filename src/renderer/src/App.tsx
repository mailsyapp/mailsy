import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import { HugeiconsIcon } from '@hugeicons/react'
import { StarIcon } from '@hugeicons/core-free-icons'
import type {
  ThreadSummary,
  EmailDetail as EmailDetailData,
  ThreadPage,
  MailFolder
} from '../../shared/types'
import { EmailDetail } from './components/EmailDetail'
import { senderNameOf } from './lib/format'
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
  trash: { label: 'Trash', empty: 'Trash is empty', fallbackToLocal: false },
  starred: { label: 'Starred', empty: 'No starred mail yet', fallbackToLocal: false }
}

const FUSE_KEYS = [
  { name: 'subject', weight: 0.6 },
  { name: 'participants', weight: 0.3 },
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

function rerankWithFuse(threads: ThreadSummary[], query: string): ThreadSummary[] {
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

function App(): React.JSX.Element {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [nextPageToken, setNextPageToken] = useState<string | null | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the drafts branch keeps a message fetch: the Draft editor needs the
  // one draft's body, while conversation rows render from getThread alone.
  const [draftDetail, setDraftDetail] = useState<EmailDetailData | null>(null)
  const [draftDetailLoading, setDraftDetailLoading] = useState(false)
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
  const searchPageCacheRef = useRef(new Map<MailFolder, Map<string, ThreadPage>>())
  // Last unfiltered page per folder, used by folder search fallbacks
  // (see FOLDER_CONFIG.fallbackToLocal).
  const [unfilteredByFolder, setUnfilteredByFolder] = useState(
    new Map<MailFolder, ThreadSummary[]>()
  )
  // Draft rows removed shortly after sending: one timer per sent draft, so
  // removing A is never dropped because B was sent inside A's delay window.
  const draftPruneTimersRef = useRef(new Map<string, number>())
  // Synchronous mirrors of the in-flight flags and next-page token. The
  // mounted IntersectionObserver can fire several times during the first
  // fetch, before any of those states have committed, so loadMore's guards
  // read these instead of render-scoped state.
  const loadingMoreRef = useRef(false)
  const searchingRef = useRef(false)
  const nextPageTokenRef = useRef<string | null | undefined>(undefined)

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
    setDraftDetail(null)
  }

  const displayedThreads = useMemo(() => {
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
      (threads.length > 0 || (canFallbackLocally && fallbackPool.length > 0))
    ) {
      const seen = new Map<string, ThreadSummary>()
      for (const e of canFallbackLocally ? [...threads, ...fallbackPool] : threads) {
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
    if (!isSearchActive) return threads
    if (threads.length > 0) return rerankWithFuse(threads, committedQuery)
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
    return threads
  }, [
    threads,
    committedQuery,
    isSearchActive,
    unfilteredByFolder,
    searchInput,
    hasPendingInput,
    activeFolder
  ])

  const selectedThread = displayedThreads.find((e) => e.id === selectedId) ?? null

  function handleSelect(row: ThreadSummary): void {
    openEmail(row.id)
    setDraftDetail(null)
    setError(null)
    // Conversation rows render from getThread inside EmailDetail; only the
    // drafts branch needs a message body fetch.
    if (activeFolder !== 'drafts') return
    setDraftDetailLoading(true)
    window.api
      .getMessage(row.messageIds[row.messageIds.length - 1])
      .then(setDraftDetail)
      .catch((e: unknown) => recordError(e))
      .finally(() => setDraftDetailLoading(false))
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
      .catch((e: unknown) => recordError(e))
  }

  function handleClearSearch(): void {
    setSearchInput('')
    if (committedQuery !== '') setCommittedQuery('')
  }

  // One funnel for every boundary failure. A dead Google grant (the main
  // process already dropped the token file) can never succeed by retrying,
  // so the only usable screen is the sign-in one: the list and its search
  // state reset with the same flip. Either boundary failure sentence can
  // arrive (the token may already be gone between two racing calls), so
  // both flip.
  function recordError(e: unknown): void {
    setError(formatFetchError(e))
    if (e instanceof Error && /session has expired|not signed in yet/i.test(e.message)) {
      setSignedIn(false)
      setCommittedQuery('')
      setSearchInput('')
      closeEmail()
      setThreads([])
      nextPageTokenRef.current = undefined
      setNextPageToken(undefined)
      searchingRef.current = false
      lastFetchedRef.current = null
    }
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
        setThreads((prev) => prev.filter((e) => e.id !== id))
        // Retire the selection only if it's still this spent draft — a
        // newer selection made inside the delay window must survive.
        if (selectionRef.current === id) closeEmail()
      }, DRAFT_PRUNE_DELAY_MS)
    )
  }

  // Archive and delete remove the thread: the row id is the thread id now,
  // so one row disappears per mutation instead of every matching message.
  function handleThreadRemoved(threadId: string): void {
    setThreads((prev) => prev.filter((e) => e.id !== threadId))
    closeEmail()
  }

  // Read/unread is thread-level: Gmail marks whole conversations, and
  // threads.modify on UNREAD does the same batch shape as archive above.
  // The row's unread count collapses to the whole thread or clears to zero.
  function handleThreadReadChanged(threadId: string, unread: boolean): void {
    setThreads((prev) =>
      prev.map((e) => {
        if (e.id !== threadId) return e
        const next = unread ? e.messageIds.length : 0
        return e.unreadCount === next ? e : { ...e, unreadCount: next }
      })
    )
  }

  function handleRowReadToggle(row: ThreadSummary): void {
    const unread = row.unreadCount > 0
    window.api
      .modifyLabels({
        kind: 'thread',
        id: row.id,
        ...(unread ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] })
      })
      .then(() => handleThreadReadChanged(row.id, !unread))
      .catch((e: unknown) => recordError(e))
  }

  // Star is thread-level like read/unread: threads.modify applies STARRED to
  // every message in the conversation.
  function handleThreadStarChanged(threadId: string, starred: boolean): void {
    // In the Starred folder an unstar removes the mail from this view, the
    // same way archive leaves the Inbox list.
    setThreads((prev) =>
      activeFolder === 'starred' && !starred
        ? prev.filter((e) => e.id !== threadId)
        : prev.map((e) => (e.id === threadId && e.starred !== starred ? { ...e, starred } : e))
    )
  }

  function handleRowStarToggle(row: ThreadSummary): void {
    window.api
      .modifyLabels({
        kind: 'thread',
        id: row.id,
        ...(row.starred ? { removeLabelIds: ['STARRED'] } : { addLabelIds: ['STARRED'] })
      })
      .then(() => handleThreadStarChanged(row.id, !row.starred))
      .catch((e: unknown) => recordError(e))
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
    setThreads([])
    nextPageTokenRef.current = undefined
    setNextPageToken(undefined)
    searchingRef.current = false
    lastFetchedRef.current = null
  }

  const loadMore = useCallback((): void => {
    // Guards read the synchronous refs: the observer can fire repeatedly
    // within one fetch's window, before the states it mirrors have
    // committed, and a stale false here appends duplicate pages.
    if (loadingMoreRef.current || searchingRef.current || nextPageTokenRef.current === null) return
    // Same request guard as the list effect below: a slower overlapping
    // response must never write after a response a later request superseded.
    const requestId = ++requestIdRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    window.api
      .listFolder({
        maxResults: committedQuery ? SEARCH_PAGE_SIZE : LIST_PAGE_SIZE,
        pageToken: nextPageTokenRef.current ?? undefined,
        folder: activeFolder,
        ...(committedQuery ? { q: committedQuery } : {})
      })
      .then((page) => {
        if (requestIdRef.current !== requestId) return
        setThreads((prev) => [...prev, ...page.threads])
        nextPageTokenRef.current = page.nextPageToken
        setNextPageToken(page.nextPageToken)
      })
      .catch((e: unknown) => recordError(e))
      .finally(() => {
        loadingMoreRef.current = false
        setLoadingMore(false)
      })
    // recordError is render-scoped like the neighbouring handlers it calls;
    // nothing it closes over changes this callback's behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedQuery, activeFolder])

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
      threads.length > 0
    ) {
      return
    }
    const cached = committedQuery
      ? searchPageCacheRef.current.get(activeFolder)?.get(committedQuery)
      : undefined
    if (cached) {
      setThreads(cached.threads)
      nextPageTokenRef.current = cached.nextPageToken
      setNextPageToken(cached.nextPageToken)
      lastFetchedRef.current = { folder: activeFolder, q: committedQuery }
      return
    }
    const requestId = ++requestIdRef.current
    searchingRef.current = true
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
        setThreads(page.threads)
        nextPageTokenRef.current = page.nextPageToken
        setNextPageToken(page.nextPageToken)
        if (!committedQuery) {
          setUnfilteredByFolder((prev) => new Map(prev).set(activeFolder, page.threads))
        } else {
          const folderCache =
            searchPageCacheRef.current.get(activeFolder) ?? new Map<string, ThreadPage>()
          searchPageCacheRef.current.set(activeFolder, folderCache)
          folderCache.set(committedQuery, page)
          if (folderCache.size > 20) folderCache.delete(folderCache.keys().next().value!)
        }
        lastFetchedRef.current = { folder: activeFolder, q: committedQuery }
      })
      .catch((e: unknown) => {
        if (requestIdRef.current !== requestId) return
        recordError(e)
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          searchingRef.current = false
          setSearching(false)
        }
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
          if (!cancelled) recordError(e)
        })
    }

    initialize()
    return () => {
      cancelled = true
    }
    // recordError is render-scoped and stable in behavior; mount-once stays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="app">
      <div className="actions">
        {signedIn === false && <button onClick={handleSignIn}>Sign in with Google</button>}
        {searching && threads.length === 0 && !isSearchActive && (
          <span role="status">Loading…</span>
        )}
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
              {displayedThreads.length > 0
                ? `${displayedThreads.length} result${displayedThreads.length === 1 ? '' : 's'} for “${committedQuery}”`
                : `No results for “${committedQuery}”`}
            </p>
          )}
          <ul className="emails">
            {displayedThreads.map((row) => (
              <li key={row.id} className={row.unreadCount > 0 ? 'unread' : undefined}>
                <button
                  type="button"
                  onClick={() => handleSelect(row)}
                  style={{ all: 'unset', display: 'block', cursor: 'pointer', width: '100%' }}
                >
                  <strong className="email-text">
                    {row.subject}
                    {row.unreadCount > 1 ? ` (${row.unreadCount})` : ''}
                  </strong>
                  {/* Sender names for the whole conversation, like Gmail's
                      participant summary on thread rows. */}
                  <div className="from email-text">
                    {row.participants.map(senderNameOf).join(', ')}
                  </div>
                  <div className="snippet email-text">{row.snippet}</div>
                </button>
                {activeFolder !== 'drafts' && (
                  <>
                    <button type="button" onClick={() => handleRowReadToggle(row)}>
                      {row.unreadCount > 0 ? 'mark read' : 'mark unread'}
                    </button>
                    <button
                      type="button"
                      className={`star-toggle${row.starred ? ' starred' : ''}`}
                      onClick={() => handleRowStarToggle(row)}
                      title={row.starred ? 'Unstar' : 'Star'}
                      aria-label={row.starred ? 'Unstar' : 'Star'}
                      aria-pressed={row.starred}
                    >
                      {/* The star glyph is a closed contour drawn unfilled by
                          the icon set; filling it with the row's gold when
                          starred is the whole state read. */}
                      <HugeiconsIcon
                        icon={StarIcon}
                        size={18}
                        strokeWidth={1.8}
                        fill={row.starred ? 'currentColor' : 'none'}
                      />
                    </button>
                  </>
                )}
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
            displayedThreads.length > 0 &&
            !searching && (
              <p className="snippet">
                {isSearchActive ? 'End of results' : FOLDER_CONFIG[activeFolder].empty}
              </p>
            )
          )}
        </aside>

        <section className="email-content" aria-label="Email content">
          {selectedThread ? (
            activeFolder === 'drafts' ? (
              <DraftEditor
                key={selectedThread.id}
                row={selectedThread}
                detail={draftDetail}
                detailLoading={draftDetailLoading}
                onSent={handleDraftSent}
              />
            ) : (
              <EmailDetail
                key={selectedThread.id}
                thread={selectedThread}
                folder={activeFolder}
                onThreadRemoved={handleThreadRemoved}
                onThreadReadChanged={handleThreadReadChanged}
                onThreadStarChanged={handleThreadStarChanged}
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
