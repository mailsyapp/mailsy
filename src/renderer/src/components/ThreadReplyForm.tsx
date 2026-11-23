import { useRef, useState } from 'react'
import { hasRecipient, type SendEmailRequest } from '../../../shared/types'
import { errorMessage } from '../lib/format'
import { RecipientFields } from './RecipientFields'
import { ComposerBody, type ComposerBodyHandle } from './ComposerBody'
import { useComposerAttachments, type AttachmentPrefill } from './useComposerAttachments'

type ThreadReplyFormProps = {
  draft: SendEmailRequest
  initialHtml: string
  prefill?: AttachmentPrefill
  onChange: (patch: Partial<SendEmailRequest>) => void
  onCancel: () => void
  onSent: () => void
}

export function ThreadReplyForm({
  draft,
  initialHtml,
  prefill,
  onChange,
  onCancel,
  onSent
}: ThreadReplyFormProps): React.JSX.Element {
  const bodyRef = useRef<ComposerBodyHandle | null>(null)
  const attach = useComposerAttachments(prefill, bodyRef)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (sending || !attach.ready || !hasRecipient(draft)) return
    setSending(true)
    setSendError(null)
    try {
      await window.api.sendEmail({ ...draft, ...attach.field })
      onSent()
    } catch (error) {
      setSendError(errorMessage(error))
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      className={`composer${attach.dropping ? ' composer-dragging' : ''}`}
      onSubmit={handleSend}
      {...attach.drop}
    >
      <h2 id="composer-title">Compose email</h2>
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
      {sendError && <p role="alert">{sendError}</p>}
      <div className="composerActions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={sending || !attach.ready || !hasRecipient(draft)}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
  )
}
