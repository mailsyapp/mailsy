import type { Readable } from 'node:stream'
import { createTransport } from 'nodemailer'
import type { gmail_v1 } from 'googleapis'
import type { SendEmailRequest } from '../../shared/types'

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
}

export function collectBodies(part: gmail_v1.Schema$MessagePart, out: MessageBodies): void {
  const mime = part.mimeType ?? ''
  if (mime === 'text/plain' && !out.text) out.text = decodeBody(part.body?.data)
  if (mime === 'text/html' && !out.html) out.html = decodeBody(part.body?.data)
  if (mime.startsWith('image/')) {
    const contentId = part.headers?.find(
      (header) => header.name?.toLowerCase() === 'content-id'
    )?.value
    if (contentId) {
      out.inlineImages.push({
        contentId,
        mimeType: mime,
        data: part.body?.data,
        attachmentId: part.body?.attachmentId
      })
    }
  }
  for (const p of part.parts ?? []) collectBodies(p, out)
}

type RawMessageFields = Pick<
  SendEmailRequest,
  'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'bodyHtml' | 'inReplyTo' | 'references'
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
    ...(request.references ? { references: request.references } : {})
  })
  const raw = await toBuffer(message.message)
  return raw.toString('base64url')
}
