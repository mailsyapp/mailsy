import { BrowserWindow } from 'electron'
import { getGmailClient } from '../auth'
import type { GmailClient } from '../auth'
import { type SyncReason, type SyncResult, type ThreadSynced } from '../../shared/sync'
import type { gmail_v1 } from 'googleapis'
import {
  DETAIL_CONCURRENCY,
  isNotFoundError,
  mapWithConcurrency,
  withQuotaRetry
} from './resilience'
import { threadToSummary } from './message'

// The canonical mail-sync entry point. Every refresh path — the adaptive
// background sweep, window focus regain, and the renderer's Refresh
// button — arrives here, so there is exactly one in-flight coalescing
// policy, one cursor, and one result every view consumes.
//
// It is an incremental sweep, not a poll: each run pages only the history
// records newer than the stored cursor and re-reads just the threads they
// touched. The renderer folds the delta into the view on screen, so a
// full first-page refetch ('reset') stays the exception, not the
// mechanism. The interval is adaptive: 30s while a window is on screen,
// capped exponential backoff after failed sweeps.
//
// Real Google webhook push (users.watch → Cloud Pub/Sub) needs an HTTPS
// endpoint Google can reach, which a local desktop app cannot offer
// without a hosted relay. Nothing dormant is shipped here for it: a
// relay's only job would be to call into exactly this funnel
// (syncMail) when its push arrives, so the seam is this function's
// signature, not dead wiring.
//
// The cursor is in-session state: a fresh launch starts from the first
// view load, whose fold re-earns the cursor from its fetched threads.

// Main's position in the mailbox's change stream. Fetches record it
// (folders and thread opens note the id off every thread response),
// sweeps advance it, and a null cursor means the next sweep asks for a
// full first-page fold instead of a delta.
let cursor: string | null = null

// History ids are unsigned decimal strings that outgrow double precision
// long before any user mailbox does; length-then-lex keeps the
// comparison exact without assuming they don't.
function isLaterId(a: string, b: string): boolean {
  return a.length > b.length || (a.length === b.length && a > b)
}

// Only a strictly greater id may move the cursor forward: page-2 fetches
// and thread opens legitimately observe older ids than the last sweep,
// and moving backward would replay already-consumed history forever.
// A sweep replaying covered ground is harmless (rows idempotently
// overwrite); a lost id never is.
export function noteHistoryId(id: string | number | undefined | null): void {
  if (id == null || id === '') return
  const next = String(id)
  if (cursor === null || isLaterId(next, cursor)) cursor = next
}

// The cursor is mailbox-identity-bound: a fresh sign-in may be a
// different account, and keeping it across sign-out sweeps the next
// account from a random position in the wrong mailbox.
export function resetSyncCursor(): void {
  cursor = null
  errorStreak = 0
}

// Draft churn is the stream's loudest noise: every autosave writes and
// rewrites one message's DRAFT label. The Drafts view is fold-refreshed
// anyway; the churn carries no folder membership a sweep can argue
// about; and tracking the thread would spend a threads.get per save.
function isDraftChurn(labelIds: string[] | null | undefined): boolean {
  return labelIds !== null && labelIds !== undefined && labelIds.join() === 'DRAFT'
}

// The thread ids a sweep must re-read, gathered from the history stream.
// Message deletion is not a special case: threads.get below either
// answers with the surviving messages or 404s, so a whole-thread expunge
// and a one-message exhale apply alike.
async function sweepChangedThreads(gmail: GmailClient): Promise<string[]> {
  const start = cursor
  if (start === null) return []

  const changed = new Set<string>()
  for (let pageToken: string | undefined; ;) {
    const page = await withQuotaRetry(() =>
      gmail.users.history.list({
        userId: 'me',
        startHistoryId: start,
        maxResults: 500,
        historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
        ...(pageToken ? { pageToken } : {})
      })
    )
    for (const record of page.data.history ?? []) {
      const note = (threadId: string | null | undefined): void => {
        if (threadId) changed.add(threadId)
      }
      // An autosave's messageAdded carries only its DRAFT label; real
      // new mail arrives with INBOX and friends riding along with it.
      for (const entry of record.messagesAdded ?? []) {
        if (isDraftChurn(entry.message?.labelIds)) continue
        note(entry.message?.threadId)
      }
      for (const entry of record.labelsAdded ?? []) {
        if (!(entry.labelIds ?? []).some((id) => id !== 'DRAFT')) continue
        note(entry.message?.threadId)
      }
      for (const entry of record.labelsRemoved ?? []) {
        if (!(entry.labelIds ?? []).some((id) => id !== 'DRAFT')) continue
        note(entry.message?.threadId)
      }
      for (const entry of record.messagesDeleted ?? []) note(entry.message?.threadId)
    }
    // The response's historyId is the position read through, not the
    // sweep's stale starting value, so it is what the next sweep starts
    // from (the API's own guidance when no updates are returned).
    noteHistoryId(page.data.historyId)
    pageToken = page.data.nextPageToken ?? undefined
    if (!pageToken) return [...changed]
  }
}

