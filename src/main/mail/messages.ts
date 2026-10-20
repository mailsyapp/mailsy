import { getAccountEmail, getGmailClient } from '../auth'
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
  // getAccountEmail rides along concurrently so the thread open is not
  // serialized behind a profile call, and its failure degrades to an empty
  // exclusion set (reply-all excludes nothing) rather than failing the open:
  // a broken profile must not block reading mail a dead-grant token would
  // anyway surface at the message fetches above.
  const [messages, userEmail] = await Promise.all([
    mapWithConcurrency(thread.data.messages ?? [], DETAIL_CONCURRENCY, (msg) =>
      toEmailDetail(gmail, msg)
    ),
    getAccountEmail().catch(() => '')
  ])
  // The thread's full label id set, deduped: EmailThread carries label
  // membership at the boundary so the labels menu never re-parses messages.
  const labelIds = new Set<string>()
  for (const msg of thread.data.messages ?? []) {
    for (const labelId of msg.labelIds ?? []) labelIds.add(labelId)
  }
  return { id: thread.data.id ?? threadId, messages, labelIds: [...labelIds], userEmail }
}
