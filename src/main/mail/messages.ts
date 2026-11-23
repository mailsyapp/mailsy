import { getAccountEmail, getGmailClient, getMailSession } from '../auth'
import type { EmailDetail, EmailThread } from '../../shared/types'
import { toEmailDetail } from './message'
import { base64UrlToBuffer, INLINE_ATTACHMENT_PREFIX } from './mime'
import { noteHistoryId } from './sync'
import { DETAIL_CONCURRENCY, mapWithConcurrency, withQuotaRetry } from './resilience'
export async function fetchMessage(id: string, draftId?: string): Promise<EmailDetail> {
  const gmail = getGmailClient()
  if (draftId !== undefined) {
    if (typeof draftId !== 'string' || !draftId.trim()) throw new Error('Draft ID is required')
    const draft = await withQuotaRetry(() =>
      gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'full' })
    )
    if (!draft.data.message?.id) throw new Error('Gmail returned no draft message')
    return toEmailDetail(gmail, draft.data.message)
  }
  const msg = await withQuotaRetry(() =>
    gmail.users.messages.get({ userId: 'me', id, format: 'full' })
  )
  return toEmailDetail(gmail, msg.data)
}
export async function fetchAttachment(messageId: string, attachmentId: string): Promise<string> {
  if (!messageId.trim() || !attachmentId.trim()) throw new Error('Attachment ID is required')
  const gmail = getGmailClient()
  if (attachmentId.startsWith(INLINE_ATTACHMENT_PREFIX)) {
    const path = attachmentId.slice(INLINE_ATTACHMENT_PREFIX.length).split('.')
    if (path.shift() !== '0' || path.some((index) => !/^(0|[1-9]\d*)$/.test(index))) {
      throw new Error('Invalid attachment ID')
    }
    const message = await withQuotaRetry(() =>
      gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
    )
    let part = message.data.payload
    for (const index of path) part = part?.parts?.[Number(index)]
    if (!part?.filename || typeof part.body?.data !== 'string') {
      throw new Error('Attachment not found')
    }
    return base64UrlToBuffer(part.body.data).toString('base64')
  }
  const attachment = await withQuotaRetry(() =>
    gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId })
  )
  return base64UrlToBuffer(attachment.data.data ?? '').toString('base64')
}
export async function fetchThread(threadId: string): Promise<EmailThread> {
  if (!threadId.trim()) throw new Error('Thread ID is required')
  const gmail = getGmailClient()
  const session = getMailSession()
  const thread = await withQuotaRetry(() =>
    gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    })
  )
  noteHistoryId(thread.data.historyId, session)
  const [messages, userEmail] = await Promise.all([
    mapWithConcurrency(thread.data.messages ?? [], DETAIL_CONCURRENCY, (msg) =>
      toEmailDetail(gmail, msg)
    ),
    getAccountEmail().catch(() => '')
  ])
  const labelIds = new Set<string>()
  for (const msg of thread.data.messages ?? []) {
    for (const labelId of msg.labelIds ?? []) labelIds.add(labelId)
  }
  return { id: thread.data.id ?? threadId, messages, labelIds: [...labelIds], userEmail }
}
