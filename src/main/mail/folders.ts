import { getGmailClient } from '../auth'
import type { GmailClient } from '../auth'
import type { ListFolderOptions, MailFolder, ThreadPage, ThreadSummary } from '../../shared/types'
import {
  DETAIL_CONCURRENCY,
  isNotFoundError,
  mapWithConcurrency,
  withQuotaRetry
} from './resilience'
import { resolveSnoozeLabelId } from './snooze'
import { threadToSummary, toEmailSummary } from './message'

// Snoozed and All Mail are the two views whose native listing shape differs
// from the rest of the table. All Mail's no-label default excludes only
// SPAM and TRASH, so parked mail (which carries no label) stays listed
// there, like Gmail's All Mail label view. The Snoozed view reads parking
// through the union in fetchSnoozed: SNOOZED is a Gmail pseudo-label
// outside labels.list, and threads.list(labelIds:['SNOOZED']) is rejected
// with 400 "Invalid label: SNOOZED" just like writes are, while
// q:'in:snoozed' is the query path the API answers (Google feature request
// 109952618) — and mail snoozed by Mailsy itself carries a user label,
// whose listing CAN use labelIds, so the view unions both sets. The rest
// of the table's views list through direct labelId filters: Important and
// the categories carry documented system labels (IMPORTANT,
// CATEGORY_SOCIAL, CATEGORY_PROMOTIONS, CATEGORY_UPDATES, CATEGORY_FORUMS
// — Google's label types guide), and a category label is not an All Mail
// removal above.

// One listing spec per folder view: the label filter the view lists
// through, plus a Gmail search fragment for views whose state the API
// exposes only through the query.
interface FolderListing {
  labelIds: string[]
  fragment?: string
}

const FOLDER_LISTING: Record<Exclude<MailFolder, 'drafts'>, FolderListing> = {
  // The user-label view lists through ListFolderOptions.userLabelId, so its
  // folder slot carries no labelIds of its own; fetchFolder supplies the
  // id (and refuses the view without one).
  label: { labelIds: [] },
  // No label filter: Gmail's All Mail is every thread the account holds,
  // archived mail included. Spam and Trash are excluded by the API default
  // and have folder views of their own.
  all: { labelIds: [] },
  inbox: { labelIds: ['INBOX'] },
  sent: { labelIds: ['SENT'] },
  trash: { labelIds: ['TRASH'] },
  // Gmail's Spam view: the mail the spam filter pulled out of every other
  // folder view, including All Mail (whose no-label filter excludes Spam
  // and Trash by the API default).
  spam: { labelIds: ['SPAM'] },
  // STARRED alone (no folder constraint): Gmail's Starred view spans every
  // mail that carries the label, wherever it is.
  starred: { labelIds: ['STARRED'] },
  // Type-carrying dead entry: the Snoozed view dispatches to fetchSnoozed
  // above (the native q operator plus the Mailsy parking label union)
  // before this table is read, so this slot never lists on its own.
  snoozed: { labelIds: [] },
  important: { labelIds: ['IMPORTANT'] },
  social: { labelIds: ['CATEGORY_SOCIAL'] },
  promotions: { labelIds: ['CATEGORY_PROMOTIONS'] },
  updates: { labelIds: ['CATEGORY_UPDATES'] },
  forums: { labelIds: ['CATEGORY_FORUMS'] }
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
    // The label leg only ever has its first page (no union token in v1), so
    // it runs on first-page fetches only: re-running it under a page token
    // would re-read and re-merge the same rows into every deeper page.
    mailSnoozeLabelId && !options.pageToken
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

  // A user-label view substitutes the chosen label for the folder's
  // system-label filter; the search fragment stays a folder property,
  // which every label view lacks.
  const userLabelId = folder === 'label' ? options.userLabelId : undefined
  if (folder === 'label' && !userLabelId) throw new Error('A user label view needs a label id')

  const { labelIds, fragment } = userLabelId
    ? { labelIds: [userLabelId], fragment: undefined }
    : FOLDER_LISTING[folder]

  // A fragment appends to the user's query instead of a separate call, so
  // the view's condition and a search narrow one Gmail search.
  const q = fragment ? [userQuery, fragment].filter((part) => part).join(' ') : userQuery

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
