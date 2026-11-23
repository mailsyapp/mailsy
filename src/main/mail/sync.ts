import { BrowserWindow } from 'electron'
import { getGmailClient, isSignedIn, onSessionEnded } from '../auth'
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

let cursor: string | null = null
let pendingSeed: string | null = null

function isLaterId(a: string, b: string): boolean {
  return a.length > b.length || (a.length === b.length && a > b)
}

export function noteHistoryId(id: string | number | undefined | null): void {
  if (cursor !== null || id == null || id === '') return
  const next = String(id)
  if (pendingSeed === null || isLaterId(next, pendingSeed)) pendingSeed = next
}

onSessionEnded(() => {
  cursor = null
  pendingSeed = null
  errorStreak = 0
})

function isDraftChurn(labelIds: string[] | null | undefined): boolean {
  return labelIds !== null && labelIds !== undefined && labelIds.join() === 'DRAFT'
}

async function sweepChangedThreads(
  gmail: GmailClient
): Promise<{ changed: string[]; readThrough: string | null }> {
  const start = cursor
  if (start === null) return { changed: [], readThrough: null }

  const changed = new Set<string>()
  const note = (threadId: string | null | undefined): void => {
    if (threadId) changed.add(threadId)
  }
  let readThrough: string | null = null
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
    const id = page.data.historyId == null ? null : String(page.data.historyId)
    if (id && (readThrough === null || isLaterId(id, readThrough))) readThrough = id
    pageToken = page.data.nextPageToken ?? undefined
    if (!pageToken) return { changed: [...changed], readThrough }
  }
}

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
  const labelIds = new Set<string>()
  for (const message of thread.messages ?? []) {
    for (const id of message.labelIds ?? []) labelIds.add(id)
  }
  return { ...threadToSummary(thread), labelIds: [...labelIds] }
}

async function runSync(): Promise<SyncResult> {
  const gmail = getGmailClient()
  const start = cursor
  if (start === null) {
    if (pendingSeed !== null) cursor = pendingSeed
    pendingSeed = null
    return { kind: 'reset' }
  }

  let changed: string[]
  let readThrough: string | null = null
  try {
    const sweep = await sweepChangedThreads(gmail)
    changed = sweep.changed
    readThrough = sweep.readThrough
  } catch (e) {
    if (isNotFoundError(e)) {
      cursor = null
      return { kind: 'reset' }
    }
    throw e
  }
  if (changed.length === 0) {
    commitReadThrough(readThrough)
    return { kind: 'delta', historyId: cursor ?? start, threads: [], deletedThreadIds: [] }
  }

  const { threads, deletedThreadIds } = await readChangedThreads(gmail, changed)
  commitReadThrough(readThrough)
  return { kind: 'delta', historyId: cursor ?? start, threads, deletedThreadIds }
}

function commitReadThrough(id: string | null): void {
  if (id === null) return
  if (cursor === null || isLaterId(id, cursor)) cursor = id
}

let errorStreak = 0

const SWEEP_SETTLED_MS = 30_000
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
    void syncMail('clock').catch(() => {})
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
  if (!isSignedIn()) return Promise.resolve({ kind: 'reset' })

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
  if (reason !== 'button') void inFlight.then(pushResult).catch(() => {})
  return inFlight
}
