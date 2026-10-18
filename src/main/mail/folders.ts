import { getGmailClient } from '../auth'
import type { GmailClient } from '../auth'
import type { EmailSummary, ListFolderOptions, MailFolder, MailPage } from '../../shared/types'
import {
  DETAIL_CONCURRENCY,
  isNotFoundError,
  mapWithConcurrency,
  withQuotaRetry
} from './resilience'
import { toEmailSummary } from './message'

const FOLDER_LABEL_IDS: Record<Exclude<MailFolder, 'drafts'>, string[]> = {
  inbox: ['INBOX'],
  sent: ['SENT'],
  trash: ['TRASH'],
  // STARRED alone (no folder constraint): Gmail's Starred view spans every
  // mail that carries the label, wherever it is.
  starred: ['STARRED']
}

async function fetchDrafts(
  gmail: GmailClient,
  options: ListFolderOptions,
  maxResults: number,
  q: string | undefined
): Promise<MailPage> {
  // Drafts are enumerated via drafts.list because messages.list returns only
  // message IDs, which cannot resolve the draft IDs needed to delete a draft
  // after sending it.
  const list = await withQuotaRetry(() =>
    gmail.users.drafts.list({
      userId: 'me',
      maxResults,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      ...(q ? { q } : {})
    })
  )
  const drafts = (list.data.drafts ?? []).flatMap((d) => (d.id ? [{ id: d.id }] : []))

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

export async function fetchFolder(options: ListFolderOptions = {}): Promise<MailPage> {
  const gmail = getGmailClient()
  const maxResults = Math.min(Math.max(options.maxResults ?? 30, 1), 100)
  const q = options.q?.trim() || undefined
  const folder = options.folder ?? 'inbox'

  if (folder === 'drafts') return fetchDrafts(gmail, options, maxResults, q)

  const labelIds = FOLDER_LABEL_IDS[folder]

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
