import { useRef, useState } from 'react'
import type { SendQueue } from '../hooks/useSendQueue'
import { RecipientFields } from './RecipientFields'
import {
  composeRequest,
  hasRecipient,
  type ComposeBody,
  type RecipientState
} from '../../../shared/types'
import { useDraftAutosave } from './useDraftAutosave'
import { ComposerBody, type ComposerBodyHandle } from './ComposerBody'
import { useComposerAttachments } from './useComposerAttachments'
import { useUndoSend } from './useUndoSend'
type ComposeEditorProps = {
  onClose: () => void
  sessionSignal: AbortSignal
  queue: SendQueue
}
export function ComposeEditor({
  onClose,
  sessionSignal,
  queue
}: ComposeEditorProps): React.JSX.Element {
  const [recipients, setRecipients] = useState<RecipientState>({ to: '', cc: '', bcc: '' })
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState<ComposeBody>({ html: '', text: '' })
  const bodyRef = useRef<ComposerBodyHandle | null>(null)
  const [sent, setSent] = useState(false)
  const attach = useComposerAttachments(undefined, bodyRef)
  const request = composeRequest({ recipients, subject, body, attachments: attach.attachments })
  const autosave = useDraftAutosave(request, undefined, true, sessionSignal)
  const send = useUndoSend({
    autosave,
    bodyRef,
    queue,
    session: sessionSignal,
    onSent: () => setSent(true)
  })
  async function handleCancel(): Promise<void> {
    await autosave.flushPending()
    if (sessionSignal.aborted) return
    const draftId = autosave.currentDraft()?.draftId
    autosave.stop()
    onClose()
    if (draftId) void window.api.discardDraft(draftId)
  }
  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (sent || attach.picking || !hasRecipient(recipients)) return
    await send.send(request)
  }
  return (
    <form
      className={`composer composer-fill${attach.dropping ? ' composer-dragging' : ''}`}
      onSubmit={handleSend}
      hidden={send.hidden}
      inert={send.preparing}
      {...attach.drop}
    >
      <h2>New email</h2>

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

      {send.error && <p role="alert">{send.error}</p>}
      {autosave.error && <p role="alert">Draft not saved: {autosave.error}</p>}
      {autosave.status === 'saving' && <p role="status">Saving draft...</p>}
      {autosave.status === 'saved' && <p role="status">Draft saved.</p>}

      <div className="composerActions">
        <button type="button" onClick={handleCancel}>
          {sent ? 'Close' : 'Cancel'}
        </button>
        <button type="submit" disabled={sent || attach.picking || !hasRecipient(recipients)}>
          {send.preparing ? 'Saving draft...' : sent ? 'Sent' : 'Send'}
        </button>
      </div>
      {sent && <p role="status">Message sent.</p>}
    </form>
  )
}
