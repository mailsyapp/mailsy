import { getAccountEmail, getGmailClient } from '../auth'
import type { SendDraftRequest, SendEmailRequest } from '../../shared/types'
import { rethrowDeadGrant, withQuotaRetry } from './resilience'
import { buildRawMessage } from './mime'

function assertSendFields(request: SendEmailRequest): void {
  if (
    !request ||
    typeof request.to !== 'string' ||
    typeof request.subject !== 'string' ||
    typeof request.body !== 'string' ||
    (request.bodyHtml !== undefined && typeof request.bodyHtml !== 'string') ||
    (request.threadId !== undefined && typeof request.threadId !== 'string') ||
    (request.inReplyTo !== undefined && typeof request.inReplyTo !== 'string') ||
    (request.references !== undefined && typeof request.references !== 'string')
  ) {
    throw new Error('Invalid email request')
  }
  if (!request.to.trim()) throw new Error('Recipient is required')
}

async function resolveFromAddress(): Promise<string> {
  const from = await getAccountEmail()
  if (!from) throw new Error('Could not determine the signed-in Gmail address')
  return from
}

export async function sendEmail(request: SendEmailRequest): Promise<void> {
  assertSendFields(request)

  try {
    const gmail = getGmailClient()
    const from = await resolveFromAddress()
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
  assertSendFields(request)
  if (typeof request.draftId !== 'string' || !request.draftId.trim()) {
    throw new Error('Draft ID is required')
  }

  try {
    const gmail = getGmailClient()
    const from = await resolveFromAddress()

    // Atomicity contract of the Gmail drafts API: drafts.update replaces the
    // draft content with exactly what the editor showed, then drafts.send
    // transmits and deletes the draft in one operation. Using messages.send
    // plus drafts.delete instead leaves a window where the mail is out but
    // the draft lingers, and a retry after a successful send can duplicate
    // the mail.
    const raw = await buildRawMessage(from, request)

    await withQuotaRetry(() =>
      gmail.users.drafts.update({
        userId: 'me',
        id: request.draftId,
        requestBody: {
          message: {
            raw,
            ...(request.threadId ? { threadId: request.threadId } : {})
          }
        }
      })
    )
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
