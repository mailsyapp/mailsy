import { app } from 'electron'
import { join } from 'path'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import type { GmailClient } from '../auth'
import { getGmailClient } from '../auth'
import { modifyLabels } from './modify'
import { isNotFoundError, withQuotaRetry } from './resilience'

// Gmail's REST API cannot write its own SNOOZED state (400 "Invalid label"),
// so Mailsy's snooze is the mover pattern every real client converges on:
// a user label plus INBOX removal, restored on the client's own schedule.
// The caveat that buys this is Mailspring's honest one: while the app is
// closed nobody sweeps, so mail parked before a wake time returns on the
// next launch.

export const SNOOZE_LABEL_NAME = 'Snoozed by Mailsy'

// threadId -> restoreAt epoch ms. The persisted record is the schedule of
// record, so a crash mid-write is tolerated as a delayed wake (the label
// stays on the mail, discoverable in the Snoozed view) rather than retried.
type SnoozeSchedule = Map<string, number>

const MAX_TIMEOUT_MS = 2 ** 31 - 1

let schedule: SnoozeSchedule | null = null
let wakeTimer: NodeJS.Timeout | null = null

function getSchedule(): SnoozeSchedule {
  if (schedule) return schedule
  try {
    const parsed = JSON.parse(readFileSync(storePath(), 'utf8')) as Record<string, unknown>
    schedule = new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'number' && Number.isFinite(entry[1])
      )
    )
  } catch {
    schedule = new Map()
  }
  return schedule
}

function storePath(): string {
  return join(app.getPath('userData'), 'snooze-schedules.json')
}

function persist(next: SnoozeSchedule): void {
  schedule = next
  try {
    const path = storePath()
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(next)))
    // Same-volume rename commits the whole file or nothing, so a crash
    // cannot leave a truncated schedule behind.
    renameSync(tmp, path)
  } catch (e) {
    console.warn('snooze schedule write failed:', e)
  }
}

// The parking state is a user label, so its id is resolved through the labels
// API (ids are not assumed to be the name). createIfMissing is the write path
// only: reads never create mailbox state, and a read resolving to nothing
// answers null.
export async function resolveSnoozeLabelId(
  gmail: GmailClient,
  createIfMissing: true
): Promise<string>
export async function resolveSnoozeLabelId(
  gmail: GmailClient,
  createIfMissing: false
): Promise<string | null>
export async function resolveSnoozeLabelId(
  gmail: GmailClient,
  createIfMissing: boolean
): Promise<string | null> {
  const list = await withQuotaRetry(() => gmail.users.labels.list({ userId: 'me' }))
  const existing = (list.data.labels ?? []).find(
    (label) => label.type === 'user' && label.name === SNOOZE_LABEL_NAME
  )
  if (existing?.id) return existing.id
  if (!createIfMissing) return null
  const created = await withQuotaRetry(() =>
    gmail.users.labels.create({ userId: 'me', requestBody: { name: SNOOZE_LABEL_NAME } })
  )
  if (!created.data.id) throw new Error('Gmail did not return an id for the snooze label')
  return created.data.id
}

// Charges the soonest due record to a timeout so a parked thread returns
// even when the window sits untouched. The renderer's tick and the startup
// catch-up funnel through sweepDueSnoozed() as well; every path is
// idempotent, so all three can race safely.
function armNextWake(): void {
  if (wakeTimer) clearTimeout(wakeTimer)
  const next = Math.min(...getSchedule().values())
  if (next === Infinity) {
    wakeTimer = null
    return
  }
  const delay = Math.min(Math.max(next - Date.now(), 0), MAX_TIMEOUT_MS)
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    void sweepDueSnoozed().catch((e) => console.warn('snooze sweep failed:', e))
  }, delay)
}

function recall(threadId: string): void {
  if (!getSchedule().has(threadId)) return
  getSchedule().delete(threadId)
  persist(getSchedule())
}

function setSnoozed(threadId: string, restoreAt: number): void {
  getSchedule().set(threadId, restoreAt)
  persist(getSchedule())
}

export async function snoozeThread(threadId: string, restoreAt: number): Promise<void> {
  if (typeof threadId !== 'string' || !threadId.trim()) {
    throw new Error('Thread ID is required')
  }
  if (typeof restoreAt !== 'number' || !Number.isFinite(restoreAt) || restoreAt <= Date.now()) {
    throw new Error('Snooze wake time is required')
  }
  const gmail = getGmailClient()
  const labelId = await resolveSnoozeLabelId(gmail, true)
  // ONE threads.modify parks the thread: INBOX moves out and the parking
  // label moves in, which is the whole emulated snooze write.
  await modifyLabels({
    kind: 'thread',
    id: threadId,
    addLabelIds: [labelId],
    removeLabelIds: ['INBOX']
  })
  setSnoozed(threadId, restoreAt)
}

// The restore is the park's reverse pair, and the record leaves the
// schedule whether or not the mail still carries the label: a repeat
// restore lands on an already-restored thread, where the INBOX add and the
// label removal are both no-ops.
export async function restoreThread(threadId: string): Promise<void> {
  if (typeof threadId !== 'string' || !threadId.trim()) {
    throw new Error('Thread ID is required')
  }
  const gmail = getGmailClient()
  const labelId = await resolveSnoozeLabelId(gmail, false)
  await modifyLabels({
    kind: 'thread',
    id: threadId,
    addLabelIds: ['INBOX'],
    ...(labelId ? { removeLabelIds: [labelId] } : {})
  })
  recall(threadId)
}

// Restores every record whose wake time has passed. A vanished thread (404)
// drops out of the schedule instead of blocking the sweep forever; any other
// failure (quota, labels list) keeps its record for the next sweep. Returns
// the count of threads actually returned to the Inbox.
export async function sweepDueSnoozed(): Promise<number> {
  const now = Date.now()
  const due = [...getSchedule().entries()].filter(([, restoreAt]) => restoreAt <= now)
  let restored = 0
  for (const [threadId] of due) {
    try {
      await restoreThread(threadId)
      restored++
    } catch (e) {
      if (isNotFoundError(e)) recall(threadId)
      else console.warn(`snooze wake for ${threadId} deferred:`, e)
    }
  }
  // Every sweep ends armed, including the no-op ones at startup: the timer
  // for the soonest still-pending record is set exactly once here.
  armNextWake()
  return restored
}
