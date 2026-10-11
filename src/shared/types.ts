export interface EmailSummary {
  id: string
  from: string
  subject: string
  date: string
  snippet: string
}

export interface EmailDetail extends EmailSummary {
  bodyHtml?: string
  bodyText?: string
}
