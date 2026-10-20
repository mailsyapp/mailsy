// Read state is Gmail's absence or presence of the UNREAD label, flattened
// to a boolean where the summary is built so the renderer never parses
// labelIds itself.
export interface EmailSummary {
  id: string
  threadId: string
  from: string
  subject: string
  date: string
  snippet: string
  unread: boolean
  starred: boolean
  draftId?: string
}
export interface EmailDetail extends EmailSummary {
  to: string
  cc: string
  bcc: string
  replyTo: string
  messageId: string
  inReplyTo: string
  references: string
  bodyHtml?: string
  bodyText?: string
}

export interface EmailThread {
  id: string
  messages: EmailDetail[]
  // The signed-in account's address, the exclusion set for reply-all.
  // An empty string (profile fetch failed) degrades reply-all to "exclude
  // nothing" instead of failing the open.
  userEmail: string
}

export type MailFolder = 'all' | 'drafts' | 'inbox' | 'sent' | 'spam' | 'starred' | 'trash'

// One list row per Gmail conversation. Row actions are thread-level, so the
// row carries the thread id and aggregate label state; message ids stay on
// the row for body fetches and draft sends. Subject and dates come from the
// thread's messages and are flattened here like unread/starred above.
export interface ThreadSummary {
  id: string
  subject: string
  snippet: string
  participants: string[]
  date: string
  messageIds: string[]
  unreadCount: number
  starred: boolean
  draftId?: string
  // Set when any message in the thread carries DRAFT. Folder views that
  // exclude drafts never read it; All Mail uses it to route a click into
  // the draft editor instead of the read-only detail.
  hasDraft?: boolean
}

export interface ListFolderOptions {
  maxResults?: number
  pageToken?: string | null
  q?: string
  folder?: MailFolder
}

export interface ThreadPage {
  threads: ThreadSummary[]
  nextPageToken: string | null
}

// The sentence main rewrites dead-grant failures to. The renderer matches on
// it to drop back to the sign-in screen, so both sides share one constant.
export const SESSION_EXPIRED_ERROR = 'Your Google session has expired. Sign in again.'

export interface SendEmailRequest {
  to: string
  subject: string
  body: string
  bodyHtml?: string
  threadId?: string
  inReplyTo?: string
  references?: string
}

// A draft send is exactly a normal send plus the draft to consume; keeping
// it as an extension makes the field sets identical by construction.
export interface SendDraftRequest extends SendEmailRequest {
  draftId: string
}

export interface ModifyLabelsRequest {
  kind: 'message' | 'thread'
  id: string
  addLabelIds?: string[]
  removeLabelIds?: string[]
}
