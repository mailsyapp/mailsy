import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import { HugeiconsIcon } from '@hugeicons/react'
import { StarIcon } from '@hugeicons/core-free-icons'
import type {
  ThreadSummary,
  EmailDetail as EmailDetailData,
  ThreadPage,
  MailFolder,
  MailLabel
} from '../../shared/types'
import { EmailDetail } from './components/EmailDetail'
import { senderNameOf } from './lib/format'
import { DraftEditor } from './components/DraftEditor'
import { ComposeEditor } from './components/ComposeEditor'
import { FolderRail } from './components/FolderRail'

const LIST_PAGE_SIZE = 30
// Smaller pages for server search: each result costs a messages.get call,
// so a smaller page proportionally lowers the quota cost per keystroke.
const SEARCH_PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 800
// How long "Message sent." stays visible before the spent draft row is
// removed from the list.
const DRAFT_PRUNE_DELAY_MS = 2000
// How often the background tick re-reads the current view's first page, so
// new mail appears without a folder switch or a search.
const POLL_INTERVAL_MS = 60_000
// How often the signed-in renderer asks main to sweep due snoozes. The tick
// is the minutes-level sweep of the wake design: main also arms a timer at
// the next due moment, and the startup catch-up absorbs closed-window gaps.
const SNOOZE_TICK_MS = 30_000

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
  spam: { label: 'Spam', empty: 'Spam is empty', fallbackToLocal: false },
  snoozed: { label: 'Snoozed', empty: 'No snoozed mail', fallbackToLocal: false },
  // The user-label view: the heading and landmark read the open label's
  // name (activeLabel), so this row only fixes the config contract.
  label: { label: 'Labels', empty: 'No mail with this label', fallbackToLocal: false },
  starred: { label: 'Starred', empty: 'No starred mail yet', fallbackToLocal: false },
  important: { label: 'Important', empty: 'No important mail yet', fallbackToLocal: false },
  social: { label: 'Social', empty: 'No social mail yet', fallbackToLocal: false },
  promotions: { label: 'Promotions', empty: 'No promotions yet', fallbackToLocal: false },
  updates: { label: 'Updates', empty: 'No updates yet', fallbackToLocal: false },
  forums: { label: 'Forums', empty: 'No forum mail yet', fallbackToLocal: false },
  all: { label: 'All Mail', empty: 'No mail yet', fallbackToLocal: false }
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

// Every field the row renders, compared value by value: a poll supplies
// freshly built row objects each minute, so reference equality would
// trigger a re-render even when nothing changed.
function rowsEqual(a: ThreadSummary, b: ThreadSummary): boolean {
  return (
    a.id === b.id &&
    a.subject === b.subject &&
    a.snippet === b.snippet &&
    a.date === b.date &&
    a.unreadCount === b.unreadCount &&
    a.starred === b.starred &&
    (a.draftId ?? null) === (b.draftId ?? null) &&
    a.hasDraft === b.hasDraft &&
    a.participants.join('\n') === b.participants.join('\n') &&
    a.messageIds.join('\n') === b.messageIds.join('\n')
  )
}

// First-page loads share one fetch pipeline. 'load' is a folder switch or
// the initial mount and replaces the list; 'manual' is the Refresh button
// and 'poll' is the background tick, which fold the page in through
// mergeIncoming instead. Poll is the only mode that yields to an in-flight
// fetch (its result is disposable) and the only one that keeps the status
// state quiet; manual supersedes in-flight work through the shared
// request id.
type FirstPageMode = 'load' | 'manual' | 'poll'

