import type { Readable } from 'node:stream'
import { createTransport } from 'nodemailer'
import type { gmail_v1 } from 'googleapis'
import type { MessageAttachmentRef, SendEmailRequest } from '../../shared/types'

function toBuffer(message: Buffer | Readable): Promise<Buffer> {
  if (Buffer.isBuffer(message)) return Promise.resolve(message)

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    message.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    message.on('end', () => resolve(Buffer.concat(chunks)))
    message.on('error', reject)
  })
}

export function base64UrlToBuffer(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

export function decodeBody(data?: string | null): string {
  if (!data) return ''
  return base64UrlToBuffer(data).toString('utf-8')
}

export function normalizeContentId(contentId: string): string {
  let normalized = contentId.trim().replace(/^<|>$/g, '')
  try {
    normalized = decodeURIComponent(normalized)
  } catch (error) {
    if (!(error instanceof URIError)) throw error
  }
  return normalized.toLowerCase()
}

interface InlineImage {
  contentId: string
  mimeType: string
  data?: string | null
  attachmentId?: string | null
}

export interface MessageBodies {
  text: string
  html: string
  inlineImages: InlineImage[]
  // Named parts that are not cid-inline media: the content-less
  // attachment list a detail fetch reports. Sizes are the raw base64
  // payload sizes Gmail reports, and stop being exact after decoding, so
  // the UI labels them approximate.
  attachments: MessageAttachmentRef[]
}

export function collectBodies(part: gmail_v1.Schema$MessagePart, out: MessageBodies): void {
  const mime = part.mimeType ?? ''
  if (mime === 'text/plain' && !out.text) out.text = decodeBody(part.body?.data)
  if (mime === 'text/html' && !out.html) out.html = decodeBody(part.body?.data)
  // cid-referenced media is the body's own vocabulary, not a listed file;
  // any other named part with bytes is a content-less attachment ref.
  const inlineCid = mime.startsWith('image/')
    ? part.headers?.find((header) => header.name?.toLowerCase() === 'content-id')?.value
    : undefined
  if (inlineCid) {
    out.inlineImages.push({
      contentId: inlineCid,
      mimeType: mime,
      data: part.body?.data,
      attachmentId: part.body?.attachmentId
    })
  } else if (part.filename && part.body?.attachmentId) {
    out.attachments.push({
      filename: part.filename,
      size: part.body.size ?? 0,
      attachmentId: part.body.attachmentId
    })
  }
  for (const p of part.parts ?? []) collectBodies(p, out)
}

type RawMessageFields = Pick<
  SendEmailRequest,
  'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'bodyHtml' | 'inReplyTo' | 'references' | 'attachments'
>

export async function buildRawMessage(from: string, request: RawMessageFields): Promise<string> {
  const transport = createTransport({
    streamTransport: true,
    newline: 'unix'
  })
  const message = await transport.sendMail({
    from,
    to: request.to,
    // Carbon lists are plain header fields; the stream transport keeps the
    // Bcc header in the raw output and Gmail strips it before delivery.
    ...(request.cc ? { cc: request.cc } : {}),
    ...(request.bcc ? { bcc: request.bcc } : {}),
    subject: request.subject,
    text: request.body,
    ...(request.bodyHtml !== undefined ? { html: request.bodyHtml } : {}),
    ...(request.inReplyTo ? { inReplyTo: request.inReplyTo } : {}),
    ...(request.references ? { references: request.references } : {}),
    // Nodemailer infers each part's content type from the filename and
    // emits Content-Disposition: attachment parts, so the decoded bytes
    // ride the raw MIME exactly the way Gmail expects to store and send
    // them. Empty lists are absent (never an empty multipart block).
    ...(request.attachments?.length
      ? {
          attachments: request.attachments.map((attachment) => ({
            filename: attachment.filename,
            content: Buffer.from(attachment.data, 'base64')
          }))
        }
      : {})
  })
  const raw = await toBuffer(message.message)
  return raw.toString('base64url')
}
