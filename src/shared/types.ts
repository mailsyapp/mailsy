export interface EmailSummary {
  id: string
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
  threadId: string
  messageId: string
  references: string
  bodyHtml?: string
  bodyText?: string
}

export interface SendEmailRequest {
  to: string
  subject: string
  body: string
  threadId?: string
  inReplyTo?: string
  references?: string
}
