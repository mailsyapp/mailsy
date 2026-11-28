import { useRef, useState } from 'react'
import { hasRecipient, type SendEmailRequest } from '../../../shared/types'
import { RecipientFields } from './RecipientFields'
import { ComposerBody, type ComposerBodyHandle } from './ComposerBody'
import {
  BLOCKED_DROP,
  useComposerAttachments,
  type AttachmentPrefill
} from './useComposerAttachments'
import { useDraftAutosave } from './useDraftAutosave'
import { useUndoSend } from './useUndoSend'
import { UndoSendNotice } from './UndoSendNotice'

type ThreadReplyFormProps = {
  draft: SendEmailRequest
  initialHtml: string
  prefill?: AttachmentPrefill
  sessionSignal: AbortSignal
  onChange: (patch: Partial<SendEmailRequest>) => void
  onCancel: () => void
  onSent: () => void
}

export function ThreadReplyForm({
  draft,
  initialHtml,
  prefill,
  sessionSignal,
  onChange,
  onCancel,
  onSent
}: ThreadReplyFormProps): React.JSX.Element {
  const bodyRef = useRef<ComposerBodyHandle | null>(null)
  const attach = useComposerAttachments(prefill, bodyRef)
  const [keepDraft, setKeepDraft] = useState(false)
  const request = { ...draft, ...attach.field }
  const autosave = useDraftAutosave(
    { ...request, ...attach.retained },
    undefined,
    keepDraft,
    sessionSignal,
    true,
    attach.adoptSaved
  )
  const send = useUndoSend(sessionSignal)

  function handleSend(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!attach.ready || attach.adding || !hasRecipient(draft)) return
    setKeepDraft(true)
    void send.start(request, autosave, onSent)
  }

  async function handleCancel(): Promise<void> {
    await autosave.flushPending()
    if (sessionSignal.aborted) return
    const target = autosave.currentDraft()
    autosave.stop()
    onCancel()
    if (target) void window.api.discardDraft(target.draftId)
  }

  return (
    <form
      className={`composer${attach.dropping ? ' composer-dragging' : ''}`}
      onSubmit={handleSend}
      {...(send.busy ? BLOCKED_DROP : attach.drop)}
    >
      <h2 id="composer-title">Compose email</h2>
      <div className="composerFields" inert={send.busy}>
        <RecipientFields
          to={draft.to}
          cc={draft.cc ?? ''}
          bcc={draft.bcc ?? ''}
          onChange={onChange}
        />
        <label className="composerField">
          <span>Subject</span>
          <input
            value={draft.subject}
            onChange={(event) => onChange({ subject: event.target.value })}
          />
        </label>
        <ComposerBody
          ref={bodyRef}
          attach={attach}
          initialHtml={initialHtml}
          onBodyChange={(content) =>
            onChange({ body: content.text, bodyHtml: content.html || undefined })
          }
        />
      </div>
      {send.error && <p role="alert">{send.error}</p>}
      {autosave.error && <p role="alert">Draft not saved: {autosave.error}</p>}
      {send.phase === 'waiting' && <UndoSendNotice onUndo={send.undo} />}
      <div className="composerActions">
        <button type="button" onClick={handleCancel} disabled={send.busy}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={send.busy || !attach.ready || attach.adding || !hasRecipient(draft)}
        >
          {send.buttonLabel}
        </button>
      </div>
    </form>
  )
}
