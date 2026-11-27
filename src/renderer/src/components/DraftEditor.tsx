import { useRef, useState } from 'react'
import { errorMessage } from '../lib/format'
import type { EmailDetail as EmailDetailData, ThreadSummary } from '../../../shared/types'
import {
  composeRequest,
  hasRecipient,
  type ComposeBody,
  type RecipientState
} from '../../../shared/types'
import { RecipientFields } from './RecipientFields'
import { useDraftAutosave } from './useDraftAutosave'
import { ComposerBody, type ComposerBodyHandle } from './ComposerBody'
import { useComposerAttachments } from './useComposerAttachments'
import { plainTextToHtml } from '../lib/emailHtml'
import { blockImplicitSubmit } from '../lib/composerForm'
type DraftEditorProps = {
  row: ThreadSummary
  detail: EmailDetailData | null
  detailLoading: boolean
  sessionSignal: AbortSignal
  onSent: () => void
  onDraftDiscard: () => void
  discardError: string | null
}
function DraftForm({
  detail,
  draftId,
  sessionSignal,
  onSent,
  onDraftDiscard,
  discardError
}: {
  detail: EmailDetailData
  draftId?: string
  sessionSignal: AbortSignal
  onSent: () => void
  onDraftDiscard: () => void
  discardError: string | null
}): React.JSX.Element {
  const [recipients, setRecipients] = useState<RecipientState>({
    to: detail.to || '',
    cc: detail.cc || '',
    bcc: detail.bcc || ''
  })
  const [subject, setSubject] = useState(detail.subject || '')
  const initialHtml = detail.bodyHtml ?? plainTextToHtml(detail.bodyText || detail.snippet || '')
  const initialText = detail.bodyText || detail.snippet || ''
  const [body, setBody] = useState<ComposeBody>(() => ({ html: initialHtml, text: initialText }))
  const bodyRef = useRef<ComposerBodyHandle | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [edited, setEdited] = useState(false)
  const attach = useComposerAttachments(
    detail.attachments.length ? { messageId: detail.id, refs: detail.attachments } : undefined,
    bodyRef
  )
  const request = composeRequest({
    recipients,
    subject,
    body,
    attachments: attach.attachments,
    thread: {
      threadId: detail.threadId || undefined,
      inReplyTo: detail.inReplyTo || undefined,
      references: detail.references || undefined
    }
  })
  const autosave = useDraftAutosave(
    { ...request, ...attach.retained },
    draftId ? { draftId, messageId: detail.id } : undefined,
    draftId !== undefined,
    sessionSignal,
    edited || attach.edited,
    attach.adoptSaved
  )
  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (sending || sent || !attach.ready || !hasRecipient(recipients)) return
    setSending(true)
    setSendError(null)
    setNotice(null)
    try {
      await autosave.flushPending()
      if (sessionSignal.aborted) return
      autosave.suspend()
      try {
        const target = autosave.currentDraft()
        if (target) {
          await window.api.sendDraft({ ...request, ...target })
        } else {
          await window.api.sendEmail(
            composeRequest({ recipients, subject, body, attachments: attach.attachments })
          )
          setNotice(
            'Sent as a new message; the original draft entry was left in place (unknown draft ID).'
          )
          return
        }
      } finally {
        autosave.resume()
      }
      if (sessionSignal.aborted) return
      autosave.stop()
      setSent(true)
      onSent()
    } catch (error) {
      setSendError(errorMessage(error))
    } finally {
      setSending(false)
    }
  }
  return (
    <form
      className={`composer composer-fill${attach.dropping ? ' composer-dragging' : ''}`}
      onSubmit={handleSend}
      onKeyDown={blockImplicitSubmit}
      {...attach.drop}
    >
      <h2 id="draft-editor-title">Draft</h2>

      <RecipientFields
        to={recipients.to}
        cc={recipients.cc}
        bcc={recipients.bcc}
        onChange={(patch) => {
          setEdited(true)
          setRecipients({ ...recipients, ...patch })
        }}
      />

      <label className="composerField">
        <span>Subject</span>
        <input
          value={subject}
          onChange={(event) => {
            setEdited(true)
            setSubject(event.target.value)
          }}
        />
      </label>

      <ComposerBody
        ref={bodyRef}
        attach={attach}
        initialHtml={initialHtml}
        onBodyChange={(value, source) => {
          if (source === 'edit') setEdited(true)
          setBody(value)
        }}
      />

      {sendError && <p role="alert">{sendError}</p>}
      {notice && <p role="status">{notice}</p>}
      {autosave.error && (
        <p role="alert">
          {autosave.refsStale ? 'Attachment refresh required: ' : 'Draft not saved: '}
          {autosave.error}
        </p>
      )}
      {autosave.status === 'saving' && <p role="status">Saving draft...</p>}
      {autosave.status === 'saved' && <p role="status">Draft saved.</p>}
      {discardError && <p role="alert">Delete failed: {discardError}</p>}

      <div className="composerActions">
        <button type="button" onClick={onDraftDiscard} disabled={sending || sent}>
          delete draft
        </button>

        <button
          type="submit"
          disabled={sending || sent || !attach.ready || !hasRecipient(recipients)}
        >
          {sending ? 'Sending...' : sent ? 'Sent' : 'Send'}
        </button>
      </div>
      {sent && <p role="status">Message sent.</p>}
    </form>
  )
}
export function DraftEditor({
  row,
  detail,
  detailLoading,
  sessionSignal,
  onSent,
  onDraftDiscard,
  discardError
}: DraftEditorProps): React.JSX.Element {
  if (detailLoading || !detail) {
    return (
      <div>
        <h2>{row.subject}</h2>
        <p>Loading draft...</p>
      </div>
    )
  }
  return (
    <DraftForm
      key={detail.id}
      detail={detail}
      draftId={row.draftId}
      sessionSignal={sessionSignal}
      onSent={onSent}
      onDraftDiscard={onDraftDiscard}
      discardError={discardError}
    />
  )
}
