import { getGmailClient } from './auth'
import type { Readable } from 'node:stream'
import type { gmail_v1 } from 'googleapis'
import { createTransport } from 'nodemailer'
import type {
  EmailSummary,
  EmailDetail,
  EmailThread,
  ListFolderOptions,
  MailFolder,
  MailPage,
  SendEmailRequest,
  SendDraftRequest
} from '../shared/types'

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

function decodeBody(data?: string | null): string {
  if (!data) return ''
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64').toString('utf-8')
}

// Fetch message details with bounded concurrency so one inbox page/search
// doesn't burst 30 parallel messages.get calls into the per-user rate limit.
const DETAIL_CONCURRENCY = 5
const QUOTA_MAX_RETRIES = 2

function isQuotaError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e)
  return /quota|rate.?limit|429|userRateLimitExceeded/i.test(message)
}

// The entity isn't there (deleted elsewhere while we were listing, or a race
// with another client). Distinct from quota/transport failures, which must
// surface to the user instead of being treated as recoverable per-item gaps.
function isNotFoundError(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code
  if (code === 404) return true
  const message = e instanceof Error ? e.message : String(e)
  return /404|notfound|requested entity was not found/i.test(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Single retry with backoff for quota blips: a debounced keystroke that lands
// just over the per-minute line waits and succeeds instead of surfacing an
// error. Only retries quota/rate-limit failures, everything else throws.
async function withQuotaRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (e) {
      if (!isQuotaError(e) || attempt >= QUOTA_MAX_RETRIES) throw e
      await sleep(1000 * 2 ** attempt)
      attempt++
    }
  }
}

// Runs fn over items with at most `limit` in flight. Settles ALL workers
// before returning so a sibling failure can't strand its in-flight result
// as an unhandled rejection; if anything failed, the first error is thrown.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  const errors: unknown[] = []
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      try {
        results[i] = await fn(items[i]!)
      } catch (e) {
        errors.push(e)
      }
    }
  })
  await Promise.all(workers)
  if (errors.length > 0) throw errors[0]
  return results
}

function normalizeContentId(contentId: string): string {
  let normalized = contentId.trim().replace(/^<|>$/g, '')
  try {
    normalized = decodeURIComponent(normalized)
  } catch (error) {
    if (!(error instanceof URIError)) throw error
  }
  return normalized.toLowerCase()
}

function collectBodies(
  part: gmail_v1.Schema$MessagePart,
  out: {
    text: string
    html: string
    inlineImages: Array<{
      contentId: string
      mimeType: string
      data?: string | null
      attachmentId?: string | null
    }>
  }
): void {
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

async function toEmailDetail(
  gmail: ReturnType<typeof getGmailClient>,
  msg: gmail_v1.Schema$Message
): Promise<EmailDetail> {
  const id = msg.id ?? ''
  const headers = msg.payload?.headers ?? []
  const header = (name: string): string =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

  const out = {
    text: '',
    html: '',
    inlineImages: [] as Array<{
      contentId: string
      mimeType: string
      data?: string | null
      attachmentId?: string | null
    }>
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
      const base64Data = Buffer.from(
        encodedData.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString('base64')
      inlineImageData.set(normalizeContentId(contentId), `data:${mimeType};base64,${base64Data}`)
    })
  )

  const bodyHtml = out.html.replace(/cid:([^"'\s<>()]+)/gi, (reference, contentId: string) => {
    return inlineImageData.get(normalizeContentId(contentId)) ?? reference
  })

  return {
    id,
    from: header('From'),
    to: header('To'),
    cc: header('Cc'),
    bcc: header('Bcc'),
    replyTo: header('Reply-To'),
    threadId: msg.threadId ?? '',
    messageId: header('Message-ID'),
    inReplyTo: header('In-Reply-To'),
    references: header('References'),
    subject: header('Subject') || '(no subject)',
    date: header('Date'),
    snippet: msg.snippet ?? '',
    bodyText: out.text,
    bodyHtml
  }
}

export async function fetchMessage(id: string): Promise<EmailDetail> {
  const gmail = getGmailClient()
  const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
  return toEmailDetail(gmail, msg.data)
}

export async function fetchThread(threadId: string): Promise<EmailThread> {
  if (!threadId.trim()) throw new Error('Thread ID is required')
  const gmail = getGmailClient()
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full'
  })
  const messages = await Promise.all(
    (thread.data.messages ?? []).map((msg) => toEmailDetail(gmail, msg))
  )
  return { id: thread.data.id ?? threadId, messages }
}

type RawMessageFields = Pick<
  SendEmailRequest,
  'to' | 'subject' | 'body' | 'bodyHtml' | 'inReplyTo' | 'references'
>

async function buildRawMessage(from: string, request: RawMessageFields): Promise<string> {
  const transport = createTransport({
    streamTransport: true,
    newline: 'unix'
  })
  const message = await transport.sendMail({
    from,
    to: request.to,
    subject: request.subject,
    text: request.body,
    ...(request.bodyHtml !== undefined ? { html: request.bodyHtml } : {}),
    ...(request.inReplyTo ? { inReplyTo: request.inReplyTo } : {}),
    ...(request.references ? { references: request.references } : {})
  })
  const raw = await toBuffer(message.message)
  return raw.toString('base64url')
}

// Both send paths must see the same request shape: every field string-typed
// (optionally absent except to/subject/body) and a recipient required.
function assertSendFields(request: SendEmailRequest): void {
  if (
    !request ||
    typeof request.to !== 'string' ||
    typeof request.subject !== 'string' ||
    typeof request.body !== 'string' ||
    (request.bodyHtml !== undefined && typeof request.bodyHtml !== 'string') ||
    (request.threadId !== undefined && typeof request.threadId !== 'string') ||
    (request.inReplyTo !== undefined && typeof request.inReplyTo !== 'string') ||
    (request.references !== undefined && typeof request.references !== 'string')
  ) {
    throw new Error('Invalid email request')
  }
  if (!request.to.trim()) throw new Error('Recipient is required')
}

