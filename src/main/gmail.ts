import { getGmailClient } from './auth'
import type { gmail_v1 } from 'googleapis'
import type { EmailSummary, EmailDetail } from '../shared/types'

function decodeBody(data?: string | null): string {
  if (!data) return ''
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64').toString('utf-8')
}

function collectBodies(
  part: gmail_v1.Schema$MessagePart,
  out: { text: string; html: string }
): void {
  const mime = part.mimeType ?? ''
  if (mime === 'text/plain' && !out.text) out.text = decodeBody(part.body?.data)
  if (mime === 'text/html' && !out.html) out.html = decodeBody(part.body?.data)
  for (const p of part.parts ?? []) collectBodies(p, out)
}

export async function fetchMessage(id: string): Promise<EmailDetail> {
  const gmail = getGmailClient()
  const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
  const headers = msg.data.payload?.headers ?? []
  const header = (name: string): string =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

  const out = { text: '', html: '' }
  if (msg.data.payload) collectBodies(msg.data.payload, out)
  if (!out.text && !out.html) out.text = decodeBody(msg.data.payload?.body?.data)

  return {
    id,
    from: header('From'),
    subject: header('Subject') || '(no subject)',
    date: header('Date'),
    snippet: msg.data.snippet ?? '',
    bodyText: out.text,
    bodyHtml: out.html
  }
}

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