// Folds a fresh first page into the list on screen. The incoming page owns
// order and content; rows it no longer returns keep their previous shape
// at the tail. Whether the tail keeps every row (background poll, so a
// sync never collapses loaded pages or closes the open email) or only the
// selected row (manual refresh, which shows server truth but must not
// yank away the message being read) is `keepAllDropped`.
function mergeIncoming(
  prev: ThreadSummary[],
  incoming: ThreadSummary[],
  keepAllDropped: boolean,
  selectedId: string | null
): ThreadSummary[] {
  if (prev.length === incoming.length && prev.every((row, i) => rowsEqual(row, incoming[i]))) {
    return prev
  }
  const incomingIds = new Set(incoming.map((row) => row.id))
  const dropped = prev.filter((row) => !incomingIds.has(row.id))
  const tail = keepAllDropped ? dropped : dropped.filter((row) => row.id === selectedId)
  return [...incoming, ...tail]
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
  const loadingMoreRef = useRef(false)
  const searchingRef = useRef(false)
  const nextPageTokenRef = useRef<string | null | undefined>(undefined)

  // The sync mirrors above are read by the IntersectionObserver before any
  // state has committed, so every write pairs the state with its ref. One
  // setter per pair makes an unpaired write unrepresentable.
  function setPageToken(token: string | null | undefined): void {
    nextPageTokenRef.current = token
    setNextPageToken(token)
  }

  function setActiveSearching(active: boolean): void {
    searchingRef.current = active
    setSearching(active)
  }

  // The poll flips only the guard mirror: its background fetch must not
  // flash the status line or toggle "Load more" every minute, so the state
  // stays false while the ref says in-flight.
  function setPollSearching(active: boolean): void {
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

  // Both pane entries clear all pane state through closeEmail first, so a
  // compose and an open email can never be on screen together.
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
    // The pane is exclusive: a selected row replaces an open compose (and
    // everything else the pane draws), so the exit runs through closeEmail.
    closeEmail()
    openEmail(row.id)
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
      .then(setDraftDetail)
      .catch((e: unknown) => recordError(e))
      .finally(() => setDraftDetailLoading(false))
  }

  function handleSignIn(): void {
    setError(null)
    window.api
      .signIn()
      .then(() => {
        // The list effect below loads the list; fetching here too would
        // double the quota cost.
        lastFetchedRef.current = null
        setSignedIn(true)
      })
      .catch((e: unknown) => recordError(e))
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
    ++requestIdRef.current
    setSignedIn(false)
    setCommittedQuery('')
    setSearchInput('')
    closeEmail()
    setThreads([])
    setActiveLabel(null)
    setLabels([])
    // No per-folder mail content may survive: nothing typed or cached.
    searchPageCacheRef.current.clear() // Prune timers are canceled, not just dropped: their callbacks could
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

  // A labels.list read wrapped for the places a mutation makes the rail's
  // totals stale: create, delete, and every thread-level apply/remove.
  // recordError is render-scoped like the neighbouring handlers; nothing it
  // closes over changes this callback's behavior.
  const refreshLabels = useCallback((): void => {
    window.api
      .listUserLabels()
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

  function handleLabelSelect(label: MailLabel): void {
    if (activeLabel?.id === label.id) return
    setActiveLabel(label)
    setSearchInput('')
    setCommittedQuery('')
    closeEmail()
    setError(null)
    setThreads([])
    setPageToken(undefined)
    setActiveSearching(false)
    lastFetchedRef.current = null
  }

  function handleCreateLabel(): void {
    const entered = window.prompt('New label name (use / to nest):')
    if (entered === null) return
    const name = entered.trim()
    if (!name) return
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
        refreshLabels()
        // The open view was exactly this label: its threads got unlabeled
        // server-side, so the view itself is gone and the folder rail takes
        // the screen back.
        if (activeLabel?.id === label.id)
          handleFolderSelect(activeFolder === 'label' ? 'inbox' : activeFolder)
      })
      .catch((e: unknown) => recordError(e))
  }

  // Apply/remove on the open thread: one labels.list read refreshes the
  // rail's totals, and when the mutation drops the thread from the label
  // view on screen, the row leaves the list the way archive leaves Inbox.
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
        ...(activeLabel ? { userLabelId: activeLabel.id } : {}),
        ...(committedQuery ? { q: committedQuery } : {})
      })
      .then((page) => {
        if (requestIdRef.current !== requestId) return
        // Merged-in tail rows reappear in an older page's token range;
        // keyed dedup keeps them single.
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
    // recordError is render-scoped like the neighbouring handlers it calls;
    // nothing it closes over changes this callback's behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedQuery, activeFolder, activeLabel])

  // First-page loads share one fetch pipeline; the mode decides the rest
  // of the behavior.
  const loadFirstPage = useCallback(
    (mode: FirstPageMode): void => {
      // A colliding fetch would see its response dropped by the request
      // id; skipping here keeps the poll from ever starting one it
      // already knows will lose.
      if (mode === 'poll' && (searchingRef.current || loadingMoreRef.current)) return
      const requestId = ++requestIdRef.current
      if (mode === 'poll') {
        setPollSearching(true)
      } else {
        setActiveSearching(true)
      }
      if (mode !== 'poll') setError(null)
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
              : mergeIncoming(prev, page.threads, mode === 'poll', selectionRef.current)
          )
          // A deeper token survives a poll or manual fold: string when more
          // pages remain, null when exhausted. Resetting it to the fresh
          // first page would re-walk pages the user already loaded on the
          // next Load more.
          if (mode === 'load' || nextPageTokenRef.current === undefined) {
            setPageToken(page.nextPageToken)
          }
          storeFirstPage(page, committedQuery)
        })
        .catch((e: unknown) => {
          if (requestIdRef.current !== requestId) return
          if (mode === 'poll') {
            // A background poll never paints the banner and never wipes a
            // message the user is reading: only a dead grant acts. Transient
            // poll failures surface on the next user-driven fetch.
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
    },
    // closeEmail, storeFirstPage and recordError are render-scoped like the
    // neighbouring handlers; nothing they close over changes this callback's
    // behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [committedQuery, activeFolder, activeLabel]
  )

  // The interval resets whenever loadFirstPage's identity flips with the
  // folder or query, so a freshly loaded view always gets one quiet minute
  // before the first poll.
  useEffect(() => {
    if (signedIn !== true) return
    const timer = window.setInterval(() => {
      if (document.hidden) return
      loadFirstPage('poll')
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [loadFirstPage, signedIn])

  // The snooze heartbeat, the same shape as the poll above: an immediate
  // tick on mount is the startup catch-up, and every tick that returns a
  // restored count above zero refreshes the view so the returning thread
  // appears without waiting for the next poll. A failed tick self-corrects
  // on the interval (and the poll), so it never nags the error line.
  useEffect(() => {
    if (signedIn !== true) return
    const snoozeSweep = (): void => {
      window.api
        .snoozeTick()
        .then((restored) => {
          if (restored > 0) loadFirstPage('manual')
        })
        .catch(() => {})
    }
    snoozeSweep()
    const timer = window.setInterval(snoozeSweep, SNOOZE_TICK_MS)
    return () => window.clearInterval(timer)
  }, [loadFirstPage, signedIn])

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

  return (
    <div className="app">
      <div className="actions">
        {signedIn === false && <button onClick={handleSignIn}>Sign in with Google</button>}
        {signedIn === true && (
          <>
            <button type="button" onClick={openCompose}>
              Compose
            </button>
            <button type="button" onClick={() => loadFirstPage('manual')} aria-label="Refresh mail">
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
              <li key={row.id} className={row.unreadCount > 0 ? 'unread' : undefined}>
                <button
                  type="button"
                  onClick={() => handleSelect(row)}
                  style={{ all: 'unset', display: 'block', cursor: 'pointer', width: '100%' }}
                >
                  {/* Bold is the unread affordance, so the row owns the
                      weight through li.unread; the subject itself is plain
                      markup. */}
                  <span className="email-text">
                    {row.subject}
                    {row.unreadCount > 1 ? ` (${row.unreadCount})` : ''}
                  </span>
                  {/* Sender names for the whole conversation, like Gmail's
                      participant summary on thread rows. */}
                  <div className="from email-text">
                    {row.participants.map(senderNameOf).join(', ')}
                  </div>
                  <div className="snippet email-text">{row.snippet}</div>
                </button>
                {activeFolder === 'spam' && (
                  <button type="button" onClick={() => handleRowNotSpam(row)}>
                    not spam
                  </button>
                )}
                {activeFolder === 'snoozed' && (
                  <button type="button" onClick={() => handleRowUnsnooze(row)}>
                    unsnooze
                  </button>
                )}
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