async function resolveFromAddress(gmail: ReturnType<typeof getGmailClient>): Promise<string> {
  const profile = await gmail.users.getProfile({ userId: 'me' })
  const from = profile.data.emailAddress
  if (!from) throw new Error('Could not determine the signed-in Gmail address')
  return from
}

export async function sendEmail(request: SendEmailRequest): Promise<void> {
  assertSendFields(request)

  const gmail = getGmailClient()
  const from = await resolveFromAddress(gmail)
  const raw = await buildRawMessage(from, request)

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      ...(request.threadId ? { threadId: request.threadId } : {})
    }
  })
}

function toEmailSummary(id: string, msg: gmail_v1.Schema$Message, draftId?: string): EmailSummary {
  const headers = msg.payload?.headers ?? []
  const header = (name: string): string =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

  return {
    id,
    threadId: msg.threadId ?? '',
    from: header('From'),
    subject: header('Subject') || '(no subject)',
    date: header('Date'),
    snippet: msg.snippet ?? '',
    ...(draftId ? { draftId } : {})
  }
}

async function fetchDrafts(
  gmail: ReturnType<typeof getGmailClient>,
  options: ListFolderOptions,
  maxResults: number,
  q: string | undefined
): Promise<MailPage> {
  // Drafts are enumerated via drafts.list (message IDs alone can't resolve
  // the draft IDs needed to delete a draft after sending it).
  const list = await withQuotaRetry(() =>
    gmail.users.drafts.list({
      userId: 'me',
      maxResults,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(q ? { q } : {})
    })
  )
  const drafts = (list.data.drafts ?? []).flatMap((d) => (d.id ? [{ id: d.id }] : []))

  // A single unreadable draft (deleted in Gmail web while the app is open,
  // or otherwise 404ing) must not fail the whole Drafts page: skip it and
  // list the survivors. Quota/transport failures are NOT skipped — they
  // propagate so the user sees an error instead of a silently empty list.
  async function fetchDraftMessage(id: string): Promise<EmailSummary> {
    const full = await withQuotaRetry(() =>
      gmail.users.drafts.get({
        userId: 'me',
        id,
        format: 'metadata'
      })
    )
    const msg = full.data.message ?? {}
    return toEmailSummary(msg.id ?? '', msg, full.data.id ?? id)
  }

  const results = await mapWithConcurrency(drafts, DETAIL_CONCURRENCY, async ({ id: draftId }) => {
    try {
      return await fetchDraftMessage(draftId)
    } catch (e) {
      if (!isNotFoundError(e)) throw e
      console.warn(`skipping unreadable draft ${draftId}:`, e)
      return null
    }
  })
  const emails = results.filter((r): r is EmailSummary => r !== null)

  return { emails, nextPageToken: list.data.nextPageToken ?? null }
}

export async function sendDraft(request: SendDraftRequest): Promise<void> {
  assertSendFields(request)
  if (typeof request.draftId !== 'string' || !request.draftId.trim()) {
    throw new Error('Draft ID is required')
  }

  const gmail = getGmailClient()
  const from = await resolveFromAddress(gmail)

  // drafts.update replaces the draft content with the edited fields first, so
  // drafts.send below transmits exactly what the user saw in the editor.
  // Sending via drafts.send (not messages.send + drafts.delete) removes the
  // draft server-side in the same operation: no window where the mail is out
  // but the draft lingers, and a retry after a successful send can't duplicate
  // the mail (the update fails once the draft is gone).
  const raw = await buildRawMessage(from, request)
  await withQuotaRetry(() =>
    gmail.users.drafts.update({
      userId: 'me',
      id: request.draftId,
      requestBody: {
        message: {
          raw,
          ...(request.threadId ? { threadId: request.threadId } : {})
        }
      }
    })
  )
  await withQuotaRetry(() =>
    gmail.users.drafts.send({
      userId: 'me',
      requestBody: { id: request.draftId }
    })
  )
}

// messages.list label filter per folder. Drafts go through drafts.list
// instead (see fetchDrafts), so they are deliberately absent here.
const FOLDER_LABEL_IDS: Record<Exclude<MailFolder, 'drafts'>, string[]> = {
  inbox: ['INBOX'],
  sent: ['SENT'],
  trash: ['TRASH']
}

export async function fetchFolder(options: ListFolderOptions = {}): Promise<MailPage> {
  const gmail = getGmailClient()
  const maxResults = Math.min(Math.max(options.maxResults ?? 30, 1), 100)
  const q = options.q?.trim() || undefined
  const folder = options.folder ?? 'inbox'

  if (folder === 'drafts') return fetchDrafts(gmail, options, maxResults, q)

  const labelIds = FOLDER_LABEL_IDS[folder]

  // 1) list returns only message IDs, plus a nextPageToken when more exist
  const list = await withQuotaRetry(() =>
    gmail.users.messages.list({
      userId: 'me',
      labelIds,
      maxResults,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(q ? { q } : {})
    })
  )
  const ids = (list.data.messages ?? []).flatMap((m) => (m.id ? [m.id] : []))

  // 2) fetch details for each ID with bounded concurrency (quota-friendly)
  const emails = await mapWithConcurrency(
    ids,
    DETAIL_CONCURRENCY,
    async (id): Promise<EmailSummary> => {
      const msg = await withQuotaRetry(() =>
        gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        })
      )
      return toEmailSummary(id, msg.data)
    }
  )

  return { emails, nextPageToken: list.data.nextPageToken ?? null }
}
