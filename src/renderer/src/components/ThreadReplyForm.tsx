import { useRef, useState } from 'react'
import { hasRecipient, type SendEmailRequest } from '../../../shared/types'
import type { SendQueue } from '../hooks/useSendQueue'
import { RecipientFields } from './RecipientFields'
import { ComposerBody, type ComposerBodyHandle } from './ComposerBody'
import { useComposerAttachments, type AttachmentPrefill } from './useComposerAttachments'
import { useDraftAutosave } from './useDraftAutosave'
import { useUndoSend } from './useUndoSend'

type ThreadReplyFormProps = {
  draft: SendEmailRequest
  initialHtml: string
  prefill?: AttachmentPrefill
  queue: SendQueue
  sessionSignal: AbortSignal
  onChange: (patch: Partial<SendEmailRequest>) => void
  onCancel: () => void
  onSent: () => void
}

export function ThreadReplyForm({
  draft,
  initialHtml,
  prefill,
  queue,
  sessionSignal,
  onChange,
  onCancel,
  onSent
}: ThreadReplyFormProps): React.JSX.Element {
  const bodyRef = useRef<ComposerBodyHandle | null>(null)
  const attach = useComposerAttachments(prefill, bodyRef)
  const [hasSavedDraft, setHasSavedDraft] = useState(false)
  const request = { ...draft, ...attach.field }
  const autosave = useDraftAutosave(
    { ...request, ...attach.retained },
    undefined,
    hasSavedDraft,
    sessionSignal,
    true,
    attach.adoptSaved
  )
  const send = useUndoSend({
    autosave,
    bodyRef,
    queue,
    session: sessionSignal,
    onQueued: () => setHasSavedDraft(true),
    onSent
  })

  async function handleCancel(): Promise<void> {
    await autosave.flushPending()
    if (sessionSignal.aborted) return
    const saved = autosave.currentDraft()
    autosave.stop()
    onCancel()
    if (saved) void window.api.discardDraft(saved.draftId)
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!attach.ready || attach.picking || !hasRecipient(draft)) return
    await send.send(request)
  }

  return (
    <form
      className={`composer${attach.dropping ? ' composer-dragging' : ''}`}
      onSubmit={handleSend}
      hidden={send.hidden}
      inert={send.preparing}
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
      {send.error && <p role="alert">{send.error}</p>}
      {autosave.error && <p role="alert">Draft not saved: {autosave.error}</p>}
      <div className="composerActions">
        <button type="button" onClick={handleCancel}>
          Cancel
        </button>
        <button type="submit" disabled={!attach.ready || attach.picking || !hasRecipient(draft)}>
          {send.preparing ? 'Saving draft...' : 'Send'}
        </button>
      </div>
    </form>
  )
}
