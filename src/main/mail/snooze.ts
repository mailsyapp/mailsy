import { app } from 'electron'
import { join } from 'path'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import type { GmailClient } from '../auth'
import { getGmailClient } from '../auth'
import { createUserLabelByName, findUserLabelByName } from './labels'
import { modifyLabels } from './modify'
import { isNotFoundError } from './resilience'

export const SNOOZE_LABEL_NAME = 'Snoozed by Mailsy'

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
    renameSync(tmp, path)
  } catch (e) {
    console.warn('snooze schedule write failed:', e)
  }
}

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
  const existing = await findUserLabelByName(gmail, SNOOZE_LABEL_NAME)
  if (existing?.id) return existing.id
  if (!createIfMissing) return null
  const created = await createUserLabelByName(gmail, SNOOZE_LABEL_NAME)
  if (!created.id) throw new Error('Gmail did not return an id for the snooze label')
  return created.id
}

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
  setSnoozed(threadId, restoreAt)
  armNextWake()
  await modifyLabels({
    kind: 'thread',
    id: threadId,
    addLabelIds: [labelId],
    removeLabelIds: ['INBOX']
  })
}

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
  armNextWake()
  return restored
}
