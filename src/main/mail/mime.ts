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
  attachments: MessageAttachmentRef[]
}

export const INLINE_ATTACHMENT_PREFIX = 'mailsy-part:'

export function collectBodies(
  part: gmail_v1.Schema$MessagePart,
  out: MessageBodies,
  path = '0'
): void {
  const mime = part.mimeType ?? ''
  if (mime === 'text/plain' && !out.text) out.text = decodeBody(part.body?.data)
  if (mime === 'text/html' && !out.html) out.html = decodeBody(part.body?.data)
  const inlineCid = mime.startsWith('image/')
    ? part.headers?.find((header) => header.name?.toLowerCase() === 'content-id')?.value
    : undefined
  const disposition = part.headers
    ?.find((header) => header.name?.toLowerCase() === 'content-disposition')
    ?.value?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  if (inlineCid) {
    out.inlineImages.push({
      contentId: inlineCid,
      mimeType: mime,
      data: part.body?.data,
      attachmentId: part.body?.attachmentId
    })
  }
  if (
    (!inlineCid || disposition === 'attachment') &&
    part.filename &&
    (part.body?.attachmentId || typeof part.body?.data === 'string')
  ) {
    out.attachments.push({
      filename: part.filename,
      size: part.body?.size ?? 0,
      attachmentId: part.body?.attachmentId || `${INLINE_ATTACHMENT_PREFIX}${path}`
    })
  }
  for (const [index, p] of (part.parts ?? []).entries()) collectBodies(p, out, `${path}.${index}`)
}

type RawMessageFields = Pick<
  SendEmailRequest,
  'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'bodyHtml' | 'inReplyTo' | 'references' | 'attachments'
>

interface InlineBodyImage {
  cid: string
  filename: string
  content: Buffer
  contentType: string
}

function extractInlineImages(html: string): { html: string; images: InlineBodyImage[] } {
  const images: InlineBodyImage[] = []
  const replaced = html.replace(
    /src="data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)"/gi,
    (match, mimeType: string, base64: string) => {
      if (base64.length === 0) return match
      const index = images.length + 1
      const extension = (mimeType.split('/')[1] ?? 'png').replace(/[^a-z0-9]/gi, '') || 'png'
      images.push({
        cid: `inline-${index}@mailsy`,
        filename: `image-${index}.${extension}`,
        content: Buffer.from(base64, 'base64'),
        contentType: mimeType.toLowerCase()
      })
      return `src="cid:inline-${index}@mailsy"`
    }
  )
  return { html: replaced, images }
}

export async function buildRawMessage(from: string, request: RawMessageFields): Promise<string> {
  const transport = createTransport({
    streamTransport: true,
    newline: 'unix'
  })
  const inlineBody =
    request.bodyHtml === undefined ? undefined : extractInlineImages(request.bodyHtml)
  const attachments = [
    ...(request.attachments ?? []).map((attachment) => ({
      filename: attachment.filename,
      content: Buffer.from(attachment.data, 'base64')
    })),
    ...(inlineBody?.images ?? [])
  ]
  const message = await transport.sendMail({
    from,
    to: request.to,
    ...(request.cc ? { cc: request.cc } : {}),
    ...(request.bcc ? { bcc: request.bcc } : {}),
    subject: request.subject,
    text: request.body,
    ...(inlineBody !== undefined ? { html: inlineBody.html } : {}),
    ...(request.inReplyTo ? { inReplyTo: request.inReplyTo } : {}),
    ...(request.references ? { references: request.references } : {}),
    ...(attachments.length ? { attachments } : {})
  })
  const raw = await toBuffer(message.message)
  return raw.toString('base64url')
}
