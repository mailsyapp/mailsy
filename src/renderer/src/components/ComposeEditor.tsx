import { useRef, useState } from 'react'
import { errorMessage } from '../lib/format'
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

type ComposeEditorProps = {
  onClose: () => void
}

export function ComposeEditor({ onClose }: ComposeEditorProps): React.JSX.Element {
  const [recipients, setRecipients] = useState<RecipientState>({ to: '', cc: '', bcc: '' })
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState<ComposeBody>({ html: '', text: '' })
  const bodyRef = useRef<ComposerBodyHandle | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const attach = useComposerAttachments(undefined, bodyRef)
  const request = composeRequest({ recipients, subject, body, attachments: attach.attachments })
  const autosave = useDraftAutosave(request, undefined, true)

  async function handleCancel(): Promise<void> {
    await autosave.flushPending()
    const draftId = autosave.currentDraftId()
    autosave.stop()
    onClose()
    if (draftId) void window.api.discardDraft(draftId)
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (sending || sent || !hasRecipient(recipients)) return

    setSending(true)
    setSendError(null)
    try {
      await autosave.flushPending()
      const draftId = autosave.currentDraftId()
      autosave.suspend()
      try {
        if (draftId) {
          await window.api.sendDraft({ draftId, ...request })
        } else {
          await window.api.sendEmail(request)
        }
      } finally {
        autosave.resume()
      }
      autosave.stop()
      setSent(true)
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

      {sendError && <p role="alert">{sendError}</p>}
      {autosave.error && <p role="alert">Draft not saved: {autosave.error}</p>}
      {autosave.status === 'saving' && <p role="status">Saving draft...</p>}
      {autosave.status === 'saved' && <p role="status">Draft saved.</p>}

      <div className="composerActions">
        <button type="button" onClick={handleCancel}>
          {sent ? 'Close' : 'Cancel'}
        </button>
        <button type="submit" disabled={sending || sent || !hasRecipient(recipients)}>
          {sending ? 'Sending...' : sent ? 'Sent' : 'Send'}
        </button>
      </div>
      {sent && <p role="status">Message sent.</p>}
    </form>
  )
}
