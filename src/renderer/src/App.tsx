import { useMemo, useRef, useState } from 'react'
import { errorMessage } from './lib/format'
import { RefreshCw } from 'lucide-react'
import type {
  ThreadSummary,
  EmailDetail as EmailDetailData,
  ThreadPage,
  MailFolder,
  MailLabel
} from '../../shared/types'
import { EmailDetail } from './components/EmailDetail'
import { applyMailDelta, mergeIncoming, viewLabelOf } from './lib/syncApply'
import { hasGmailOperator, previewMatches, rerankByFuse } from './lib/search'
import { FOLDER_CONFIG } from './lib/folderViews'
import type { SyncResult } from '../../shared/sync'
import { DraftEditor } from './components/DraftEditor'
import { ComposeEditor } from './components/ComposeEditor'
import { FolderRail } from './components/FolderRail'
import { MailListRow } from './components/MailListRow'
import { OAuthCredentialsSetup } from './components/OAuthCredentialsSetup'
import { useIntersection } from './hooks/useIntersection'
import { useInterval } from './hooks/useInterval'
import { useLatest } from './hooks/useLatest'
import { useOnMount } from './hooks/useOnMount'
import { useReaction } from './hooks/useReaction'
import { useSettledValue } from './hooks/useSettledValue'
import { useSubscription } from './hooks/useSubscription'
import { useTimers } from './hooks/useTimers'

const LIST_PAGE_SIZE = 30
const SEARCH_PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 800
const DRAFT_PRUNE_DELAY_MS = 2000
const SNOOZE_TICK_MS = 30_000

function formatFetchError(e: unknown): string {
  const message = errorMessage(e)
  if (/quota|rate.?limit|429|userRateLimitExceeded/i.test(message)) {
    return 'Gmail rate limit hit — wait about a minute, then press Enter to retry your search.'
  }
  return message
}

type FirstPageMode = 'load' | 'manual' | 'sync'

