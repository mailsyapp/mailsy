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
  // The thread's raw label ids, deduped across its messages: the renderer
  // reads label membership from this intersection with the user labels it
  // already holds, never parsed out of message labelIds again.
  labelIds: string[]
  // The signed-in account's address, the exclusion set for reply-all.
  // An empty string (profile fetch failed) degrades reply-all to "exclude
  // nothing" instead of failing the open.
  userEmail: string
}

export type MailFolder =
  | 'all'
  | 'drafts'
  | 'forums'
  | 'important'
  | 'inbox'
  // A user-label view: every list paragraph is the folder plumbing, but the
  // label filter arrives as ListFolderOptions.userLabelId.
  | 'label'
  | 'promotions'
  | 'sent'
  | 'social'
  | 'snoozed'
  | 'spam'
  | 'starred'
  | 'trash'
  | 'updates'

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
  // The thread carries Mailsy's parking label ('Snoozed by Mailsy'), so its
  // unsnooze is the full restore pair (INBOX add plus label removal and a
  // schedule-record clear). Native-parked threads keep the plain INBOX add.
  snoozedByMailsy?: boolean
}

export interface ListFolderOptions {
  maxResults?: number
  pageToken?: string | null
  q?: string
  folder?: MailFolder
  // A user-label view lists through its label id instead of a folder's
  // system-label filter; folder then carries the shared label-view plumbing.
  userLabelId?: string
}

export interface ThreadPage {
  threads: ThreadSummary[]
  nextPageToken: string | null
}

// One row of Gmail's label section, flattened at the boundary like the mail
// summaries above. ids and names travel together (threads.modify and
// labels.delete need the id; the rail shows the name), type separates the
// user labels the rail owns from Gmail's system labels, and totals float
// exactly what labels.list reports.
export interface MailLabel {
  id: string
  name: string
  type: 'user' | 'system'
  color: { background: string; text: string } | null
  messagesTotal: number
  threadsTotal: number
}

// The sentence main rewrites dead-grant failures to. The renderer matches on
// it to drop back to the sign-in screen, so both sides share one constant.
export const SESSION_EXPIRED_ERROR = 'Your Google session has expired. Sign in again.'

export interface SendEmailRequest {
  to: string
  // Optional carbon lists in the same comma-separated address-line shape as
  // `to`, so one representation rides through composer state, draft autosave,
  // send payload, and the headers main emits. Bcc recipients reach Gmail in
  // the raw message (which strips the header on delivery), and reply
  // derivation never writes a Bcc the user did not type.
  cc?: string
  bcc?: string
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

// One composer autosave write. Same field set as a send, but the recipient
// is optional (Gmail keeps recipient-less drafts) and the target draft is
// optional: absent means create one. The resolved draft id comes back, so
// the autosave and the send path stay pinned to the same server draft.
export interface SaveDraftRequest extends SendEmailRequest {
  draftId?: string
}

export interface ModifyLabelsRequest {
  kind: 'message' | 'thread'
  id: string
  addLabelIds?: string[]
  removeLabelIds?: string[]
}
