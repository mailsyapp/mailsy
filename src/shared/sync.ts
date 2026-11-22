import type { MailFolder, ThreadSummary } from './types'

export type SyncReason = 'button' | 'clock' | 'focus'

export interface MailSyncDelta {
  kind: 'delta'
  historyId: string
  threads: ThreadSynced[]
  deletedThreadIds: string[]
}

export interface ThreadSynced extends ThreadSummary {
  labelIds: string[]
}

export interface MailSyncReset {
  kind: 'reset'
}

export type SyncResult = MailSyncDelta | MailSyncReset

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
