import type { gmail_v1 } from 'googleapis'
import type { GmailClient } from '../auth'
import type { EmailDetail, EmailSummary, ThreadSummary } from '../../shared/types'
import { collectBodies, decodeBody, normalizeContentId, base64UrlToBuffer } from './mime'
import type { MessageBodies } from './mime'

function headerOf(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

export async function toEmailDetail(
  gmail: GmailClient,
  msg: gmail_v1.Schema$Message
): Promise<EmailDetail> {
  const id = msg.id ?? ''
  const headers = msg.payload?.headers ?? []

  const out: MessageBodies = {
    text: '',
    html: '',
    inlineImages: []
  }
  if (msg.payload) collectBodies(msg.payload, out)
  if (!out.text && !out.html) out.text = decodeBody(msg.payload?.body?.data)

  const inlineImageData = new Map<string, string>()
  await Promise.all(
    out.inlineImages.map(async ({ contentId, mimeType, data, attachmentId }) => {
      const encodedData =
        data ||
        (attachmentId
          ? (
              await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId: id,
                id: attachmentId
              })
            ).data.data
          : undefined)
      if (!encodedData) return
      const base64Data = base64UrlToBuffer(encodedData).toString('base64')
      inlineImageData.set(normalizeContentId(contentId), `data:${mimeType};base64,${base64Data}`)
    })
  )

  const bodyHtml = out.html.replace(/cid:([^"'\s<>()]+)/gi, (reference, contentId: string) => {
    return inlineImageData.get(normalizeContentId(contentId)) ?? reference
  })

  return {
    id,
    from: headerOf(headers, 'From'),
    to: headerOf(headers, 'To'),
    cc: headerOf(headers, 'Cc'),
    bcc: headerOf(headers, 'Bcc'),
    replyTo: headerOf(headers, 'Reply-To'),
    threadId: msg.threadId ?? '',
    messageId: headerOf(headers, 'Message-ID'),
    inReplyTo: headerOf(headers, 'In-Reply-To'),
    references: headerOf(headers, 'References'),
    subject: headerOf(headers, 'Subject') || '(no subject)',
    date: headerOf(headers, 'Date'),
    snippet: msg.snippet ?? '',
    unread: (msg.labelIds ?? []).includes('UNREAD'),
    starred: (msg.labelIds ?? []).includes('STARRED'),
    bodyText: out.text,
    bodyHtml
  }
}

export function toEmailSummary(
  id: string,
  msg: gmail_v1.Schema$Message,
  draftId?: string
): EmailSummary {
  const headers = msg.payload?.headers ?? []

  return {
    id,
    threadId: msg.threadId ?? '',
    from: headerOf(headers, 'From'),
    subject: headerOf(headers, 'Subject') || '(no subject)',
    date: headerOf(headers, 'Date'),
    snippet: msg.snippet ?? '',
    unread: (msg.labelIds ?? []).includes('UNREAD'),
    starred: (msg.labelIds ?? []).includes('STARRED'),
    ...(draftId ? { draftId } : {})
  }
}

// A list row is a conversation, not a message: Gmail's row shows the thread's
// original subject, the distinct senders, and the unread/starred state the
// whole thread carries. These are flattened here so the renderer never reads
// Gmail's labelIds or message array itself. The optional snooze label id is
// the fetch layer's resolved id for Mailsy's parking label; when given, its
// presence on any message flattens to snoozedByMailsy like the counts above.
export function threadToSummary(
  thread: gmail_v1.Schema$Thread,
  snoozeLabelId?: string
): ThreadSummary {
  const messages = thread.messages ?? []
  const first = messages[0] ?? {}
  const last = messages[messages.length - 1] ?? {}
  const headersOf = (m: gmail_v1.Schema$Message): gmail_v1.Schema$MessagePartHeader[] =>
    m.payload?.headers ?? []

  const participants: string[] = []
  for (const message of messages) {
    const from = headerOf(headersOf(message), 'From')
    if (from && !participants.includes(from)) participants.push(from)
  }

  const id = thread.id ?? ''
  const ids = messages.map((m) => m.id ?? '').filter((value) => value.trim())
  return {
    id,
    subject:
      headerOf(headersOf(first), 'Subject') ||
      headerOf(headersOf(last), 'Subject') ||
      '(no subject)',
    snippet: last.snippet ?? thread.snippet ?? '',
    participants,
    date: headerOf(headersOf(last), 'Date'),
    messageIds: ids,
    unreadCount: messages.filter((m) => (m.labelIds ?? []).includes('UNREAD')).length,
    starred: messages.some((m) => (m.labelIds ?? []).includes('STARRED')),
    hasDraft: messages.some((m) => (m.labelIds ?? []).includes('DRAFT')),
    ...(snoozeLabelId && messages.some((m) => (m.labelIds ?? []).includes(snoozeLabelId))
      ? { snoozedByMailsy: true }
      : {})
  }
}
