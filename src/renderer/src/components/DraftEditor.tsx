import { useRef, useState } from 'react'
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
import { BLOCKED_DROP, useComposerAttachments } from './useComposerAttachments'
import { plainTextToHtml } from '../lib/emailHtml'
import { useUndoSend } from './useUndoSend'
import { UndoSendNotice } from './UndoSendNotice'
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
  const send = useUndoSend(sessionSignal)
  function handleSend(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (sent || !attach.ready || attach.adding || !hasRecipient(recipients)) return
    const snapshot = draftId
      ? request
      : composeRequest({ recipients, subject, body, attachments: attach.attachments })
    void send.start(snapshot, autosave, () => {
      setSent(true)
      if (draftId) onSent()
    })
  }
  return (
    <form
      className={`composer composer-fill${attach.dropping ? ' composer-dragging' : ''}`}
      onSubmit={handleSend}
      {...(send.busy ? BLOCKED_DROP : attach.drop)}
    >
      <h2 id="draft-editor-title">Draft</h2>

      <div className="composerFields" inert={send.busy}>
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
      </div>

      {send.error && <p role="alert">{send.error}</p>}
      {autosave.error && (
        <p role="alert">
          {autosave.refsStale ? 'Attachment refresh required: ' : 'Draft not saved: '}
          {autosave.error}
        </p>
      )}
      {autosave.status === 'saving' && <p role="status">Saving draft...</p>}
      {autosave.status === 'saved' && <p role="status">Draft saved.</p>}
      {discardError && <p role="alert">Delete failed: {discardError}</p>}

      {send.phase === 'waiting' && <UndoSendNotice onUndo={send.undo} />}
      <div className="composerActions">
        <button type="button" onClick={onDraftDiscard} disabled={send.busy || sent}>
          delete draft
        </button>

        <button
          type="submit"
          disabled={
            send.busy || sent || !attach.ready || attach.adding || !hasRecipient(recipients)
          }
        >
          {sent ? 'Sent' : send.buttonLabel}
        </button>
      </div>
      {sent && (
        <p role="status">
          {draftId
            ? 'Message sent.'
            : 'Sent as a new message; the original draft entry was left in place (unknown draft ID).'}
        </p>
      )}
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
