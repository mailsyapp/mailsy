import { FOLDER_LABEL_ID } from '../../../shared/sync'
import type { MailSyncDelta } from '../../../shared/sync'
import type { MailFolder, ThreadSummary } from '../../../shared/types'
export function listRowKey(row: Pick<ThreadSummary, 'id' | 'draftId'>): string {
  return row.draftId ? `draft:${row.draftId}` : `thread:${row.id}`
}
export function rowsEqual(a: ThreadSummary, b: ThreadSummary): boolean {
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
export function mergeIncoming(
  prev: ThreadSummary[],
  incoming: ThreadSummary[],
  keepAllDropped: boolean,
  selectedKey: string | null
): ThreadSummary[] {
  if (prev.length === incoming.length && prev.every((row, i) => rowsEqual(row, incoming[i]))) {
    return prev
  }
  const incomingKeys = new Set(incoming.map(listRowKey))
  const dropped = prev.filter((row) => !incomingKeys.has(listRowKey(row)))
  const tail = keepAllDropped ? dropped : dropped.filter((row) => listRowKey(row) === selectedKey)
  return [...incoming, ...tail]
}
export function viewLabelOf(folder: MailFolder, userLabelId: string | null): string | null {
  if (userLabelId) return userLabelId
  return FOLDER_LABEL_ID[folder] ?? null
}
export interface DeltaView {
  labelId: string
  isSearchActive: boolean
}
export function applyMailDelta(
  rows: ThreadSummary[],
  delta: MailSyncDelta,
  view: DeltaView
): ThreadSummary[] | null {
  const deleted = new Set(delta.deletedThreadIds)
  const changed = new Map(delta.threads.map((row) => [row.id, row]))
  let mutated = false
  const kept: ThreadSummary[] = []
  for (const row of rows) {
    if (deleted.has(row.id)) {
      mutated = true
      continue
    }
    const latest = changed.get(row.id)
    if (!latest) {
      kept.push(row)
      continue
    }
    changed.delete(row.id)
    if (!latest.labelIds.includes(view.labelId)) {
      mutated = true
      continue
    }
    if (rowsEqual(row, latest)) {
      kept.push(row)
    } else {
      mutated = true
      kept.push(latest)
    }
  }
  if (!view.isSearchActive) {
    const entering = [...delta.threads]
      .reverse()
      .filter(
        (row) =>
          row.labelIds.includes(view.labelId) && !kept.some((existing) => existing.id === row.id)
      )
    if (entering.length > 0) {
      mutated = true
      kept.unshift(...entering)
    }
  }
  return mutated ? kept : null
}
