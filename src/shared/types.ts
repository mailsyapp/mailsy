export interface EmailSummary {
  id: string
  threadId: string
  from: string
  subject: string
  date: string
  snippet: string
}

export interface EmailDetail extends EmailSummary {
  to: string
  cc: string
  bcc: string
  replyTo: string
  messageId: string
  references: string
  bodyHtml?: string
  bodyText?: string
}

export interface EmailThread {
  id: string
  messages: EmailDetail[]
}

export interface FetchInboxOptions {
  maxResults?: number
  pageToken?: string | null
}

export interface InboxPage {
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
