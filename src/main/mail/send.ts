import { getAccountEmail, getGmailClient } from '../auth'
import {
  attachmentsLimitError,
  ATTACHMENTS_TOTAL_LIMIT_BYTES,
  decodedAttachmentBytes,
  type SaveDraftRequest,
  type SendDraftRequest,
  type SendEmailRequest
} from '../../shared/types'
import { hasRecipient } from '../../shared/types'
import { isNotFoundError, rethrowDeadGrant, withQuotaRetry } from './resilience'
import { buildRawMessage } from './mime'
import type { gmail_v1 } from 'googleapis'

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
    (request.references !== undefined && typeof request.references !== 'string') ||
    !attachmentsShaped(request)
  ) {
    throw new Error('Invalid email request')
  }
  if (requireRecipient && !hasRecipient(request)) throw new Error('Recipient is required')
  const totalBytes = attachmentsBytes(request)
  if (totalBytes > ATTACHMENTS_TOTAL_LIMIT_BYTES) {
    throw new Error(attachmentsLimitError(totalBytes))
  }
}

function attachmentsShaped(request: SendEmailRequest): boolean {
  if (request.attachments === undefined) return true
  if (!Array.isArray(request.attachments)) return false
  return request.attachments.every(
    (attachment) =>
      !!attachment &&
      typeof attachment === 'object' &&
      typeof attachment.filename === 'string' &&
      typeof attachment.size === 'number' &&
      typeof attachment.data === 'string' &&
      attachment.data.length > 0
  )
}

function attachmentsBytes(request: SendEmailRequest): number {
  if (!request.attachments) return 0
  return request.attachments.reduce(
    (sum, attachment) => sum + decodedAttachmentBytes(attachment),
    0
  )
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
