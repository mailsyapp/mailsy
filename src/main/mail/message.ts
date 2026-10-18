import type { gmail_v1 } from 'googleapis'
import type { GmailClient } from '../auth'
import type { EmailDetail, EmailSummary } from '../../shared/types'
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
    ...(draftId ? { draftId } : {})
  }
}
