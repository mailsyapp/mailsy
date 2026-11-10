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

// The rich body's inline images: the renderer composes with data URLs
// (the only form a contenteditable can show), but a message carries them
// as multipart/related cid parts — what Gmail does and what the detail
// view's bodyHtml round trip already understands. Each `src="data:image/...
// ;base64,..."` becomes a `cid:` reference with its byte part emitted as a
// nodemailer attachment; nodemailer builds the related group when the html
// references them. Content-ids are generated here (deterministic per
// build), so nothing in the request needs to anticipate them.
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
      // A match with bytes that decode to nothing still becomes a part
      // (nodemailer would embed an empty one) — an empty data URL is
      // markup junk, not an image, so it stays literal text instead.
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
  // The html's inline images split off into their own parts first, so the
  // body carries only the same cid references the receiving side replaces
  // with data URLs on the way back out.
  const inlineBody =
    request.bodyHtml === undefined ? undefined : extractInlineImages(request.bodyHtml)
  // Nodemailer infers each part's content type and disposition: plain
  // named records become Content-Disposition: attachment parts (the way
  // Gmail expects to store and send composer files), and the extracted
  // inline images carry a cid each, so the html+images group builds as
  // multipart/related. Empty lists stay absent, never an empty multipart.
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
    // Carbon lists are plain header fields; the stream transport keeps the
    // Bcc header in the raw output and Gmail strips it before delivery.
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
