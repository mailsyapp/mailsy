import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const LIST_PAGE_SIZE = 30
// Smaller pages for server search: each result costs a messages.get call,
// so a smaller page proportionally lowers the quota cost per keystroke.
const SEARCH_PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 800
// How long "Message sent." stays visible before the spent draft row is
// removed from the list.
const DRAFT_PRUNE_DELAY_MS = 2000
// How often the signed-in renderer asks main to sweep due snoozes. The tick
// is the minutes-level sweep of the wake design: main also arms a timer at
// the next due moment, and the startup catch-up absorbs closed-window gaps.
const SNOOZE_TICK_MS = 30_000

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
  const [opened, setOpened] = useState<{ row: ThreadSummary; query: string } | null>(null)
  const [nextPageToken, setNextPageToken] = useState<string | null | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the drafts branch keeps a message fetch: the Draft editor needs the
  // one draft's body, while conversation rows render from getThread alone.
  const [draftDetail, setDraftDetail] = useState<EmailDetailData | null>(null)
  const [draftDetailLoading, setDraftDetailLoading] = useState(false)
  // True when the selected thread is a draft, wherever the row was listed:
  // the drafts folder always, and All Mail through the row's hasDraft.
  const [selectedIsDraft, setSelectedIsDraft] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const [activeFolder, setActiveFolder] = useState<MailFolder>('inbox')
  // The open user-label view, mutually exclusive with the folder rail
  // selection (switching either side clears the other).
  const [activeLabel, setActiveLabel] = useState<MailLabel | null>(null)
  // The user labels the rail chips and the detail Labels menu share; totals
  // re-read after every create/delete and every thread apply/remove.
  const [labels, setLabels] = useState<MailLabel[]>([])
  // The content pane is mutually exclusive: a fresh compose vs a selected
  // email. Every exit (sign-out, folder switch, selecting a row) runs
  // closeEmail below, which clears this together with the selection.
  const [composing, setComposing] = useState(false)
  // The failed delete the open editor renders: keyed by the row the
  // attempt targeted, so a failed row-level delete never shows in an
  // unrelated editor open at the same time.
  const [draftDiscard, setDraftDiscard] = useState<{ rowKey: string; error: string | null } | null>(
    null
  )

  const selectionRef = useRef<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const requestIdRef = useRef(0)
  // Last list actually on screen, so re-renders and the initial mount can't
  // double-fire the same request. Keyed by folder+label+query, never a
  // prejoined string, so a label view and its folder never collide.
  const lastFetchedRef = useRef<{ folder: MailFolder; labelId: string | null; q: string } | null>(
    null
  )
  // Server search first-pages per view: label views key as 'label:<id>'.
  // Retyping/backspacing to a previous query in the same view reuses it
  // instead of spending quota again. Unfiltered ('') lists are never
  // cached here so clearing the search always refreshes.
  const searchPageCacheRef = useRef(new Map<string, Map<string, ThreadPage>>())
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
  const pageRequestRef = useRef<number | null>(null)
  const searchingRef = useRef(false)
  const pendingSyncRef = useRef<QuietFold | null>(null)
  const nextPageTokenRef = useRef<string | null | undefined>(undefined)
  const loadedPagesRef = useRef(0)
  const invalidCursorRef = useRef<symbol | null>(null)
  const listedThreadsRef = useRef<ThreadSummary[]>([])
  const refreshRequestRef = useRef<symbol | null>(null)
  const [syncing, setSyncing] = useState(false)

  function replaceListRequest(): number {
    if (pageRequestRef.current !== null) {
      pageRequestRef.current = null
      setLoadingMore(false)
    }
    return ++requestIdRef.current
  }

  // The sync mirrors above are read by the IntersectionObserver before any
  // state has committed, so every write pairs the state with its ref. One
  // setter per pair makes an unpaired write unrepresentable.
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

  // A background fold flips only the guard mirror: its fetch must not
  // flash the status line or toggle "Load more" every sweep, so the state
  // stays false while the ref says in-flight.
  function setQuietSearching(active: boolean): void {
    searchingRef.current = active
  }

  // A view identifier: the folder, or the label view its label opens. Every
  // per-view cache and the last-fetched guard key through this.
  const viewKey = activeLabel ? `label:${activeLabel.id}` : activeFolder

  // A fresh page's rows land wherever the view keeps list truth:
  // unfiltered pages back the Fuse fallback pool, search pages go into the
  // per-view cache with the oldest evicted past 20.
  function storeFirstPage(page: ThreadPage, query: string): void {
    lastFetchedRef.current = { folder: activeFolder, labelId: activeLabel?.id ?? null, q: query }
    if (!query) {
      // Label views have no local search fallback, so only folder pages
      // back the pool; two label views must not clobber one key.
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

  // Both pane entries clear all pane state through closeEmail first, so a
  // compose and an open email can never be on screen together.
  function openCompose(): void {
    if (composing) return
    closeEmail()
    setComposing(true)
  }

  function closeEmail(): void {
    selectionRef.current = null
    setOpened(null)
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
        const key = listRowKey(e)
        if (!seen.has(key)) seen.set(key, e)
      }
      const preview = previewMatches([...seen.values()], pending)
      if (preview.length > 0) return preview
    }
    if (!isSearchActive) return threads
    if (threads.length > 0) return rerankByFuse(threads, committedQuery)
    // Server returned nothing: fuzzy-search the folder's cached unfiltered
    // page so a typo can still surface locally-loaded mail instead of a
    // dead end (only where the folder config allows it).
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

  const selectedThread =
    displayedThreads.find((e) => listRowKey(e) === selectedKey) ??
    (isSearchActive && opened?.query === committedQuery && !selectedIsDraft ? opened.row : null)

  function handleSelect(row: ThreadSummary): void {
    // The pane is exclusive: a selected row replaces an open compose (and
    // everything else the pane draws), so the exit runs through closeEmail.
    closeEmail()
    const rowKey = listRowKey(row)
    selectionRef.current = rowKey
    setOpened({ row, query: committedQuery })
    setError(null)
    // Drafts open the editor, not the conversation pane. In All Mail the
    // carrying row's hasDraft decides; in the drafts folder every row is
    // one. Conversation rows render from getThread inside EmailDetail; only
    // the draft branch needs a message body fetch.
    const draftsFolder = activeFolder === 'drafts'
    const draftHere = draftsFolder || (activeFolder === 'all' && row.hasDraft === true)
    setSelectedIsDraft(draftHere)
    if (!draftHere) return
    setDraftDetailLoading(true)
    window.api
      .getMessage(row.messageIds[row.messageIds.length - 1])
      .then((detail) => {
        if (selectionRef.current === rowKey) setDraftDetail(detail)
      })
      .catch((e: unknown) => {
        if (selectionRef.current === rowKey) recordError(e)
      })
      .finally(() => {
        if (selectionRef.current === rowKey) setDraftDetailLoading(false)
      })
  }

  const [showCredentialsSetup, setShowCredentialsSetup] = useState(false)

  async function completeSignIn(): Promise<void> {
    await window.api.signIn()
    // The list effect below loads the list; fetching here too would
    // double the quota cost.
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

  // Shared reset for the two user-visible ways a session ends: a dead grant
  // found by recordError, and signing out. Bumping the request id drops any
  // in-flight list response so it can't paint mail rows onto the
  // signed-out screen.
  function exitToSignedOut(): void {
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
    // No per-folder mail content may survive: nothing typed or cached.
    searchPageCacheRef.current.clear()
    // Prune timers are canceled, not just dropped: their callbacks could
    // otherwise outlive the flip into the next session's freshly loaded
    // list and filter the wrong rows out of it.
    draftPruneTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    draftPruneTimersRef.current.clear()
    setUnfilteredByFolder(new Map<MailFolder, ThreadSummary[]>())
    // null means pagination is exhausted, so the sentinel observer and
    // loadMore can't refetch the folder after the flip. undefined would
    // mean "unknown", which reopens the window: the observer fires and
    // issues a doomed request against the signed-out session.
    setPageToken(null)
    setActiveSearching(false)
    lastFetchedRef.current = null
  }

  // One funnel for every boundary failure. A dead Google grant (the main
  // process already dropped the token file) can never succeed by retrying,
  // so the only usable screen is the sign-in one: the list and its search
  // state reset with the same flip. Either boundary failure sentence can
  // arrive (the token may already be gone between two racing calls), so
  // both flip.
  function recordError(e: unknown): void {
    setError(formatFetchError(e))
    if (isDeadGrantError(e)) {
      exitToSignedOut()
    }
  }

  // A dead grant means the stored token is worthless, so the only useful
  // act is ending the session wherever the failure surfaced.
  function isDeadGrantError(e: unknown): boolean {
    return e instanceof Error && /session has expired|not signed in yet/i.test(e.message)
  }

  function handleSearchSubmit(): void {
    // Enter commits immediately instead of waiting out the debounce.
    setCommittedQuery(searchInput.trim())
  }

  // Called by DraftEditor once a send succeeded. Removal is owned here
  // because App owns the list and never unmounts: one timer per sent draft
  // is exactly-once by construction, and pruning can't be lost to an
  // unmount of the editor.
  function handleDraftSent(rowKey: string): void {
    if (draftPruneTimersRef.current.has(rowKey)) return
    invalidatePageCursor()
    draftPruneTimersRef.current.set(
      rowKey,
      window.setTimeout(() => {
        draftPruneTimersRef.current.delete(rowKey)
        removeListRow(rowKey)
      }, DRAFT_PRUNE_DELAY_MS)
    )
  }

  // One collect point for both delete affordances: a Drafts row and the
  // open draft editor call into this handler, so the confirm (the
  // label-delete idiom), the bridge verb, and the list prune are written
  // once. The editor of the deleted draft stays mounted for the bridge
  // round trip; that is safe by convergence — its autosave only ever
  // updates this same draft id, so a straggling save (in flight, or the
  // unmount flush the close below fires) either lands before the delete
  // or resolves a 404 after it. The draft ends deleted either way, and the
  // unmounted hook's save-error state dies with the component.
  function handleDraftDiscard(row: ThreadSummary): void {
    const confirmed = window.confirm(
      `Delete draft “${row.subject || '(no subject)'}”? This permanently discards it; not even Trash keeps a copy.`
    )
    if (!confirmed) return
    // A Drafts-folder row always carries its server draft id (fetchDrafts
    // builds every row from drafts.get); without one no delete has a target.
    if (!row.draftId) return
    const rowKey = listRowKey(row)
    setDraftDiscard({ rowKey, error: null })
    window.api
      .discardDraft(row.draftId)
      .then(() => {
        setDraftDiscard(null)
        invalidatePageCursor()
        removeListRow(rowKey)
      })
      .catch((e: unknown) => {
        setDraftDiscard({ rowKey, error: errorMessage(e) })
        recordError(e)
      })
  }

  // Archive and delete remove the thread: the row id is the thread id now,
  // so one row disappears per mutation instead of every matching message.
  // Only the pane showing the removed thread folds along: deleting row B
  // must not slam a compose or an unrelated open conversation.
  function removeListRow(rowKey: string): void {
    setThreads((prev) => prev.filter((e) => listRowKey(e) !== rowKey))
    if (selectionRef.current === rowKey) closeEmail()
  }

  function handleThreadRemoved(threadId: string): void {
    invalidatePageCursor()
    removeListRow(listRowKey({ id: threadId }))
  }

  // Read/unread is thread-level: Gmail marks whole conversations, and
  // threads.modify on UNREAD does the same batch shape as archive above.
  // The row's unread count collapses to the whole thread or clears to zero.
  function handleThreadReadChanged(threadId: string, unread: boolean): void {
    function updateRead(row: ThreadSummary): ThreadSummary {
      if (row.id !== threadId) return row
      const next = unread ? row.messageIds.length : 0
      return row.unreadCount === next ? row : { ...row, unreadCount: next }
    }
    setThreads((prev) => prev.map(updateRead))
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

  // "Not spam" restores the thread to the Inbox: the removal of the SPAM
  // label is also a list-clearing action, so the row leaves this view's
  // list the way archive and trashing leave theirs.
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

  // Unsnooze on a Snoozed row, mirroring the row-level not spam above: the
  // row leaves this view's list when the mail rejoins the Inbox. Mail parked
  // natively carries no writable label, so the INBOX add alone ends the
  // parking state; mail Mailsy parked itself restores through the restore
  // pair, which also clears the wake schedule (EmailDetail's note).
  function handleRowUnsnooze(row: ThreadSummary): void {
    const write = row.snoozedByMailsy
      ? window.api.restoreThread(row.id)
      : window.api.modifyLabels({ kind: 'thread', id: row.id, addLabelIds: ['INBOX'] })
    write.then(() => handleThreadRemoved(row.id)).catch((e: unknown) => recordError(e))
  }

  // Star is thread-level like read/unread: threads.modify applies STARRED to
  // every message in the conversation.
  function handleThreadStarChanged(threadId: string, starred: boolean): void {
    if (activeFolder === 'starred' && !starred) invalidatePageCursor()
    function updateStar(row: ThreadSummary): ThreadSummary {
      return row.id === threadId && row.starred !== starred ? { ...row, starred } : row
    }
    // In the Starred folder an unstar removes the mail from this view, the
    // same way archive leaves the Inbox list.
    setThreads((prev) =>
      activeFolder === 'starred' && !starred
        ? prev.filter((e) => e.id !== threadId)
        : prev.map(updateStar)
    )
    setOpened((prev) => {
      if (!prev) return prev
      const row = updateStar(prev.row)
      return row === prev.row ? prev : { ...prev, row }
    })
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

  // A labels.list read wrapped for the places a mutation makes the rail's
  // totals stale: create, delete, and every thread-level apply/remove.
  // recordError is render-scoped like the neighbouring handlers; nothing it
  // closes over changes this callback's behavior.
  const refreshLabels = useCallback((): void => {
    window.api
      .listLabels()
      .then((labelList) =>
        // The rail and the detail menu are the user-label surfaces; system
        // labels are Gmail's own views and stay out of both.
        setLabels(labelList.filter((label) => label.type === 'user'))
      )
      .catch((e: unknown) => recordError(e))
    // recordError is render-scoped; nothing it closes over changes this
    // callback's behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (signedIn !== true) return
    refreshLabels()
  }, [signedIn, refreshLabels])

  // Switching to a label sets the view pair: activeFolder carries the
  // label-view plumbing and activeLabel the id, together the whole view.
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
        // The deleted view's search cache has no live label behind it; a
        // future label may reuse the id family, so the stale pages go with
        // the label.
        searchPageCacheRef.current.delete(`label:${label.id}`)
        refreshLabels()
        // The open view was exactly this label: its threads got unlabeled
        // server-side, so the view itself is gone and the Inbox takes the
        // screen back. A label view is the only place activeLabel tracks a
        // still-existing label, so handleFolderSelect('inbox') is the full
        // reset.
        if (activeLabel?.id === label.id) handleFolderSelect('inbox')
      })
      .catch((e: unknown) => recordError(e))
  }

  // Apply/remove on the open thread: one labels.list read refreshes the
  // rail's totals, and when the mutation drops the thread from the label
  // view on screen, the row leaves the list the way archive leaves Inbox.
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
    // The list resets with the folder: a stale nextPageToken from the old
    // folder must never pair with the new folder's next-page fetch.
    setThreads([])
    setPageToken(undefined)
    setActiveSearching(false)
    lastFetchedRef.current = null
  }

  const loadMore = useCallback((): void => {
    // Guards read the synchronous refs: the observer can fire repeatedly
    // within one fetch's window, before the states it mirrors have
    // committed, and a stale false here appends duplicate pages.
    const continuation = nextPageTokenRef.current
    if (pageRequestRef.current !== null || searchingRef.current || continuation === null) return
    // Same request guard as the list effect below: a slower overlapping
    // response must never write after a response a later request superseded.
    const requestId = ++requestIdRef.current
    pageRequestRef.current = requestId
    setLoadingMore(true)
    const loadPages = async (): Promise<void> => {
      const invalidCursor = invalidCursorRef.current
      const skipRowIds = invalidCursor
        ? listedThreadsRef.current.map((row) => row.draftId ?? row.id)
        : undefined
      const previousDepth = loadedPagesRef.current
      let depth = invalidCursor ? 0 : previousDepth
      let pageToken: string | null | undefined = invalidCursor ? undefined : continuation
      const incoming = new Map<string, ThreadSummary>()
      do {
        const page = await window.api.listFolder({
          maxResults: committedQuery ? SEARCH_PAGE_SIZE : LIST_PAGE_SIZE,
          pageToken,
          ...(skipRowIds ? { skipRowIds } : {}),
          folder: activeFolder,
          ...(activeLabel ? { userLabelId: activeLabel.id } : {}),
          ...(committedQuery ? { q: committedQuery } : {})
        })
        if (requestIdRef.current !== requestId || invalidCursorRef.current !== invalidCursor) return
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
    // recordError is render-scoped like the neighbouring handlers it calls;
    // nothing it closes over changes this callback's behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedQuery, activeFolder, activeLabel])

  // First-page loads share one fetch pipeline; the mode decides the rest
  // of the behavior.
  const loadFirstPage = useCallback(
    (trigger: FirstPageMode): void => {
      if (
        trigger === 'wake' &&
        activeFolder !== 'inbox' &&
        activeFolder !== 'snoozed' &&
        !committedQuery
      ) {
        return
      }
      const mode =
        trigger === 'wake' ? (activeFolder === 'snoozed' ? 'manual' : 'recheck') : trigger
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
      // A reset can hide deliveries behind an exhausted list. A wake or
      // unknown search match can also enter the middle of an open cursor.
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
        setThreads((prev) => {
          if (mode === 'load') return page.threads
          if (reconcileSearch) {
            const incoming = new Map(page.threads.map((row) => [listRowKey(row), row]))
            for (const [key, row] of tail) incoming.set(key, row)
            return mergeIncoming(prev, [...incoming.values()], false, null)
          }
          const merged = mergeIncoming(prev, page.threads, quiet, selectionRef.current)
          if (tail.size === 0) return merged
          const seen = new Set(merged.map(listRowKey))
          return [...merged, ...[...tail].filter(([key]) => !seen.has(key)).map(([, row]) => row)]
        })
        if (!quiet || loadedPagesRef.current <= 1 || recheckDepth > 1) setPageToken(token, depth)
        storeFirstPage(page, committedQuery)
      }
      void foldPages()
        .catch((e: unknown) => {
          if (requestIdRef.current !== requestId) return
          if (quiet) {
            // A pushed fold never paints the banner and never wipes a
            // message the user is reading: only a dead grant acts. Transient
            // sync failures surface on the next user-driven fetch.
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
    },
    // closeEmail, storeFirstPage and recordError are render-scoped like the
    // neighbouring handlers; nothing they close over changes this callback's
    // behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [committedQuery, activeFolder, activeLabel]
  )

  // The pushed-sync channel replaces the old fixed-interval poll: main
  // sweeps the mailbox incrementally on its own adaptive clock (and on
  // window focus), and every sweep result arrives here. The subscription
  // lives only while signed in, so a result landing after sign-out finds
  // no listener to repaint the empty screen. handleSyncResult below is a
  // function declaration, so the render body can pin the latest copy to
  // the ref the subscription reads.
  const syncResultHandlerRef = useRef<(result: SyncResult) => void>(() => {})
  const firstPageLoaderRef = useRef<(mode: FirstPageMode) => void>(() => {})
  const signedInRef = useRef<boolean | null>(null)

  function flushPendingSync(): void {
    const pending = pendingSyncRef.current
    if (!pending || searchingRef.current || pageRequestRef.current !== null) return
    pendingSyncRef.current = null
    if (signedInRef.current === true) firstPageLoaderRef.current(pending)
  }

  function handleSyncResult(result: SyncResult): void {
    // A sweep resolving after sign-out has a cleared list behind it; its
    // rows would repaint the signed-out screen. The same guard keeps a
    // reset fold from refetching against a dead session.
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
          return row ? { ...prev, row } : prev
        })
      }
      const listedIds = new Set(threads.map((row) => row.id))
      if (
        result.deletedThreadIds.some((id) => listedIds.has(id)) ||
        result.threads.some(
          (row) => viewLabel === null || row.labelIds.includes(viewLabel) || listedIds.has(row.id)
        )
      ) {
        loadFirstPage('recheck')
      }
      return
    }
    // Query-defined views and server-search results cannot be judged by
    // the swept label sets; they take a full quiet fold, but only when
    // the sweep actually saw mailbox movement — an idle sweep costs
    // them nothing.
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
  // Pinned every render (effects are fine with refs; render bodies are
  // not): the subscription reads the latest handler, and the guard in it
  // reads the latest signed-in state.
  useEffect(() => {
    syncResultHandlerRef.current = handleSyncResult
    firstPageLoaderRef.current = loadFirstPage
    signedInRef.current = signedIn
    listedThreadsRef.current = threads
  })

  useEffect(() => {
    if (signedIn !== true) return
    return window.api.onSyncResult((result) => syncResultHandlerRef.current(result))
  }, [signedIn])

  // The Refresh button's path through the same funnel. In-flight clicks
  // neither queue a second sweep nor get swallowed: the guard drops them
  // while the button is already showing the sweep, and main coalesces
  // anything that reaches it onto the running sweep. Failures surface
  // through the shared error line.
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

  // The snooze heartbeat, the minutes-level sweep of the wake design: an
  // immediate tick on mount is the startup catch-up, and every tick that
  // returns a restored count above zero refreshes the view so the
  // returning thread appears without waiting for the next sync sweep. A
  // failed tick self-corrects on the interval, so it never nags the
  // error line.
  useEffect(() => {
    if (signedIn !== true) return
    let cancelled = false
    const snoozeSweep = (): void => {
      window.api
        .snoozeTick()
        .then((restored) => {
          if (!cancelled && restored > 0) firstPageLoaderRef.current('wake')
        })
        .catch(() => {})
    }
    snoozeSweep()
    const timer = window.setInterval(snoozeSweep, SNOOZE_TICK_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [signedIn])

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

  // First-page loads go through loadFirstPage below. This effect owns the
  // decision to skip: the view is already the list on screen, or the query
  // has a cached first page to honor instead of spending quota again.
  useEffect(() => {
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
    // `emails.length` is intentionally read, not depended on: depending on
    // it would refetch after every result arrives. loadFirstPage's identity
    // flips with the same two inputs, so listing it would change nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedQuery, signedIn, activeFolder, activeLabel])

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
            displayedThreads.length > 0 &&
            !searching && (
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
                key={selectedKey}
                row={selectedThread}
                detail={draftDetail}
                detailLoading={draftDetailLoading}
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
