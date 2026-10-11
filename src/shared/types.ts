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
  bodyHtml?: string
  bodyText?: string
}
