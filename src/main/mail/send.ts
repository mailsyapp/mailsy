import { getAccountEmail, getGmailClient, getMailSession } from '../auth'
import {
  attachmentsLimitError,
  ATTACHMENTS_TOTAL_LIMIT_BYTES,
  decodedAttachmentBytes,
  type SaveDraftRequest,
  type SaveDraftResult,
  type SendDraftRequest,
  type SendEmailRequest
} from '../../shared/types'
import { hasRecipient } from '../../shared/types'
import { isNotFoundError, rethrowDeadGrant, withQuotaRetry } from './resilience'
import { buildRawMessage, collectBodies, type MessageBodies } from './mime'
import { fetchAttachment } from './messages'
import type { gmail_v1 } from 'googleapis'
let discardSession: symbol | undefined
let localDiscards = new Map<string, Promise<void>>()
function discardsFor(session: symbol): Map<string, Promise<void>> {
  if (discardSession !== session) {
    discardSession = session
    localDiscards = new Map()
  }
  return localDiscards
}
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
      (attachment.data.length > 0 || attachment.size === 0) &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(attachment.data) &&
      (attachment.data.includes('=')
        ? attachment.data.length % 4 === 0
        : attachment.data.length % 4 !== 1)
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
  assertExpectedMessageId(request.expectedMessageId)
  try {
    const session = getMailSession()
    const gmail = getGmailClient()
    const from = await getAccountEmail()
    const raw = await buildRawMessage(from, request)
    const { draftId, expectedMessageId, threadId } = request
    await withQuotaRetry(async () => {
      if (!(await isCurrentDraftVersion(gmail, draftId, expectedMessageId, session))) {
        throw draftConflict()
      }
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
function draftConflict(): Error {
  return new Error('Draft changed in Gmail. Leaving keeps your unsaved edits as a separate draft.')
}
async function isCurrentDraftVersion(
  gmail: gmail_v1.Gmail,
  draftId: string,
  expectedMessageId: string | undefined,
  session: symbol
): Promise<boolean> {
  if (expectedMessageId === undefined) return true
  const current = await gmail.users.drafts.get({ userId: 'me', id: draftId, format: 'minimal' })
  if (getMailSession() !== session) throw new Error('Mail account changed')
  return current.data.message?.id === expectedMessageId
}
export async function saveDraft(request: SaveDraftRequest): Promise<SaveDraftResult> {
  assertMessageFields(request, false)
  if (request.draftId !== undefined && typeof request.draftId !== 'string') {
    throw new Error('Invalid draft request')
  }
  assertExpectedMessageId(request.expectedMessageId)
  const retain = request.retainAttachments
  if (
    retain !== undefined &&
    (!retain ||
      typeof retain !== 'object' ||
      typeof retain.messageId !== 'string' ||
      !retain.messageId.trim() ||
      !Array.isArray(retain.refs) ||
      !retain.refs.every(
        (ref) =>
          ref &&
          typeof ref === 'object' &&
          typeof ref.filename === 'string' &&
          typeof ref.size === 'number' &&
          Number.isFinite(ref.size) &&
          ref.size >= 0 &&
          typeof ref.attachmentId === 'string' &&
          !!ref.attachmentId.trim()
      ))
  )
    throw new Error('Invalid draft request')
  try {
    const session = getMailSession()
    const gmail = getGmailClient()
    const from = await getAccountEmail()
    const retained = retain
      ? await Promise.all(
          retain.refs.map(async (ref) => ({
            filename: ref.filename,
            size: ref.size,
            data: await fetchAttachment(retain.messageId, ref.attachmentId)
          }))
        )
      : []
    if (getMailSession() !== session) throw new Error('Mail account changed')
    const fields = { ...request, attachments: [...(request.attachments ?? []), ...retained] }
    assertMessageFields(fields, false)
    const raw = await buildRawMessage(from, fields)
    const { draftId, expectedMessageId, threadId, copyOnConflict } = request
    const requestBody = { message: { raw, ...(threadId ? { threadId } : {}) } }
    const saved = await withQuotaRetry(async () => {
      if (draftId) {
        try {
          if (await isCurrentDraftVersion(gmail, draftId, expectedMessageId, session)) {
            return await gmail.users.drafts.update({ userId: 'me', id: draftId, requestBody })
          }
          if (copyOnConflict !== true) throw draftConflict()
        } catch (e) {
          if (copyOnConflict !== true || !isNotFoundError(e)) throw e
        }
        if (getMailSession() !== session) throw new Error('Mail account changed')
        const discard = discardsFor(session).get(draftId)
        if (discard) {
          const discarded = await discard.then(
            () => true,
            () => false
          )
          if (discarded) throw new Error('Draft was discarded')
          if (getMailSession() !== session) throw new Error('Mail account changed')
        }
        return gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } })
      }
      return gmail.users.drafts.create({ userId: 'me', requestBody })
    }, session)
    if (!saved.data.id || !saved.data.message?.id)
      throw new Error('Gmail returned no draft version')
    const committedId = saved.data.id
    try {
      const readback = await withQuotaRetry(
        () =>
          gmail.users.drafts.get({
            userId: 'me',
            id: committedId,
            format: 'full'
          }),
        session
      )
      if (!readback.data.message?.id || !readback.data.message.payload)
        throw new Error('Gmail returned no saved message')
      const bodies: MessageBodies = { text: '', html: '', inlineImages: [], attachments: [] }
      collectBodies(readback.data.message.payload, bodies)
      const retainedAttachments = (retain?.refs ?? []).map((ref, index) => {
        const next = bodies.attachments[(request.attachments?.length ?? 0) + index]
        if (!next || next.filename !== ref.filename)
          throw new Error('Gmail returned no retained attachment')
        return { previousAttachmentId: ref.attachmentId, ref: next }
      })
      return {
        draftId: committedId,
        messageId: readback.data.message.id,
        previousMessageId: retain?.messageId,
        retainedAttachments
      }
    } catch {
      return {
        draftId: committedId,
        messageId: saved.data.message.id,
        previousMessageId: retain?.messageId,
        retainedAttachments: [],
        refsStale: true
      }
    }
  } catch (e) {
    rethrowDeadGrant(e)
    throw e
  }
}
export async function discardDraft(draftId: string): Promise<void> {
  if (typeof draftId !== 'string' || !draftId.trim()) throw new Error('Draft ID is required')
  const session = getMailSession()
  const discards = discardsFor(session)
  const existing = discards.get(draftId)
  if (existing) return existing
  const gmail = getGmailClient()
  const discard = withQuotaRetry(
    () => gmail.users.drafts.delete({ userId: 'me', id: draftId }),
    session
  ).then(
    () => undefined,
    (e: unknown) => {
      if (isNotFoundError(e)) return
      discards.delete(draftId)
      throw e
    }
  )
  discards.set(draftId, discard)
  return discard
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
