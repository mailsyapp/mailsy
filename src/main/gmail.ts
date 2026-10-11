import { getGmailClient } from './auth'
import type { EmailSummary } from '../shared/types'

export async function fetchInbox(count = 10): Promise<EmailSummary[]> {
  const gmail = getGmailClient()

  // 1) list returns only message IDs
  const list = await gmail.users.messages.list({
    userId: 'me',
    labelIds: ['INBOX'],
    maxResults: count
  })
  const ids = (list.data.messages ?? []).flatMap((m) => (m.id ? [m.id] : []))

  // 2) fetch details for each ID, all in parallel
  return Promise.all(
    ids.map(async (id): Promise<EmailSummary> => {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date']
      })
      const headers = msg.data.payload?.headers ?? []
      const header = (name: string): string =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

      return {
        id,
        from: header('From'),
        subject: header('Subject') || '(no subject)',
        date: header('Date'),
        snippet: msg.data.snippet ?? ''
      }
    })
  )
}