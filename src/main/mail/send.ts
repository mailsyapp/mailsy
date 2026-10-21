import { getAccountEmail, getGmailClient } from '../auth'
import type { SaveDraftRequest, SendDraftRequest, SendEmailRequest } from '../../shared/types'
import { isNotFoundError, rethrowDeadGrant, withQuotaRetry } from './resilience'
import { buildRawMessage } from './mime'
import type { gmail_v1 } from 'googleapis'

// Field checks for the two bridge verbs. A send requires a recipient; a
// draft save does not (Gmail keeps recipient-less drafts), but nothing
// else about the field set differs, so one check carries both.
function assertMessageFields(request: SendEmailRequest, requireRecipient: boolean): void {
  if (
    !request ||
    typeof request.to !== 'string' ||
    typeof request.subject !== 'string' ||
    typeof request.body !== 'string' ||
    (request.bodyHtml !== undefined && typeof request.bodyHtml !== 'string') ||
    (request.cc !== undefined && typeof request.cc !== 'string') ||
    (request.bcc !== undefined && typeof request.bcc !== 'string') ||
    (request.threadId !== undefined && typeof request.threadId !== 'string') ||
    (request.inReplyTo !== undefined && typeof request.inReplyTo !== 'string') ||
    (request.references !== undefined && typeof request.references !== 'string')
  ) {
    throw new Error('Invalid email request')
  }
  // One address list of the three must survive: a send may legitimately go
  // out to Cc/Bcc alone (a reply-all whose To is only the user's own
  // address), an empty To is not the whole receipt test.
  if (
    requireRecipient &&
    !request.to.trim() &&
    !(request.cc ?? '').trim() &&
    !(request.bcc ?? '').trim()
  ) {
    throw new Error('Recipient is required')
  }
}

export async function sendEmail(request: SendEmailRequest): Promise<void> {
  assertMessageFields(request, true)

  try {
    const gmail = getGmailClient()
    const from = await getAccountEmail()
    const raw = await buildRawMessage(from, request)

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        ...(request.threadId ? { threadId: request.threadId } : {})
      }
    })
  } catch (e) {
    rethrowDeadGrant(e)
    throw e
  }
}

export async function sendDraft(request: SendDraftRequest): Promise<void> {
  assertMessageFields(request, true)
  if (typeof request.draftId !== 'string' || !request.draftId.trim()) {
    throw new Error('Draft ID is required')
  }

  try {
    const gmail = getGmailClient()
    const from = await getAccountEmail()

    // Atomicity contract of the Gmail drafts API: drafts.update replaces
    // the draft content with exactly what the editor showed, then
    // drafts.send transmits and deletes the draft in one operation. Using
    // messages.send plus drafts.delete instead leaves a window where the
    // mail is out but the draft lingers, and a retry after a successful
    // send can duplicate the mail.
    const raw = await buildRawMessage(from, request)
    await writeDraft(gmail, request.draftId, raw, request.threadId)
    await withQuotaRetry(() =>
      gmail.users.drafts.send({
        userId: 'me',
        requestBody: { id: request.draftId }
      })
    )
  } catch (e) {
    rethrowDeadGrant(e)
    throw e
  }
}

// One draft-content write, the update half of both the autosave and the
// atomic send: it replaces the stored draft with exactly what the caller
// showed. sendDraft's comment above carries the atomicity contract.
async function writeDraft(
  gmail: gmail_v1.Gmail,
  draftId: string,
  raw: string,
  threadId?: string
): Promise<void> {
  await withQuotaRetry(() =>
    gmail.users.drafts.update({
      userId: 'me',
      id: draftId,
      requestBody: {
        message: {
          raw,
          ...(threadId ? { threadId } : {})
        }
      }
    })
  )
}

// The autosave persistence primitive: applies the composer's fields to a
// real Gmail draft, creating it on the first write, and answers with the
// draft id that later saves and the send path then keep using. Recipient
// is optional here, so this carries its own check, not the send one.
export async function saveDraft(request: SaveDraftRequest): Promise<string> {
  assertMessageFields(request, false)
  if (request.draftId !== undefined && typeof request.draftId !== 'string') {
    throw new Error('Invalid draft request')
  }

  try {
    const gmail = getGmailClient()
    const from = await getAccountEmail()
    const raw = await buildRawMessage(from, request)

    if (request.draftId) {
      await writeDraft(gmail, request.draftId, raw, request.threadId)
      return request.draftId
    }
    const created = await withQuotaRetry(() =>
      gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            raw,
            ...(request.threadId ? { threadId: request.threadId } : {})
          }
        }
      })
    )
    if (!created.data.id) throw new Error('Gmail returned no draft ID')
    return created.data.id
  } catch (e) {
    rethrowDeadGrant(e)
    throw e
  }
}

// The explicit-discard verb (Cancel): removes only the draft the autosave
// created. A vanished draft (consumed by send, deleted elsewhere) is not a
// failure — discard is idempotent, so a 404 settles as success.
export async function discardDraft(draftId: string): Promise<void> {
  if (typeof draftId !== 'string' || !draftId.trim()) throw new Error('Draft ID is required')

  try {
    const gmail = getGmailClient()
    await withQuotaRetry(() => gmail.users.drafts.delete({ userId: 'me', id: draftId }))
  } catch (e) {
    rethrowDeadGrant(e)
    if (isNotFoundError(e)) return
    throw e
  }
}