// Current list rows for every changed thread (plus its full label set,
// the membership truth every view's delta filter reads), one
// threads.get per id in the same shape a folder page's rows are built.
// Threads that raced away join deletedIds instead: their rows must leave
// the view, and an absent summary cannot be shipped.
async function readChangedThreads(
  gmail: GmailClient,
  threadIds: string[]
): Promise<{ threads: ThreadSynced[]; deletedThreadIds: string[] }> {
  const deletedThreadIds: string[] = []
  const rows = await mapWithConcurrency(threadIds, DETAIL_CONCURRENCY, async (id) => {
    try {
      const thread = await withQuotaRetry(() =>
        gmail.users.threads.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        })
      )
      return toSyncedRow(thread.data)
    } catch (e) {
      if (!isNotFoundError(e)) throw e
      deletedThreadIds.push(id)
      return null
    }
  })
  return {
    threads: rows.filter((row): row is ThreadSynced => row !== null),
    deletedThreadIds
  }
}

function toSyncedRow(thread: gmail_v1.Schema$Thread): ThreadSynced {
  // The label set is the union across the thread's messages, flattened
  // here exactly like unread and starred are: the renderer reads
  // membership from this set, never from raw message labelIds again.
  const labelIds = new Set<string>()
  for (const message of thread.messages ?? []) {
    for (const id of message.labelIds ?? []) labelIds.add(id)
  }
  return { ...threadToSummary(thread), labelIds: [...labelIds] }
}

async function runSync(): Promise<SyncResult> {
  const gmail = getGmailClient()
  const start = cursor
  if (start === null) return { kind: 'reset' }

  let changed: string[]
  try {
    changed = await sweepChangedThreads(gmail)
  } catch (e) {
    // An out-of-date startHistoryId comes back as HTTP 404 once Google
    // has expired the cursor (a week-scale horizon); the API's answer to
    // a dead cursor is a full sync. The cursor dies here and the next
    // full fold re-earns it.
    if (isNotFoundError(e)) {
      cursor = null
      return { kind: 'reset' }
    }
    throw e
  }
  if (changed.length === 0) {
    return { kind: 'delta', historyId: cursor ?? start, threads: [], deletedThreadIds: [] }
  }

  const { threads, deletedThreadIds } = await readChangedThreads(gmail, changed)
  return { kind: 'delta', historyId: cursor ?? start, threads, deletedThreadIds }
}

// Consecutive failed sweeps back the next one off, so a dead network or
// a quota drought tries at 1, 2, 4... times the settled cadence instead
// of hammering; one success clears the streak.
let errorStreak = 0

const SWEEP_SETTLED_MS = 30_000
// With no window on screen no view is waiting for the result; a hidden
// sweep stays at the slow cadence and window focus re-syncs immediately.
const SWEEP_HIDDEN_MS = 120_000
const SWEEP_FAILED_MAX_MS = 10 * 60_000

function nextSweepDelay(): number {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
  if (!windows.some((window) => window.isVisible())) return SWEEP_HIDDEN_MS
  if (errorStreak > 0) {
    return Math.min(SWEEP_FAILED_MAX_MS, SWEEP_SETTLED_MS * 2 ** errorStreak)
  }
  return SWEEP_SETTLED_MS
}

let sweepTimer: NodeJS.Timeout | null = null

function scheduleNextSweep(): void {
  if (sweepTimer) clearTimeout(sweepTimer)
  sweepTimer = setTimeout(() => {
    void syncMail('clock').catch(() => {
      // The failure is already counted for the backoff; a background
      // sweep with no awaiting caller has no error line to speak to.
    })
  }, nextSweepDelay())
  sweepTimer.unref?.()
}

export function armSyncClock(): void {
  scheduleNextSweep()
}

function pushResult(result: SyncResult): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('gmail:sync-result', result)
  }
}

let inFlight: Promise<SyncResult> | null = null

export function syncMail(reason: SyncReason): Promise<SyncResult> {
  // In-flight coalescing: a click or tick colliding with a running sweep
  // joins its promise, so no refresh queues a second call and none is
  // silently swallowed — every caller observes the sweep's true outcome.
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const result = await runSync()
      errorStreak = 0
      return result
    } catch (e) {
      errorStreak++
      throw e
    } finally {
      inFlight = null
      scheduleNextSweep()
    }
  })()
  // A button-initiated sweep answers its awaiting caller directly; every
  // other reason has no awaiting caller and must push to the windows.
  if (reason !== 'button') void inFlight.then(pushResult).catch(() => {})
  return inFlight
}
