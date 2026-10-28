import { FOLDER_LABEL_ID } from '../../../shared/sync'
import type { MailSyncDelta } from '../../../shared/sync'
import type { MailFolder, ThreadSummary } from '../../../shared/types'

// List-merge logic shared by every load path: folding a fresh first page
// (mergeIncoming) and applying a sync sweep's delta (applyMailDelta) both
// keep dropped rows in view where needed and compare rows value by value.

// Every field the row renders, compared value by value: a sweep supplies
// freshly built row objects, so reference equality would trigger a
// re-render even when nothing changed.
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

// Folds a fresh first page into the list on screen. The incoming page owns
// order and content; rows it no longer returns keep their previous shape
// at the tail. Whether the tail keeps every row (a background fold, so a
// sync never collapses loaded pages or closes the open email) or only the
// selected row (manual refresh, which shows server truth but must not
// yank away the message being read) is `keepAllDropped`.
export function mergeIncoming(
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

// The label id a view lists through: a user-label view lists through its
// label, a folder view through the folder's system label. Query-defined
// views (All Mail, Drafts, Snoozed) list no single label and return null.
export function viewLabelOf(folder: MailFolder, userLabelId: string | null): string | null {
  if (userLabelId) return userLabelId
  return FOLDER_LABEL_ID[folder] ?? null
}

export interface DeltaView {
  labelId: string
  isSearchActive: boolean
}

// Applies one sweep's delta to the rows on screen and answers the next
// list, or null when nothing changed (so the caller can skip the state
// write). The sweep's thread rows carry the threads' current label sets,
// the same membership truth a full first-page fold is filtered by:
//
// - rows the sweep saw vanish leave the list (the open email itself is
//   not closed; keeping it on screen is the archive behavior too);
// - a changed row that no longer carries the view's label has left the
//   view and is dropped;
// - a changed row that stays a member updates in place, value-compared;
// - a changed member with no row yet enters at the top, the fresh mail
//   position — unless the list is server-search results, which sort by
//   query relevance the delta neither knows nor claims.
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
    // History pages arrive oldest first; the fresh rows enter newest
    // first, the position new mail reads from. The push's array is not
    // the renderer's to mutate, so the order flip copies.
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
