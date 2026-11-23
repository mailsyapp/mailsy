export interface OAuthCredentials {
  clientId: string
  clientSecret: string
}
export interface OAuthCredentialsStatus {
  configured: boolean
  source: 'built-in' | 'stored' | null
}
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
  attachments: MessageAttachmentRef[]
}
export interface EmailThread {
  id: string
  messages: EmailDetail[]
  labelIds: string[]
  userEmail: string
}
export type MailFolder =
  | 'all'
  | 'drafts'
  | 'forums'
  | 'important'
  | 'inbox'
  | 'label'
  | 'promotions'
  | 'sent'
  | 'social'
  | 'snoozed'
  | 'spam'
  | 'starred'
  | 'trash'
  | 'updates'
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
  hasDraft?: boolean
  snoozedByMailsy?: boolean
}
export interface ListFolderOptions {
  maxResults?: number
  pageToken?: string | null
  skipRowIds?: string[]
  q?: string
  folder?: MailFolder
  userLabelId?: string
}
export interface ThreadPage {
  threads: ThreadSummary[]
  nextPageToken: string | null
}
export interface MailLabel {
  id: string
  name: string
  type: 'user' | 'system'
  color: {
    background: string
    text: string
  } | null
  messagesTotal: number
  threadsTotal: number
}
export const SESSION_EXPIRED_ERROR = 'Your Google session has expired. Sign in again.'
export interface RecipientLines {
  to?: string
  cc?: string
  bcc?: string
}
export type RecipientState = Required<RecipientLines>
export function hasRecipient({ to, cc, bcc }: RecipientLines): boolean {
  return Boolean(to?.trim() || cc?.trim() || bcc?.trim())
}
export interface ComposeAttachment {
  filename: string
  size: number
  data: string
}
export interface MessageAttachmentRef {
  filename: string
  size: number
  attachmentId: string
}
export const ATTACHMENTS_TOTAL_LIMIT_BYTES = 20 * 1024 * 1024
export function decodedAttachmentBytes(attachment: ComposeAttachment): number {
  return Math.floor(attachment.data.length * 0.75)
}
export function attachmentsLimitError(totalBytes: number): string {
  return `Attachments are too large to send (${Math.floor(totalBytes / (1024 * 1024))} MB). Gmail's limit is 25 MB per message.`
}
export interface ComposeBody {
  text: string
  html: string
}
export interface ComposeRequestFields {
  recipients: RecipientState
  subject: string
  body: ComposeBody
  attachments?: ComposeAttachment[]
  thread?: Pick<SendEmailRequest, 'threadId' | 'inReplyTo' | 'references'>
}
export function composeRequest(fields: ComposeRequestFields): SendEmailRequest {
  const { recipients, subject, body, attachments, thread } = fields
  return {
    ...recipients,
    subject,
    body: body.text,
    ...(body.html ? { bodyHtml: body.html } : {}),
    ...(attachments?.length ? { attachments } : {}),
    ...(thread?.threadId ? { threadId: thread.threadId } : {}),
    ...(thread?.inReplyTo ? { inReplyTo: thread.inReplyTo } : {}),
    ...(thread?.references ? { references: thread.references } : {})
  }
}
export interface SendEmailRequest {
  to: string
  cc?: string
  bcc?: string
  subject: string
  body: string
  bodyHtml?: string
  threadId?: string
  inReplyTo?: string
  references?: string
  attachments?: ComposeAttachment[]
}
export interface SendDraftRequest extends SendEmailRequest {
  draftId: string
  expectedMessageId?: string
}
export interface SaveDraftRequest extends SendEmailRequest {
  draftId?: string
  expectedMessageId?: string
  copyOnConflict?: boolean
  retainAttachments?: { messageId: string; refs: MessageAttachmentRef[] }
}
export interface DraftVersion {
  draftId: string
  messageId: string
}

export type SaveDraftResult = {
  draftId: string
  previousMessageId?: string
  retainedAttachments: { previousAttachmentId: string; ref: MessageAttachmentRef }[]
} & ({ messageId: string; refsStale?: false } | { messageId?: string; refsStale: true })

export interface ModifyLabelsRequest {
  kind: 'message' | 'thread'
  id: string
  addLabelIds?: string[]
  removeLabelIds?: string[]
}
