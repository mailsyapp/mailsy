import { useRef, useState } from 'react'
import { RecipientFields } from './RecipientFields'
import {
  composeRequest,
  hasRecipient,
  type ComposeBody,
  type RecipientState
} from '../../../shared/types'
import { useDraftAutosave } from './useDraftAutosave'
import { ComposerBody, type ComposerBodyHandle } from './ComposerBody'
import { BLOCKED_DROP, useComposerAttachments } from './useComposerAttachments'
import { useUndoSend } from './useUndoSend'
import { UndoSendNotice } from './UndoSendNotice'
type ComposeEditorProps = {
  onClose: () => void
  sessionSignal: AbortSignal
}
export function ComposeEditor({ onClose, sessionSignal }: ComposeEditorProps): React.JSX.Element {
  const [recipients, setRecipients] = useState<RecipientState>({ to: '', cc: '', bcc: '' })
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState<ComposeBody>({ html: '', text: '' })
  const bodyRef = useRef<ComposerBodyHandle | null>(null)
  const [sent, setSent] = useState(false)
  const attach = useComposerAttachments(undefined, bodyRef)
  const request = composeRequest({ recipients, subject, body, attachments: attach.attachments })
  const autosave = useDraftAutosave(request, undefined, true, sessionSignal)
  const send = useUndoSend(sessionSignal)
  async function handleCancel(): Promise<void> {
    await autosave.flushPending()
    if (sessionSignal.aborted) return
    const draftId = autosave.currentDraft()?.draftId
    autosave.stop()
    onClose()
    if (draftId) void window.api.discardDraft(draftId)
  }
  function handleSend(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (sent || attach.adding || !hasRecipient(recipients)) return
    void send.start(request, autosave, () => setSent(true))
  }
  return (
    <form
      className={`composer composer-fill${attach.dropping ? ' composer-dragging' : ''}`}
      onSubmit={handleSend}
      {...(send.busy ? BLOCKED_DROP : attach.drop)}
    >
      <h2>New email</h2>

      <div className="composerFields" inert={send.busy}>
        <RecipientFields
          to={recipients.to}
          cc={recipients.cc}
          bcc={recipients.bcc}
          onChange={(patch) => setRecipients({ ...recipients, ...patch })}
        />

        <label className="composerField">
          <span>Subject</span>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} />
        </label>

        <ComposerBody ref={bodyRef} attach={attach} onBodyChange={setBody} autoSignature />
      </div>

      {send.error && <p role="alert">{send.error}</p>}
      {autosave.error && <p role="alert">Draft not saved: {autosave.error}</p>}
      {autosave.status === 'saving' && <p role="status">Saving draft...</p>}
      {autosave.status === 'saved' && <p role="status">Draft saved.</p>}

      {send.phase === 'waiting' && <UndoSendNotice onUndo={send.undo} />}
      <div className="composerActions">
        <button type="button" onClick={handleCancel} disabled={send.busy}>
          {sent ? 'Close' : 'Cancel'}
        </button>
        <button
          type="submit"
          disabled={send.busy || sent || attach.adding || !hasRecipient(recipients)}
        >
          {sent ? 'Sent' : send.buttonLabel}
        </button>
      </div>
      {sent && <p role="status">Message sent.</p>}
    </form>
  )
}
