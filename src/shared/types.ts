export interface EmailSummary {
  id: string
  threadId: string
  from: string
  subject: string
  date: string
  snippet: string
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
}

export type MailFolder = 'inbox' | 'drafts' | 'sent' | 'trash'

export interface ListFolderOptions {
  maxResults?: number
  pageToken?: string | null
  q?: string
  folder?: MailFolder
}

export interface MailPage {
  emails: EmailSummary[]
  nextPageToken: string | null
}

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
