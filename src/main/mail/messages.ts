import { getAccountEmail, getGmailClient } from '../auth'
import type { EmailDetail, EmailThread } from '../../shared/types'
import { toEmailDetail } from './message'
import { base64UrlToBuffer } from './mime'
import { noteHistoryId } from './sync'
import { DETAIL_CONCURRENCY, mapWithConcurrency, withQuotaRetry } from './resilience'

export async function fetchMessage(id: string): Promise<EmailDetail> {
  const gmail = getGmailClient()
  const msg = await withQuotaRetry(() =>
    gmail.users.messages.get({ userId: 'me', id, format: 'full' })
  )
  return toEmailDetail(gmail, msg.data)
}

export async function fetchAttachment(messageId: string, attachmentId: string): Promise<string> {
  if (!messageId.trim() || !attachmentId.trim()) throw new Error('Attachment ID is required')
  const gmail = getGmailClient()
  const attachment = await withQuotaRetry(() =>
    gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId })
  )
  return base64UrlToBuffer(attachment.data.data ?? '').toString('base64')
}

export async function fetchThread(threadId: string): Promise<EmailThread> {
  if (!threadId.trim()) throw new Error('Thread ID is required')
  const gmail = getGmailClient()
  const thread = await withQuotaRetry(() =>
    gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    })
  )
  noteHistoryId(thread.data.historyId)
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
