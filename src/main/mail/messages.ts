import { getGmailClient } from '../auth'
import type { EmailDetail, EmailThread } from '../../shared/types'
import { toEmailDetail } from './message'
import { DETAIL_CONCURRENCY, mapWithConcurrency, withQuotaRetry } from './resilience'

export async function fetchMessage(id: string): Promise<EmailDetail> {
  const gmail = getGmailClient()
  const msg = await withQuotaRetry(() =>
    gmail.users.messages.get({ userId: 'me', id, format: 'full' })
  )
  return toEmailDetail(gmail, msg.data)
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
  const messages = await mapWithConcurrency(thread.data.messages ?? [], DETAIL_CONCURRENCY, (msg) =>
    toEmailDetail(gmail, msg)
  )
  return { id: thread.data.id ?? threadId, messages }
}
