import { getGmailClient } from '../auth'
import type { GmailClient } from '../auth'
import type { ListFolderOptions, MailFolder, ThreadPage, ThreadSummary } from '../../shared/types'
import {
  DETAIL_CONCURRENCY,
  isNotFoundError,
  mapWithConcurrency,
  withQuotaRetry
} from './resilience'
import { threadToSummary, toEmailSummary } from './message'

// Snoozed and All Mail are the two views whose listing cannot use labelIds.
// All Mail's no-label default excludes only SPAM and TRASH, so parked mail
// (which carries no label) stays listed there, like Gmail's All Mail label
// view. The Snoozed view reads the parking state through the search
// operator instead: SNOOZED is a Gmail pseudo-label outside labels.list, and
// threads.list(labelIds:['SNOOZED']) is rejected with 400 "Invalid label:
// SNOOZED" just like writes are, while q:'in:snoozed' is the query path the
// API answers (Google feature request 109952618).
const FOLDER_LABEL_IDS: Record<Exclude<MailFolder, 'drafts'>, string[]> = {
  // No label filter: Gmail's All Mail is every thread the account holds,
  // archived mail included. Spam and Trash are excluded by the API default
  // and have folder views of their own.
  all: [],
  inbox: ['INBOX'],
  sent: ['SENT'],
  trash: ['TRASH'],
  // Gmail's Spam view: the mail the spam filter pulled out of every other
  // folder view, including All Mail (whose no-label filter excludes Spam
  // and Trash by the API default).
  spam: ['SPAM'],
  // STARRED alone (no folder constraint): Gmail's Starred view spans every
  // mail that carries the label, wherever it is.
  starred: ['STARRED'],
  // Empty filter: the Snoozed view rides the q operator instead of a
  // labelIds entry. See the comment above FOLDER_LABEL_IDS.
  snoozed: []
}

async function fetchDrafts(
  gmail: GmailClient,
  options: ListFolderOptions,
  maxResults: number,
  q: string | undefined
): Promise<ThreadPage> {
  // Drafts are enumerated via drafts.list because messages.list returns only
  // message IDs, which cannot resolve the draft IDs needed to delete a draft
  // after sending it. A draft is still a list row, so each draft wraps into a
  // single-message ThreadSummary that carries its draftId.
  const list = await withQuotaRetry(() =>
    gmail.users.drafts.list({
      userId: 'me',
      maxResults,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(q ? { q } : {})
    })
  )
  const drafts = (list.data.drafts ?? []).flatMap((d) => (d.id ? [{ id: d.id }] : []))

  async function fetchDraftMessage(id: string): Promise<ThreadSummary | null> {
    const full = await withQuotaRetry(() =>
      gmail.users.drafts.get({
        userId: 'me',
        id,
        format: 'metadata'
      })
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

export async function fetchFolder(options: ListFolderOptions = {}): Promise<ThreadPage> {
  const gmail = getGmailClient()
  const maxResults = Math.min(Math.max(options.maxResults ?? 30, 1), 100)
  const userQuery = options.q?.trim() || undefined
  const folder = options.folder ?? 'inbox'

  if (folder === 'drafts') return fetchDrafts(gmail, options, maxResults, userQuery)

  const labelIds = FOLDER_LABEL_IDS[folder]

  // The Snoozed view appends its operator to the user's query, so parking
  // and a search narrow one Gmail search instead of stacking two.
  const q =
    folder === 'snoozed' ? [userQuery, 'in:snoozed'].filter((part) => part).join(' ') : userQuery

  const list = await withQuotaRetry(() =>
    gmail.users.threads.list({
      userId: 'me',
      maxResults,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(q ? { q } : {}),
      // All Mail carries an empty filter, which must arrive as no labelIds
      // parameter at all rather than an empty list.
      ...(labelIds.length > 0 ? { labelIds } : {})
    })
  )
  const ids = (list.data.threads ?? []).flatMap((t) => (t.id ? [t.id] : []))

  const threads = await mapWithConcurrency(
    ids,
    DETAIL_CONCURRENCY,
    async (id): Promise<ThreadSummary> => {
      const thread = await withQuotaRetry(() =>
        gmail.users.threads.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        })
      )
      return threadToSummary(thread.data)
    }
  )

  return { threads, nextPageToken: list.data.nextPageToken ?? null }
}
