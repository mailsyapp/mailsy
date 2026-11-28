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
import { applyMailDelta, listRowKey, mergeIncoming, viewLabelOf } from './lib/syncApply'
import { hasGmailOperator, previewMatches, rerankByFuse } from './lib/search'
import { FOLDER_CONFIG } from './lib/folderViews'
import type { SyncResult } from '../../shared/sync'
import { DraftEditor } from './components/DraftEditor'
import { ComposeEditor } from './components/ComposeEditor'
import { FolderRail } from './components/FolderRail'
import { MailListRow } from './components/MailListRow'
import { OAuthCredentialsSetup } from './components/OAuthCredentialsSetup'
import { LeftSendNotices } from './components/UndoSendNotice'
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
const SNOOZE_TICK_MS = 30000
function formatFetchError(e: unknown): string {
  const message = errorMessage(e)
  if (/quota|rate.?limit|429|userRateLimitExceeded/i.test(message)) {
    return 'Gmail rate limit hit — wait about a minute, then press Enter to retry your search.'
  }
  return message
}
type QuietFold = 'sync' | 'reset' | 'recheck'
type FirstPageMode = 'load' | 'wake' | QuietFold
function App(): React.JSX.Element {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [opened, setOpened] = useState<{
    row: ThreadSummary
    query: string
  } | null>(null)
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
  const [draftDiscard, setDraftDiscard] = useState<{
    rowKey: string
    error: string | null
  } | null>(null)
  const selectionRef = useRef<string | null>(null)
  const sessionAbortRef = useRef(new AbortController())
  const reopenDraftRef = useRef<string | null>(null)
  const selectedDraftRef = useRef<{
    key: string
    id: string
    threadId: string
  } | null>(null)
  const selectedSnoozedByMailsyRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const requestIdRef = useRef(0)
  const lastFetchedRef = useRef<{
    folder: MailFolder
    labelId: string | null
    q: string
  } | null>(null)
  const searchPageCacheRef = useRef(new Map<string, Map<string, ThreadPage>>())
  const [unfilteredByFolder, setUnfilteredByFolder] = useState(
    new Map<MailFolder, ThreadSummary[]>()
  )
  const draftPruneTimers = useTimers()
  const pageRequestRef = useRef<number | null>(null)
  const searchingRef = useRef(false)
  const pendingSyncRef = useRef<QuietFold | null>(null)
  const nextPageTokenRef = useRef<string | null | undefined>(undefined)
  const loadedPagesRef = useRef(0)
  const invalidCursorRef = useRef<symbol | null>(null)
  const listedThreadsRef = useLatest(threads)
  const refreshRequestRef = useRef<symbol | null>(null)
  const [syncing, setSyncing] = useState(false)
  function replaceListRequest(): number {
    if (pageRequestRef.current !== null) {
      pageRequestRef.current = null
      setLoadingMore(false)
    }
    return ++requestIdRef.current
  }
  function setPageToken(token: string | null | undefined, loadedPages = 0): void {
    nextPageTokenRef.current = token
    loadedPagesRef.current = loadedPages
    invalidCursorRef.current = null
    setNextPageToken(token)
  }
  function invalidatePageCursor(): void {
    invalidCursorRef.current = Symbol()
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
  const selectedKey = opened ? listRowKey(opened.row) : null
  function openCompose(): void {
    if (composing) return
    closeEmail()
    setComposing(true)
  }
  function closeEmail(): void {
    selectionRef.current = null
    selectedDraftRef.current = null
    setOpened(null)
    selectedSnoozedByMailsyRef.current = false
    setDraftDetail(null)
    setDraftDetailLoading(false)
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
        const key = listRowKey(e)
        if (!seen.has(key)) seen.set(key, e)
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
  const cachedSearchPage = isSearchActive
    ? searchPageCacheRef.current.get(viewKey)?.get(committedQuery)
    : undefined
  const selectionRows =
    opened?.query !== committedQuery && cachedSearchPage
      ? cachedSearchPage.threads
      : displayedThreads
  const selectedThread =
    selectionRows.find((e) => listRowKey(e) === selectedKey) ??
    (isSearchActive && opened?.query === committedQuery && (!selectedIsDraft || opened.row.draftId)
      ? opened.row
      : null)
  function handleSelect(row: ThreadSummary): void {
    closeEmail()
    const rowKey = listRowKey(row)
    selectionRef.current = rowKey
    setOpened({ row, query: committedQuery })
    selectedSnoozedByMailsyRef.current = row.snoozedByMailsy === true
    setError(null)
    const draftsFolder = activeFolder === 'drafts'
    const draftHere = draftsFolder || (activeFolder === 'all' && row.hasDraft === true)
    setSelectedIsDraft(draftHere)
    if (!draftHere) return
    const draft = row.draftId ? { key: rowKey, id: row.draftId, threadId: row.id } : null
    selectedDraftRef.current = draft
    const stillSelected = (): boolean =>
      selectionRef.current === rowKey && selectedDraftRef.current === draft
    setDraftDetailLoading(true)
    window.api
      .getMessage(row.messageIds[row.messageIds.length - 1], row.draftId)
      .then((detail) => {
        if (stillSelected()) setDraftDetail(detail)
      })
      .catch((e: unknown) => {
        if (stillSelected()) recordError(e)
      })
      .finally(() => {
        if (stillSelected()) setDraftDetailLoading(false)
      })
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
    sessionAbortRef.current.abort()
    sessionAbortRef.current = new AbortController()
    replaceListRequest()
    pendingSyncRef.current = null
    refreshRequestRef.current = null
    setSyncing(false)
    setSignedIn(false)
    setCommittedQuery('')
    setSearchInput('')
    closeEmail()
    setThreads([])
    setActiveFolder('inbox')
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
  function handleDraftSent(rowKey: string): void {
    if (draftPruneTimers.isPending(rowKey)) return
    invalidatePageCursor()
    draftPruneTimers.start(rowKey, DRAFT_PRUNE_DELAY_MS, () => removeListRow(rowKey))
  }
  function handleDraftDiscard(row: ThreadSummary): void {
    const confirmed = window.confirm(
      `Delete draft “${row.subject || '(no subject)'}”? This permanently discards it; not even Trash keeps a copy.`
    )
    if (!confirmed) return
    if (!row.draftId) return
    const sessionSignal = sessionAbortRef.current.signal
    const rowKey = listRowKey(row)
    setDraftDiscard({ rowKey, error: null })
    window.api
      .discardDraft(row.draftId)
      .then(() => {
        if (sessionSignal.aborted) return
        setDraftDiscard(null)
        invalidatePageCursor()
        removeListRow(rowKey)
      })
      .catch((e: unknown) => {
        if (sessionSignal.aborted) return
        setDraftDiscard({ rowKey, error: errorMessage(e) })
        recordError(e)
      })
  }
  function removeListRow(rowKey: string): void {
    setThreads((prev) => prev.filter((e) => listRowKey(e) !== rowKey))
    if (selectionRef.current === rowKey) closeEmail()
  }
  function handleThreadRemoved(threadId: string): void {
    invalidatePageCursor()
    removeListRow(listRowKey({ id: threadId }))
  }

  function updateThreadLists(
    update: (rows: ThreadSummary[], query: string, view: string) => ThreadSummary[],
    invalidateQuery?: string
  ): void {
    setThreads((prev) => update(prev, committedQuery, viewKey))
    for (const [view, pages] of searchPageCacheRef.current) {
      for (const [query, page] of pages) {
        if (query.trim().toLowerCase() === invalidateQuery) pages.delete(query)
        else pages.set(query, { ...page, threads: update(page.threads, query, view) })
      }
    }
  }

  function handleThreadReadChanged(threadId: string, unread: boolean): void {
    function updateRead(row: ThreadSummary): ThreadSummary {
      if (row.id !== threadId) return row
      const next = unread ? row.messageIds.length : 0
      return row.unreadCount === next ? row : { ...row, unreadCount: next }
    }
    updateThreadLists((rows) => rows.map(updateRead))
    setOpened((prev) => {
      if (!prev) return prev
      const row = updateRead(prev.row)
      return row === prev.row ? prev : { ...prev, row }
    })
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
    if (
      !starred &&
      (activeFolder === 'starred' || committedQuery.trim().toLowerCase() === 'is:starred')
    )
      invalidatePageCursor()
    function updateStar(row: ThreadSummary): ThreadSummary {
      return row.id === threadId && row.starred !== starred ? { ...row, starred } : row
    }
    updateThreadLists(
      (rows, query, view) =>
        !starred && (view === 'starred' || query.trim().toLowerCase() === 'is:starred')
          ? rows.filter((e) => e.id !== threadId)
          : rows.map((e) => (e.id === threadId && e.starred !== starred ? { ...e, starred } : e)),
      'is:starred'
    )
    setOpened((prev) => {
      if (!prev) return prev
      const row = updateStar(prev.row)
      return row === prev.row ? prev : { ...prev, row }
    })
    if (
      !starred &&
      (viewKey === 'starred' || committedQuery.trim().toLowerCase() === 'is:starred') &&
      selectionRef.current === listRowKey({ id: threadId })
    )
      closeEmail()
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
    if (signedIn !== true) return
    refreshLabels()
  })
  function handleLabelSelect(label: MailLabel): void {
    if (activeLabel?.id === label.id) return
    replaceListRequest()
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
      invalidatePageCursor()
      setThreads((prev) => prev.filter((row) => row.id !== threadId))
    }
  }
  function handleFolderSelect(folder: MailFolder): void {
    if (folder === activeFolder && activeLabel === null) return
    replaceListRequest()
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
    const continuation = nextPageTokenRef.current
    if (pageRequestRef.current !== null || searchingRef.current || continuation === null) return
    const requestId = ++requestIdRef.current
    pageRequestRef.current = requestId
    setLoadingMore(true)
    const loadPages = async (): Promise<void> => {
      readPages: while (requestIdRef.current === requestId) {
        const invalidCursor = invalidCursorRef.current
        const skipRowIds = invalidCursor
          ? listedThreadsRef.current.map((row) => row.draftId ?? row.id)
          : undefined
        const previousDepth = loadedPagesRef.current
        let depth = invalidCursor ? 0 : previousDepth
        let pageToken: string | null | undefined = invalidCursor ? undefined : continuation
        const incoming = new Map<string, ThreadSummary>()
        do {
          let page: ThreadPage
          try {
            page = await window.api.listFolder({
              maxResults: committedQuery ? SEARCH_PAGE_SIZE : LIST_PAGE_SIZE,
              pageToken,
              ...(skipRowIds ? { skipRowIds } : {}),
              folder: activeFolder,
              ...(activeLabel ? { userLabelId: activeLabel.id } : {}),
              ...(committedQuery ? { q: committedQuery } : {})
            })
          } catch (e) {
            if (requestIdRef.current !== requestId) return
            if (!isDeadGrantError(e) && invalidCursorRef.current !== invalidCursor) {
              continue readPages
            }
            throw e
          }
          if (requestIdRef.current !== requestId) return
          if (invalidCursorRef.current !== invalidCursor) continue readPages
          for (const row of page.threads) incoming.set(listRowKey(row), row)
          pageToken = page.nextPageToken
          depth++
        } while (pageToken !== null && depth <= previousDepth)
        const rows = [...incoming.values()]
        setThreads((prev) => {
          const seen = new Set(prev.map(listRowKey))
          return [...prev, ...rows.filter((row) => !seen.has(listRowKey(row)))]
        })
        setPageToken(pageToken, depth)
        return
      }
    }
    void loadPages()
      .catch((e: unknown) => {
        if (requestIdRef.current === requestId) recordError(e)
      })
      .finally(() => {
        if (pageRequestRef.current !== requestId) return
        pageRequestRef.current = null
        setLoadingMore(false)
        flushPendingSync()
      })
  }
  function loadFirstPage(trigger: FirstPageMode): void {
    if (
      trigger === 'wake' &&
      activeFolder !== 'inbox' &&
      activeFolder !== 'snoozed' &&
      !committedQuery
    ) {
      return
    }
    const mode = trigger === 'wake' ? (activeFolder === 'snoozed' ? 'manual' : 'recheck') : trigger
    const quiet = mode === 'sync' || mode === 'reset' || mode === 'recheck'
    function deferQuietFold(fold: QuietFold): void {
      const pending = pendingSyncRef.current
      if (pending === null || fold === 'recheck' || pending === 'sync')
        pendingSyncRef.current = fold
    }
    if (quiet && (searchingRef.current || pageRequestRef.current !== null)) {
      deferQuietFold(mode)
      return
    }
    const requestId = replaceListRequest()
    if (quiet) {
      setQuietSearching(true)
    } else {
      setActiveSearching(true)
    }
    if (!quiet) setError(null)
    if (mode === 'load') closeEmail()
    const invalidCursor = invalidCursorRef.current
    const options = {
      maxResults: committedQuery ? SEARCH_PAGE_SIZE : LIST_PAGE_SIZE,
      folder: activeFolder,
      ...(activeLabel ? { userLabelId: activeLabel.id } : {}),
      ...(committedQuery ? { q: committedQuery } : {})
    }
    const reconcileSearch = committedQuery !== '' && (mode === 'recheck' || mode === 'reset')
    const recheckDepth =
      mode === 'recheck' ||
      reconcileSearch ||
      (mode === 'reset' && nextPageTokenRef.current === null)
        ? loadedPagesRef.current
        : 1
    function ownsResult(): boolean {
      if (requestIdRef.current !== requestId) return false
      if (quiet && invalidCursor !== invalidCursorRef.current) {
        deferQuietFold(mode)
        return false
      }
      return true
    }
    async function foldPages(): Promise<void> {
      const page: ThreadPage = await window.api.listFolder(options)
      if (!ownsResult()) return
      let token = page.nextPageToken
      let depth = 1
      const tail = new Map<string, ThreadSummary>()
      if (token !== null && recheckDepth > 1) {
        const skipRowIds = reconcileSearch
          ? undefined
          : [...listedThreadsRef.current, ...page.threads].map((row) => row.draftId ?? row.id)
        while (token !== null && depth < recheckDepth) {
          const next = await window.api.listFolder({ ...options, pageToken: token, skipRowIds })
          if (!ownsResult()) return
          for (const row of next.threads) tail.set(listRowKey(row), row)
          token = next.nextPageToken
          depth++
        }
      }
      const selected = selectionRef.current
      const selectedRow = listedThreadsRef.current.find((row) => listRowKey(row) === selected)
      let dropSelected = false
      let lookupError: unknown
      if (
        activeFolder === 'snoozed' &&
        selectedRow &&
        !page.threads.some((row) => listRowKey(row) === selected) &&
        !tail.has(selected!)
      ) {
        const locallySnoozed = selectedSnoozedByMailsyRef.current
        try {
          const thread = await window.api.getThread(selectedRow.id)
          dropSelected =
            locallySnoozed &&
            thread.snoozeUntil !== undefined &&
            (thread.snoozeUntil === null || thread.snoozeUntil <= Date.now())
        } catch (e) {
          dropSelected =
            (e as { code?: unknown })?.code === 404 || /404|not\s*found/i.test(errorMessage(e))
          if (!dropSelected) lookupError = e
        }
      }
      if (!ownsResult()) return
      if (dropSelected && selectionRef.current === selected) closeEmail()
      if (reconcileSearch) {
        const incoming = new Map(page.threads.map((row) => [listRowKey(row), row]))
        for (const [key, row] of tail) incoming.set(key, row)
        const rows = [...incoming.values()]
        setThreads((prev) => mergeIncoming(prev, rows, false, null))
        const draft = selectedDraftRef.current
        if (draft && !incoming.has(draft.key) && !draftPruneTimers.isPending(draft.key)) {
          const stillSelected = (): boolean =>
            requestIdRef.current === requestId &&
            selectedDraftRef.current === draft &&
            !draftPruneTimers.isPending(draft.key)
          void window.api
            .draftExists(draft.id)
            .then((exists) => {
              if (!exists && stillSelected()) closeEmail()
            })
            .catch((e: unknown) => {
              if (stillSelected() && isDeadGrantError(e)) exitToSignedOut()
            })
        }
      } else {
        setThreads((prev) => {
          if (mode === 'load') return page.threads
          const remaining = dropSelected ? prev.filter((row) => listRowKey(row) !== selected) : prev
          const merged = mergeIncoming(remaining, page.threads, quiet, selectionRef.current)
          if (tail.size === 0) return merged
          const seen = new Set(merged.map(listRowKey))
          return [...merged, ...[...tail].filter(([key]) => !seen.has(key)).map(([, row]) => row)]
        })
      }
      if (!quiet || loadedPagesRef.current <= 1 || recheckDepth > 1) setPageToken(token, depth)
      storeFirstPage(page, committedQuery)
      if (lookupError && (!quiet || isDeadGrantError(lookupError))) recordError(lookupError)
    }
    void foldPages()
      .catch((e: unknown) => {
        if (requestIdRef.current !== requestId) return
        if (quiet) {
          if (isDeadGrantError(e)) exitToSignedOut()
          return
        }
        recordError(e)
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setActiveSearching(false)
          flushPendingSync()
        }
      })
  }
  useReaction([threads, activeFolder], () => {
    const draftId = reopenDraftRef.current
    if (draftId === null || activeFolder !== 'drafts') return
    const row = threads.find((thread) => thread.draftId === draftId)
    if (!row) return
    reopenDraftRef.current = null
    handleSelect(row)
  })
  function openLeftDraft(draftId: string): void {
    reopenDraftRef.current = draftId
    if (activeFolder !== 'drafts' || activeLabel !== null) {
      handleFolderSelect('drafts')
      return
    }
    if (committedQuery !== '') {
      handleClearSearch()
      return
    }
    const row = threads.find((thread) => thread.draftId === draftId)
    if (!row) {
      handleRefresh()
      return
    }
    reopenDraftRef.current = null
    handleSelect(row)
  }
  const syncResultHandlerRef = useLatest(handleSyncResult)
  const firstPageLoaderRef = useLatest(loadFirstPage)
  const signedInRef = useLatest(signedIn)
  function flushPendingSync(): void {
    const pending = pendingSyncRef.current
    if (!pending || searchingRef.current || pageRequestRef.current !== null) return
    pendingSyncRef.current = null
    if (signedInRef.current === true) firstPageLoaderRef.current(pending)
  }
  function handleSyncResult(result: SyncResult): void {
    if (signedInRef.current !== true) return
    if (result.kind === 'reset') {
      loadFirstPage('reset')
      return
    }
    const viewLabel = viewLabelOf(activeFolder, activeLabel?.id ?? null)
    if (committedQuery) {
      if (!selectedIsDraft) {
        setOpened((prev) => {
          if (!prev || prev.query !== committedQuery) return prev
          const row = result.threads.find((thread) => thread.id === prev.row.id)
          return row ? { ...prev, row: { ...prev.row, ...row } } : prev
        })
      }
      const listedIds = new Set(threads.map((row) => row.id))
      const draft = selectedDraftRef.current
      if (
        (draft && result.deletedThreadIds.includes(draft.threadId)) ||
        result.deletedThreadIds.some((id) => listedIds.has(id)) ||
        result.threads.some(
          (row) => viewLabel === null || row.labelIds.includes(viewLabel) || listedIds.has(row.id)
        )
      ) {
        loadFirstPage('recheck')
      }
      return
    }
    if (viewLabel === null) {
      if (result.threads.length > 0 || result.deletedThreadIds.length > 0) loadFirstPage('sync')
      return
    }
    const departingIds = new Set([
      ...result.deletedThreadIds,
      ...result.threads.filter((row) => !row.labelIds.includes(viewLabel)).map((row) => row.id)
    ])
    if (
      departingIds.size > 0 &&
      (pageRequestRef.current !== null ||
        searchingRef.current ||
        threads.some((row) => departingIds.has(row.id)))
    ) {
      invalidatePageCursor()
    }
    setThreads(
      (prev) =>
        applyMailDelta(prev, result, {
          labelId: viewLabel,
          isSearchActive: false
        }) ?? prev
    )
  }
  useSubscription(signedIn === true, () =>
    window.api.onSyncResult((result) => syncResultHandlerRef.current(result))
  )
  function handleRefresh(): void {
    if (refreshRequestRef.current !== null) return
    const request = Symbol()
    refreshRequestRef.current = request
    setSyncing(true)
    window.api
      .syncMail('button')
      .then((result) => {
        if (refreshRequestRef.current === request) syncResultHandlerRef.current(result)
      })
      .catch((e: unknown) => {
        if (refreshRequestRef.current === request) recordError(e)
      })
      .finally(() => {
        if (refreshRequestRef.current !== request) return
        refreshRequestRef.current = null
        setSyncing(false)
      })
  }
  useInterval(
    signedIn === true,
    SNOOZE_TICK_MS,
    () => {
      const session = sessionAbortRef.current.signal
      window.api
        .snoozeTick()
        .then((restored) => {
          if (!session.aborted && restored > 0) firstPageLoaderRef.current('wake')
        })
        .catch(() => {})
    },
    { immediate: true }
  )
  useIntersection({
    target: sentinelRef,
    root: sidebarRef,
    rootMargin: '400px',
    armKey:
      typeof nextPageToken === 'string' ? `${viewKey}\n${committedQuery}\n${nextPageToken}` : null,
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
    const cached = cachedSearchPage
    if (cached) {
      if (selectionRef.current !== null) {
        const row = cached.threads.find((thread) => listRowKey(thread) === selectionRef.current)
        if (row) setOpened({ row, query: committedQuery })
        else closeEmail()
      }
      setThreads(cached.threads)
      replaceListRequest()
      setPageToken(cached.nextPageToken, 1)
      setActiveSearching(false)
      flushPendingSync()
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
        if (!isMounted()) return
        setSignedIn(isAuthenticated)
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
            <LeftSendNotices onOpenDraft={openLeftDraft} />
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
                key={listRowKey(row)}
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
            <ComposeEditor onClose={closeEmail} sessionSignal={sessionAbortRef.current.signal} />
          ) : selectedThread ? (
            selectedIsDraft ? (
              <DraftEditor
                key={selectedKey}
                row={selectedThread}
                detail={draftDetail}
                detailLoading={draftDetailLoading}
                sessionSignal={sessionAbortRef.current.signal}
                onSent={() => handleDraftSent(listRowKey(selectedThread))}
                onDraftDiscard={() => handleDraftDiscard(selectedThread)}
                discardError={
                  draftDiscard && draftDiscard.rowKey === selectedKey ? draftDiscard.error : null
                }
              />
            ) : (
              <EmailDetail
                key={selectedThread.id}
                thread={selectedThread}
                folder={activeFolder}
                labels={labels}
                sessionSignal={sessionAbortRef.current.signal}
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
