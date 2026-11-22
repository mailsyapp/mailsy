import { getAccountEmail, getGmailClient, getMailSession } from '../auth'
import {
  attachmentsLimitError,
  ATTACHMENTS_TOTAL_LIMIT_BYTES,
  decodedAttachmentBytes,
  type DraftVersion,
  type SaveDraftRequest,
  type SendDraftRequest,
  type SendEmailRequest
} from '../../shared/types'
import { hasRecipient } from '../../shared/types'
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
    (request.references !== undefined && typeof request.references !== 'string') ||
    !attachmentsShaped(request)
  ) {
    throw new Error('Invalid email request')
  }
  // The send receipt test is the shared rule; main re-asks it at the trust
  // boundary so a renderer that skipped the gate still cannot send empty.
  if (requireRecipient && !hasRecipient(request)) throw new Error('Recipient is required')
  const totalBytes = attachmentsBytes(request)
  if (totalBytes > ATTACHMENTS_TOTAL_LIMIT_BYTES) {
    throw new Error(attachmentsLimitError(totalBytes))
  }
}

// Field shapes only: every listed entry must be a fully shaped
// ComposeAttachment (the bridge carries bytes, so a partial entry would
// produce a corrupt MIME part). Size lives on its own rule below.
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

// Decoded byte total across the list; 0 for any request without one. The
// picker computed the same number from the real files, and a mutated
// request can arrive with anything, so main re-asks before building MIME.
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
  assertExpectedMessageId(request.expectedMessageId)

  try {
    const session = getMailSession()
    const gmail = getGmailClient()
    const from = await getAccountEmail()
    const raw = await buildRawMessage(from, request)
    const { draftId, expectedMessageId, threadId } = request
    await withQuotaRetry(async () => {
      await ensureDraftVersion(gmail, draftId, expectedMessageId, session)
      return gmail.users.drafts.send({
        userId: 'me',
        requestBody: { id: draftId, message: { raw, ...(threadId ? { threadId } : {}) } }
      })
    }, session)
  } catch (e) {
    rethrowDeadGrant(e)
    throw e
  }
}

function assertExpectedMessageId(id: unknown): void {
  if (id !== undefined && (typeof id !== 'string' || !id.trim())) {
    throw new Error('Invalid draft message ID')
  }
}

async function ensureDraftVersion(
  gmail: gmail_v1.Gmail,
  draftId: string,
  expectedMessageId: string | undefined,
  session: symbol
): Promise<void> {
  // Gmail replaces the underlying message on every update, but does not offer a conditional write.
  if (expectedMessageId === undefined) return
  const current = await gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'minimal' })
  if (getMailSession() !== session) throw new Error('Mail account changed')
  if (current.data.message?.id !== expectedMessageId) {
    throw new Error('Draft changed in Gmail. Copy your edits and reopen the draft before retrying.')
  }
}

export async function saveDraft(request: SaveDraftRequest): Promise<DraftVersion> {
  assertMessageFields(request, false)
  if (request.draftId !== undefined && typeof request.draftId !== 'string') {
    throw new Error('Invalid draft request')
  }
  assertExpectedMessageId(request.expectedMessageId)

  try {
    const session = getMailSession()
    const gmail = getGmailClient()
    const from = await getAccountEmail()
    const raw = await buildRawMessage(from, request)

    const { draftId, expectedMessageId, threadId } = request
    const requestBody = { message: { raw, ...(threadId ? { threadId } : {}) } }
    const saved = await withQuotaRetry(async () => {
      if (!draftId) return gmail.users.drafts.create({ userId: 'me', requestBody })
      await ensureDraftVersion(gmail, draftId, expectedMessageId, session)
      return gmail.users.drafts.update({ userId: 'me', id: draftId, requestBody })
    }, session)
    if (!saved.data.id || !saved.data.message?.id)
      throw new Error('Gmail returned no draft version')
    return { draftId: saved.data.id, messageId: saved.data.message.id }
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

export async function draftExists(draftId: string): Promise<boolean> {
  if (typeof draftId !== 'string' || !draftId.trim()) throw new Error('Draft ID is required')

  const gmail = getGmailClient()
  try {
    await withQuotaRetry(() =>
      gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'minimal' })
    )
    return true
  } catch (e) {
    if (isNotFoundError(e)) return false
    throw e
  }
}
