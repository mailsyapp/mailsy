import { getGmailClient } from '../auth'
import type { GmailClient } from '../auth'
import type { ListFolderOptions, MailFolder, ThreadPage, ThreadSummary } from '../../shared/types'
import {
  DETAIL_CONCURRENCY,
  isNotFoundError,
  mapWithConcurrency,
  withQuotaRetry
} from './resilience'
import { withQuotaRetry, resolveSnoozeLabelId } from './snooze'
import { threadToSummary, toEmailSummary } from './message'

// Snoozed and All Mail are the two views whose native listing cannot use
// labelIds. All Mail's no-label default excludes only SPAM and TRASH, so
// parked mail (which carries no label) stays listed there, like Gmail's All
// Mail label view. The Snoozed view reads the native parking state through
// the search operator instead: SNOOZED is a Gmail pseudo-label outside
// labels.list, and threads.list(labelIds:['SNOOZED']) is rejected with 400
// "Invalid label: SNOOZED" just like writes are, while q:'in:snoozed' is
// the query path the API answers (Google feature request 109952618). Mail
// snoozed by Mailsy itself carries a user label, whose listing CAN use
// labelIds, so the view unions both sets.
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
  // Empty filter: the Snoozed view is the union in fetchSnoozed above (the
  // native q operator plus the Mailsy parking label), not a labelIds filter.

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

async function fetchSnoozed(
  gmail: GmailClient,
  options: ListFolderOptions,
  maxResults: number,
  userQuery: string | undefined
): Promise<ThreadPage> {
  // One rail entry is one concept: the native parked set (the only path the
  // API answers for SNOOZED) and the emulated set (threads carrying
  // 'Snoozed by Mailsy') merge at the id level before the per-thread
  // fetches, so a thread parked by both sides lists once. The emulated leg
  // marks the rows so their unsnooze takes the restore-pair path; v1 lists
  // only its first page (follow-up: a union pagination token).
  const emulatedQuery = [userQuery, 'in:snoozed'].filter((part) => part).join(' ')
  const mailSnoozeLabelId = await resolveSnoozeLabelId(gmail, false)
  const [native, emulated] = await Promise.all([
    withQuotaRetry(() =>
      gmail.users.threads.list({
        userId: 'me',
        maxResults,
        ...(options.pageToken ? { pageToken: options.pageToken } : {}),
        ...(emulatedQuery ? { q: emulatedQuery } : {})
      })
    ),
    mailSnoozeLabelId
      ? withQuotaRetry(() =>
          gmail.users.threads.list({
            userId: 'me',
            maxResults,
            labelIds: [mailSnoozeLabelId],
            ...(userQuery ? { q: userQuery } : {})
          })
        )
      : Promise.resolve(null)
  ])

  const idSets = [
    (native.data.threads ?? []).map((thread) => thread.id ?? '').filter((id) => id.trim()),
    (emulated?.data.threads ?? []).map((thread) => thread.id ?? '').filter((id) => id.trim())
  ]
  const ids = [...new Set(idSets[0].concat(idSets[1]))]

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
      return threadToSummary(thread.data, mailSnoozeLabelId ?? undefined)
    }
  )

  return { threads, nextPageToken: native.data.nextPageToken ?? null }
}

export async function fetchFolder(options: ListFolderOptions = {}): Promise<ThreadPage> {
  const gmail = getGmailClient()
  const maxResults = Math.min(Math.max(options.maxResults ?? 30, 1), 100)
  const userQuery = options.q?.trim() || undefined
  const folder = options.folder ?? 'inbox'

  if (folder === 'drafts') return fetchDrafts(gmail, options, maxResults, userQuery)
  if (folder === 'snoozed') return fetchSnoozed(gmail, options, maxResults, userQuery)

  const labelIds = FOLDER_LABEL_IDS[folder]

  const list = await withQuotaRetry(() =>
    gmail.users.threads.list({
      userId: 'me',
      maxResults,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(userQuery ? { q: userQuery } : {}),
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