function App(): React.JSX.Element {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [nextPageToken, setNextPageToken] = useState<string | null | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftDetail, setDraftDetail] = useState<EmailDetailData | null>(null)
  const [draftDetailLoading, setDraftDetailLoading] = useState(false)
  const [selectedIsDraft, setSelectedIsDraft] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const [activeFolder, setActiveFolder] = useState<MailFolder>('inbox')
  const [activeLabel, setActiveLabel] = useState<MailLabel | null>(null)
  const [labels, setLabels] = useState<MailLabel[]>([])
  const [composing, setComposing] = useState(false)
  const [draftDiscard, setDraftDiscard] = useState<{ rowId: string; error: string | null } | null>(
    null
  )

  const selectionRef = useRef<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const requestIdRef = useRef(0)
  const lastFetchedRef = useRef<{ folder: MailFolder; labelId: string | null; q: string } | null>(
    null
  )
  const searchPageCacheRef = useRef(new Map<string, Map<string, ThreadPage>>())
  const [unfilteredByFolder, setUnfilteredByFolder] = useState(
    new Map<MailFolder, ThreadSummary[]>()
  )
  const draftPruneTimers = useTimers()
  const loadingMoreRef = useRef(false)
  const searchingRef = useRef(false)
  const nextPageTokenRef = useRef<string | null | undefined>(undefined)

  function setPageToken(token: string | null | undefined): void {
    nextPageTokenRef.current = token
    setNextPageToken(token)
  }

  function setActiveSearching(active: boolean): void {
    searchingRef.current = active
    setSearching(active)
  }

  function setQuietSearching(active: boolean): void {
    searchingRef.current = active
  }

  const viewKey = activeLabel ? `label:${activeLabel.id}` : activeFolder

  function storeFirstPage(page: ThreadPage, query: string): void {
    lastFetchedRef.current = { folder: activeFolder, labelId: activeLabel?.id ?? null, q: query }
    if (!query) {
      if (!activeLabel)
        setUnfilteredByFolder((prev) => new Map(prev).set(activeFolder, page.threads))
      return
    }
    const viewCache = searchPageCacheRef.current.get(viewKey) ?? new Map<string, ThreadPage>()
    searchPageCacheRef.current.set(viewKey, viewCache)
    viewCache.set(query, page)
    if (viewCache.size > 20) viewCache.delete(viewCache.keys().next().value!)
  }

  const hasMore = nextPageToken !== null
  const isSearchActive = committedQuery.length > 0
  const hasPendingInput = searchInput.trim() !== committedQuery

  function openEmail(id: string): void {
    selectionRef.current = id
    setSelectedId(id)
  }

  function openCompose(): void {
    if (composing) return
    closeEmail()
    setComposing(true)
  }

  function closeEmail(): void {
    selectionRef.current = null
    setSelectedId(null)
    setDraftDetail(null)
    setComposing(false)
    setSelectedIsDraft(false)
    setDraftDiscard(null)
  }

  const displayedThreads = useMemo(() => {
    const pending = searchInput.trim()
    const fallbackPool = unfilteredByFolder.get(activeFolder) ?? []
    const canFallbackLocally = FOLDER_CONFIG[activeFolder].fallbackToLocal

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
      const preview = previewMatches([...seen.values()], pending)
      if (preview.length > 0) return preview
    }
    if (!isSearchActive) return threads
    if (threads.length > 0) return rerankByFuse(threads, committedQuery)
    if (canFallbackLocally && fallbackPool.length > 0 && !hasGmailOperator(committedQuery)) {
      const fallback = previewMatches(fallbackPool, committedQuery)
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
    closeEmail()
    openEmail(row.id)
    setError(null)
    const draftsFolder = activeFolder === 'drafts'
    const draftHere = draftsFolder || (activeFolder === 'all' && row.hasDraft === true)
    setSelectedIsDraft(draftHere)
    if (!draftHere) return
    setDraftDetailLoading(true)
    window.api
      .getMessage(row.messageIds[row.messageIds.length - 1])
      .then(setDraftDetail)
      .catch((e: unknown) => recordError(e))
      .finally(() => setDraftDetailLoading(false))
  }

  const [showCredentialsSetup, setShowCredentialsSetup] = useState(false)

  async function completeSignIn(): Promise<void> {
    await window.api.signIn()
    lastFetchedRef.current = null
    setShowCredentialsSetup(false)
    setSignedIn(true)
  }

  function handleSignIn(): void {
    setError(null)
    completeSignIn().catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e)
      if (/OAuth credentials are missing/i.test(message)) setShowCredentialsSetup(true)
      else recordError(e)
    })
  }

  function handleSignOut(): void {
    window.api
      .signOut()
      .then(() => {
        setError(null)
        exitToSignedOut()
      })
      .catch((e: unknown) => recordError(e))
  }

  function handleClearSearch(): void {
    setSearchInput('')
    if (committedQuery !== '') setCommittedQuery('')
  }

  function exitToSignedOut(): void {
    ++requestIdRef.current
    setSignedIn(false)
    setCommittedQuery('')
    setSearchInput('')
    closeEmail()
    setThreads([])
    setActiveLabel(null)
    setLabels([])
    searchPageCacheRef.current.clear()
    draftPruneTimers.cancelAll()
    setUnfilteredByFolder(new Map<MailFolder, ThreadSummary[]>())
    setPageToken(null)
    setActiveSearching(false)
    lastFetchedRef.current = null
  }

  function recordError(e: unknown): void {
    setError(formatFetchError(e))
    if (isDeadGrantError(e)) {
      exitToSignedOut()
    }
  }

  function isDeadGrantError(e: unknown): boolean {
    return e instanceof Error && /session has expired|not signed in yet/i.test(e.message)
  }

  function handleSearchSubmit(): void {
    setCommittedQuery(searchInput.trim())
  }

  function handleDraftSent(id: string): void {
    if (draftPruneTimers.isPending(id)) return
    draftPruneTimers.start(id, DRAFT_PRUNE_DELAY_MS, () => {
      setThreads((prev) => prev.filter((e) => e.id !== id))
      if (selectionRef.current === id) closeEmail()
    })
  }

  function handleDraftDiscard(row: ThreadSummary): void {
    const confirmed = window.confirm(
      `Delete draft “${row.subject || '(no subject)'}”? This permanently discards it; not even Trash keeps a copy.`
    )
    if (!confirmed) return
    if (!row.draftId) return
    setDraftDiscard({ rowId: row.id, error: null })
    window.api
      .discardDraft(row.draftId)
      .then(() => {
        setDraftDiscard(null)
        handleThreadRemoved(row.id)
      })
      .catch((e: unknown) => {
        setDraftDiscard({ rowId: row.id, error: errorMessage(e) })
        recordError(e)
      })
  }

  function handleThreadRemoved(threadId: string): void {
    setThreads((prev) => prev.filter((e) => e.id !== threadId))
    if (selectionRef.current === threadId) closeEmail()
  }

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

  function handleRowNotSpam(row: ThreadSummary): void {
    window.api
      .modifyLabels({
        kind: 'thread',
        id: row.id,
        addLabelIds: ['INBOX'],
        removeLabelIds: ['SPAM']
      })
      .then(() => handleThreadRemoved(row.id))
      .catch((e: unknown) => recordError(e))
  }

  function handleRowUnsnooze(row: ThreadSummary): void {
    const write = row.snoozedByMailsy
      ? window.api.restoreThread(row.id)
      : window.api.modifyLabels({ kind: 'thread', id: row.id, addLabelIds: ['INBOX'] })
    write.then(() => handleThreadRemoved(row.id)).catch((e: unknown) => recordError(e))
  }

  function handleThreadStarChanged(threadId: string, starred: boolean): void {
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

  function refreshLabels(): void {
    window.api
      .listLabels()
      .then((labelList) => setLabels(labelList.filter((label) => label.type === 'user')))
      .catch((e: unknown) => recordError(e))
  }

  useReaction([signedIn], () => {
    if (signedIn === true) refreshLabels()
  })

  function handleLabelSelect(label: MailLabel): void {
    if (activeLabel?.id === label.id) return
    setActiveLabel(label)
    setActiveFolder('label')
    setSearchInput('')
    setCommittedQuery('')
    closeEmail()
    setError(null)
    setThreads([])
    setPageToken(undefined)
    setActiveSearching(false)
    lastFetchedRef.current = null
  }

  function handleCreateLabel(name: string): void {
    window.api
      .createUserLabel(name)
      .then(() => {
        setError(null)
        refreshLabels()
      })
      .catch((e: unknown) => recordError(e))
  }

  function handleDeleteLabel(label: MailLabel): void {
    const confirmed = window.confirm(
      `Delete label “${label.name}”? Mail keeps every other label; the label is removed from every thread.`
    )
    if (!confirmed) return
    window.api
      .deleteUserLabel(label.id)
      .then(() => {
        setError(null)
        searchPageCacheRef.current.delete(`label:${label.id}`)
        refreshLabels()
        if (activeLabel?.id === label.id) handleFolderSelect('inbox')
      })
      .catch((e: unknown) => recordError(e))
  }

  function handleThreadLabelChanged(threadId: string, labelId: string, applied: boolean): void {
    refreshLabels()
    if (activeLabel && !applied && activeLabel.id === labelId) {
      setThreads((prev) => prev.filter((row) => row.id !== threadId))
    }
  }

  function handleFolderSelect(folder: MailFolder): void {
    if (folder === activeFolder && activeLabel === null) return
    setActiveFolder(folder)
    setActiveLabel(null)
    setSearchInput('')
    setCommittedQuery('')
    closeEmail()
    setError(null)
    setThreads([])
    setPageToken(undefined)
    setActiveSearching(false)
    lastFetchedRef.current = null
  }

  function loadMore(): void {
    if (loadingMoreRef.current || searchingRef.current || nextPageTokenRef.current === null) return
    const requestId = ++requestIdRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    window.api
      .listFolder({
        maxResults: committedQuery ? SEARCH_PAGE_SIZE : LIST_PAGE_SIZE,
        pageToken: nextPageTokenRef.current ?? undefined,
        folder: activeFolder,
        ...(activeLabel ? { userLabelId: activeLabel.id } : {}),
        ...(committedQuery ? { q: committedQuery } : {})
      })
      .then((page) => {
        if (requestIdRef.current !== requestId) return
        setThreads((prev) => {
          const seen = new Set(prev.map((row) => row.id))
          return [...prev, ...page.threads.filter((row) => !seen.has(row.id))]
        })
        setPageToken(page.nextPageToken)
      })
      .catch((e: unknown) => recordError(e))
      .finally(() => {
        loadingMoreRef.current = false
        setLoadingMore(false)
      })
  }

  function loadFirstPage(mode: FirstPageMode): void {
    if (mode === 'sync' && (searchingRef.current || loadingMoreRef.current)) return
    const requestId = ++requestIdRef.current
    if (mode === 'sync') {
      setQuietSearching(true)
    } else {
      setActiveSearching(true)
    }
    if (mode !== 'sync') setError(null)
    if (mode === 'load') closeEmail()
    window.api
      .listFolder({
        maxResults: committedQuery ? SEARCH_PAGE_SIZE : LIST_PAGE_SIZE,
        folder: activeFolder,
        ...(activeLabel ? { userLabelId: activeLabel.id } : {}),
        ...(committedQuery ? { q: committedQuery } : {})
      })
      .then((page) => {
        if (requestIdRef.current !== requestId) return
        setThreads((prev) =>
          mode === 'load'
            ? page.threads
            : mergeIncoming(prev, page.threads, mode === 'sync', selectionRef.current)
        )
        if (mode === 'load' || nextPageTokenRef.current === undefined) {
          setPageToken(page.nextPageToken)
        }
        storeFirstPage(page, committedQuery)
      })
      .catch((e: unknown) => {
        if (requestIdRef.current !== requestId) return
        if (mode === 'sync') {
          if (isDeadGrantError(e)) exitToSignedOut()
          return
        }
        recordError(e)
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setActiveSearching(false)
        }
      })
  }

  const signedInRef = useLatest(signedIn)

  function handleSyncResult(result: SyncResult): void {
    if (signedInRef.current !== true) return
    if (result.kind === 'reset') {
      loadFirstPage('sync')
      return
    }
    const viewLabel = viewLabelOf(activeFolder, activeLabel?.id ?? null)
    if (viewLabel === null) {
      if (result.threads.length > 0 || result.deletedThreadIds.length > 0) loadFirstPage('sync')
      return
    }
    setThreads(
      (prev) =>
        applyMailDelta(prev, result, {
          labelId: viewLabel,
          isSearchActive: committedQuery.length > 0
        }) ?? prev
    )
  }

  const syncResultHandlerRef = useLatest(handleSyncResult)

  useSubscription(signedIn === true, () =>
    window.api.onSyncResult((result: SyncResult) => syncResultHandlerRef.current(result))
  )

  const [syncing, setSyncing] = useState(false)
  const syncingRef = useRef(false)

  function handleRefresh(): void {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    window.api
      .syncMail('button')
      .then(handleSyncResult)
      .catch((e: unknown) => recordError(e))
      .finally(() => {
        syncingRef.current = false
        setSyncing(false)
      })
  }

  useInterval(
    signedIn === true,
    SNOOZE_TICK_MS,
    () => {
      window.api
        .snoozeTick()
        .then((restored) => {
          if (restored > 0) loadFirstPage('manual')
        })
        .catch(() => undefined)
    },
    { immediate: true }
  )

  useIntersection({
    target: sentinelRef,
    root: sidebarRef,
    rootMargin: '400px',
    armKey: nextPageToken === null ? null : `${viewKey}\n${committedQuery}\n${nextPageToken ?? ''}`,
    onIntersect: loadMore
  })

  useSettledValue(searchInput.trim(), SEARCH_DEBOUNCE_MS, (settled) => {
    if (settled.length !== 1) setCommittedQuery(settled)
  })

  useReaction([committedQuery, signedIn, activeFolder, activeLabel], () => {
    if (signedIn !== true) return
    if (
      lastFetchedRef.current &&
      lastFetchedRef.current.folder === activeFolder &&
      lastFetchedRef.current.labelId === (activeLabel?.id ?? null) &&
      lastFetchedRef.current.q === committedQuery &&
      threads.length > 0
    ) {
      return
    }
    const cached = committedQuery
      ? searchPageCacheRef.current.get(viewKey)?.get(committedQuery)
      : undefined
    if (cached) {
      setThreads(cached.threads)
      setPageToken(cached.nextPageToken)
      lastFetchedRef.current = {
        folder: activeFolder,
        labelId: activeLabel?.id ?? null,
        q: committedQuery
      }
      return
    }
    loadFirstPage('load')
  })

  useOnMount((isMounted) => {
    window.api
      .isSignedIn()
      .then((isAuthenticated) => {
        if (isMounted()) setSignedIn(isAuthenticated)
      })
      .catch((e: unknown) => {
        if (isMounted()) recordError(e)
      })
  })

  if (showCredentialsSetup) {
    return (
      <div className="app">
        <OAuthCredentialsSetup
          onSubmit={async (credentials) => {
            await window.api.saveOAuthCredentials(credentials)
            await completeSignIn()
          }}
          onCancel={() => setShowCredentialsSetup(false)}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="actions">
        {signedIn === false && <button onClick={handleSignIn}>Sign in with Google</button>}
        {signedIn === true && (
          <>
            <button type="button" onClick={openCompose}>
              Compose
            </button>
            <button
              type="button"
              className={syncing ? 'refresh-button syncing' : 'refresh-button'}
              aria-busy={syncing}
              onClick={() => handleRefresh()}
              aria-label="Refresh mail"
            >
              <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
              Refresh
            </button>
            <button onClick={handleSignOut}>Sign out</button>
          </>
        )}
        {searching && threads.length === 0 && !isSearchActive && (
          <span role="status">Loading…</span>
        )}
        {searching && isSearchActive && <span role="status">Searching…</span>}
      </div>

      {error && <p className="error">{error}</p>}

      <main className="mail-layout">
        <FolderRail
          activeFolder={activeFolder}
          activeLabelId={activeLabel?.id ?? null}
          labels={labels}
          onSelect={handleFolderSelect}
          onSelectLabel={handleLabelSelect}
          onCreateLabel={handleCreateLabel}
          onDeleteLabel={handleDeleteLabel}
        />
        <aside
          className="email-sidebar"
          aria-label={activeLabel ? activeLabel.name : FOLDER_CONFIG[activeFolder].label}
          ref={sidebarRef}
        >
          {activeLabel && (
            <div className="user-label-heading">
              <h2>{activeLabel.name}</h2>
              <button
                type="button"
                aria-label={`Delete ${activeLabel.name}`}
                onClick={() => handleDeleteLabel(activeLabel)}
              >
                delete label
              </button>
            </div>
          )}
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
              <MailListRow
                key={row.id}
                row={row}
                folder={activeFolder}
                onOpen={handleSelect}
                onReadToggle={handleRowReadToggle}
                onStarToggle={handleRowStarToggle}
                onNotSpam={handleRowNotSpam}
                onUnsnooze={handleRowUnsnooze}
                onDeleteDraft={handleDraftDiscard}
              />
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
            !searching &&
            (isSearchActive ? displayedThreads.length > 0 : displayedThreads.length === 0) && (
              <p className="snippet">
                {isSearchActive ? 'End of results' : FOLDER_CONFIG[activeFolder].empty}
              </p>
            )
          )}
        </aside>

        <section className="email-content" aria-label="Email content">
          {composing ? (
            <ComposeEditor onClose={closeEmail} />
          ) : selectedThread ? (
            selectedIsDraft ? (
              <DraftEditor
                key={selectedThread.id}
                row={selectedThread}
                detail={draftDetail}
                detailLoading={draftDetailLoading}
                onSent={handleDraftSent}
                onDraftDiscard={() => handleDraftDiscard(selectedThread)}
                discardError={
                  draftDiscard && draftDiscard.rowId === selectedThread.id
                    ? draftDiscard.error
                    : null
                }
              />
            ) : (
              <EmailDetail
                key={selectedThread.id}
                thread={selectedThread}
                folder={activeFolder}
                labels={labels}
                onThreadRemoved={handleThreadRemoved}
                onThreadReadChanged={handleThreadReadChanged}
                onThreadStarChanged={handleThreadStarChanged}
                onThreadLabelChanged={handleThreadLabelChanged}
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
