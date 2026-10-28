import type { MailFolder, ThreadSummary } from './types'

// Why a refresh ran. The renderer passes 'button'; main passes 'clock'
// (the adaptive background sweep) and 'focus' (window regained focus).
export type SyncReason = 'button' | 'clock' | 'focus'

// One sweep's answer, the whole contract between main's sync and every
// renderer view. 'reset' means main holds no usable history cursor (one
// was never earned, or Google expired it, a week-scale horizon); the view
// reconciles by folding in a full first page again. 'delta' carries every
// thread the mailbox moved since the last cursor, so a view applies the
// few rows it names instead of re-fetching a page per sweep. Threads
// whose only change was DRAFT churn are absent, matching the views the
// sweep argues about.
export interface MailSyncDelta {
  kind: 'delta'
  // The cursor this sweep applied; the next sweep starts from it.
  historyId: string
  threads: ThreadSynced[]
  // Threads that no longer exist in the mailbox; rows leave every list.
  // Ship only the ids here: an absent row has no summary to flatten.
  deletedThreadIds: string[]
}

// A swept thread: the boundary's flat list row plus the thread's current
// Gmail label set, the membership truth every view's delta filter reads
// (a row that now carries INBOX belongs in the Inbox view; one that has
// lost it has left). Flattened in main like unread and starred, so the
// renderer reads membership from the set, never from raw message
// labelIds again.
export interface ThreadSynced extends ThreadSummary {
  labelIds: string[]
}

export interface MailSyncReset {
  kind: 'reset'
}

export type SyncResult = MailSyncDelta | MailSyncReset

// The label filter each folder view lists through, shared because both
// sides judge deltas by it: main's folder table keeps its own listing
// spec, and the delta applier in the renderer reads this table to
// translate "the current view" into the one label id a transition argues
// about. Query-defined views (All Mail, Drafts, Snoozed) have no single
// label, so they are absent and treat every delta as a reset.
export const FOLDER_LABEL_ID: Partial<
  Record<Exclude<MailFolder, 'drafts' | 'snoozed' | 'all'>, string>
> = {
  inbox: 'INBOX',
  sent: 'SENT',
  trash: 'TRASH',
  spam: 'SPAM',
  starred: 'STARRED',
  important: 'IMPORTANT',
  social: 'CATEGORY_SOCIAL',
  promotions: 'CATEGORY_PROMOTIONS',
  updates: 'CATEGORY_UPDATES',
  forums: 'CATEGORY_FORUMS'
}
