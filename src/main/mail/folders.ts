import { getGmailClient, getMailSession } from '../auth'
import type { GmailClient } from '../auth'
import type { ListFolderOptions, MailFolder, ThreadPage, ThreadSummary } from '../../shared/types'
import {
  DETAIL_CONCURRENCY,
  isNotFoundError,
  mapWithConcurrency,
  withQuotaRetry
} from './resilience'
import { resolveSnoozeLabelId } from './snooze'
import { noteHistoryId } from './sync'
import { threadToSummary, toEmailSummary } from './message'
interface FolderListing {
  labelIds: string[]
  fragment?: string
}
const FOLDER_LISTING: Record<Exclude<MailFolder, 'drafts'>, FolderListing> = {
  label: { labelIds: [] },
  all: { labelIds: [] },
  inbox: { labelIds: ['INBOX'] },
  sent: { labelIds: ['SENT'] },
  trash: { labelIds: ['TRASH'] },
  spam: { labelIds: ['SPAM'] },
  starred: { labelIds: ['STARRED'] },
  snoozed: { labelIds: [] },
  important: { labelIds: ['IMPORTANT'] },
  social: { labelIds: ['CATEGORY_SOCIAL'] },
  promotions: { labelIds: ['CATEGORY_PROMOTIONS'] },
  updates: { labelIds: ['CATEGORY_UPDATES'] },
  forums: { labelIds: ['CATEGORY_FORUMS'] }
}
async function fetchDrafts(
  gmail: GmailClient,
  session: symbol,
  options: ListFolderOptions,
  maxResults: number,
  q: string | undefined
): Promise<ThreadPage> {
  const list = await withQuotaRetry(() =>
    gmail.users.drafts.list({
      userId: 'me',
      maxResults,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(q ? { q } : {})
    })
  )
  const skip = new Set(options.skipRowIds)
  const drafts = (list.data.drafts ?? []).flatMap((d) =>
    d.id && !skip.has(d.id) ? [{ id: d.id }] : []
  )
  async function fetchDraftMessage(id: string): Promise<ThreadSummary | null> {
    const full = await withQuotaRetry(
      () =>
        gmail.users.drafts.get({
          userId: 'me',
          id,
          format: 'metadata'
        }),
      session
    )
    const msg = full.data.message ?? {}
    if (!msg.id || !msg.threadId) return null
    const summary = toEmailSummary(msg.id, msg, full.data.id ?? id)
    return {
      id: summary.threadId,
      subject: summary.subject,
      snippet: summary.snippet,
      participants: summary.from ? [summary.from] : [],
      date: summary.date,
      messageIds: [summary.id],
      unreadCount: summary.unread ? 1 : 0,
      starred: summary.starred,
      ...(summary.draftId ? { draftId: summary.draftId } : {})
    }
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
  const threads = results.filter((r): r is ThreadSummary => r !== null)
  return { threads, nextPageToken: list.data.nextPageToken ?? null }
}
type SnoozedPageToken = [native: string | null, mailsy: string | null]

function decodeSnoozedPageToken(token: string): SnoozedPageToken {
  const decoded: unknown = JSON.parse(token)
  const [native, mailsy]: unknown[] = Array.isArray(decoded) && decoded.length === 2 ? decoded : []
  if (
    (native !== null && typeof native !== 'string') ||
    (mailsy !== null && typeof mailsy !== 'string')
  ) {
    throw new Error('Invalid Snoozed page token')
  }
  return [native, mailsy]
}

async function fetchSnoozed(
  gmail: GmailClient,
  session: symbol,
  options: ListFolderOptions,
  maxResults: number,
  userQuery: string | undefined
): Promise<ThreadPage> {
  const [nativePageToken, mailsyPageToken] = options.pageToken
    ? decodeSnoozedPageToken(options.pageToken)
    : []
  const nativeQuery = [userQuery, 'in:snoozed'].filter((part) => part).join(' ')
  const mailSnoozeLabelId = await resolveSnoozeLabelId(gmail, false)
  const [native, emulated] = await Promise.all([
    nativePageToken !== null
      ? withQuotaRetry(
          () =>
            gmail.users.threads.list({
              userId: 'me',
              maxResults,
              ...(nativePageToken ? { pageToken: nativePageToken } : {}),
              q: nativeQuery
            }),
          session
        )
      : Promise.resolve(null),
    mailSnoozeLabelId && mailsyPageToken !== null
      ? withQuotaRetry(
          () =>
            gmail.users.threads.list({
              userId: 'me',
              maxResults,
              labelIds: [mailSnoozeLabelId],
              ...(mailsyPageToken ? { pageToken: mailsyPageToken } : {}),
              ...(userQuery ? { q: userQuery } : {})
            }),
          session
        )
      : Promise.resolve(null)
  ])
  const idSets = [
    (native?.data.threads ?? []).map((thread) => thread.id ?? '').filter((id) => id.trim()),
    (emulated?.data.threads ?? []).map((thread) => thread.id ?? '').filter((id) => id.trim())
  ]
  const ids = [...new Set(idSets[0].concat(idSets[1]))]
  const skip = new Set(options.skipRowIds)
  const threads = await mapWithConcurrency(
    ids.filter((id) => !skip.has(id)),
    DETAIL_CONCURRENCY,
    async (id): Promise<ThreadSummary> => {
      const thread = await withQuotaRetry(
        () =>
          gmail.users.threads.get({
            userId: 'me',
            id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date']
          }),
        session
      )
      noteHistoryId(thread.data.historyId, session)
      return threadToSummary(thread.data, mailSnoozeLabelId ?? undefined)
    }
  )
  const nextNativePage = native?.data.nextPageToken || null
  const nextMailsyPage = emulated?.data.nextPageToken || null
  const nextPageToken =
    nextNativePage || nextMailsyPage ? JSON.stringify([nextNativePage, nextMailsyPage]) : null
  return { threads, nextPageToken }
}
export async function fetchFolder(options: ListFolderOptions = {}): Promise<ThreadPage> {
  const gmail = getGmailClient()
  const session = getMailSession()
  const maxResults = Math.min(Math.max(options.maxResults ?? 30, 1), 100)
  const userQuery = options.q?.trim() || undefined
  const folder = options.folder ?? 'inbox'
  if (folder === 'drafts') return fetchDrafts(gmail, session, options, maxResults, userQuery)
  if (folder === 'snoozed') return fetchSnoozed(gmail, session, options, maxResults, userQuery)
  const userLabelId = folder === 'label' ? options.userLabelId : undefined
  if (folder === 'label' && !userLabelId) throw new Error('A user label view needs a label id')
  const { labelIds, fragment } = userLabelId
    ? { labelIds: [userLabelId], fragment: undefined }
    : FOLDER_LISTING[folder]
  const q = fragment ? [userQuery, fragment].filter((part) => part).join(' ') : userQuery
  const list = await withQuotaRetry(() =>
    gmail.users.threads.list({
      userId: 'me',
      maxResults,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(q ? { q } : {}),
      ...(labelIds.length > 0 ? { labelIds } : {})
    })
  )
  const skip = new Set(options.skipRowIds)
  const ids = (list.data.threads ?? []).flatMap((t) => (t.id && !skip.has(t.id) ? [t.id] : []))
  const threads = await mapWithConcurrency(
    ids,
    DETAIL_CONCURRENCY,
    async (id): Promise<ThreadSummary> => {
      const thread = await withQuotaRetry(
        () =>
          gmail.users.threads.get({
            userId: 'me',
            id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date']
          }),
        session
      )
      noteHistoryId(thread.data.historyId, session)
      return threadToSummary(thread.data)
    }
  )
  return { threads, nextPageToken: list.data.nextPageToken ?? null }
}
