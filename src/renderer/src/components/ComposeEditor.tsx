import { useRef, useState } from 'react'
import { RecipientFields } from './RecipientFields'
import { hasRecipient, type RecipientState } from '../../../shared/types'
import { useDraftAutosave } from './useDraftAutosave'
import { AttachmentChips } from './AttachmentChips'
import { BodyEditor, type BodyEditorHandle } from './BodyEditor'
import { useComposerAttachments } from './useComposerAttachments'

type ComposeEditorProps = {
  // Closes the composer without sending. App owns the content pane (an open
  // compose and an open email are mutually exclusive), so this is the same
  // close that selecting a row or switching folders runs.
  onClose: () => void
}

// A fresh message is a SendEmailRequest with no thread/in-reply fields; the
// request shape is the marker, so the regular send bridge covers it as-is.
//
// The compose autosaves into a real Gmail draft as it is typed, Gmail-style:
// closing the pane without Cancel or Send (row click, folder switch, reset)
// leaves the draft in the Drafts folder instead of losing the text. Cancel
// discards it; Send consumes it through the atomic update+send pair.
export function ComposeEditor({ onClose }: ComposeEditorProps): React.JSX.Element {
  // One recipients block, not three loose lines: a recipient edit is one
  // spread and the send payloads reuse the object as-is.
  const [recipients, setRecipients] = useState<RecipientState>({ to: '', cc: '', bcc: '' })
  const [subject, setSubject] = useState('')
  // The body lives in two forms from the one editor: the rich html the
  // send/autosave carries and the plain-text fallback with it.
  const [body, setBody] = useState<{ html: string; text: string }>({ html: '', text: '' })
  const editorRef = useRef<BodyEditorHandle | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // Once sent, the form retires instead of re-arming: a second send would
  // be a real second message, not a retry (there is no draft to consume).
  const [sent, setSent] = useState(false)
  // Local files picked with the native dialog; the records ride every
  // autosave and send payload below like the text fields do, so a restored
  // draft reopens with them.
  const attach = useComposerAttachments(
    undefined,
    (files) =>
      // Image files dropped on the composer chrome route into the rich body;
      // the editor's own surface handles its drops at the caret instead.
      void editorRef.current?.insertImages(files)
  )
  const autosave = useDraftAutosave(
    { ...recipients, subject, body: body.text, bodyHtml: body.html || undefined, ...attach.field },
    undefined,
    true
  )

  async function handleCancel(): Promise<void> {
    // Cancel is today's discard action: let any in-flight or queued write
    // settle first (a create that has not resolved yet has no draft id to
    // discard), then stop autosave (this unmount must not flush), delete
    // the draft the autosave created, if any, and close. A delete failure
    // leaves the draft in the Drafts folder — visible there, never
    // silently lost.
    await autosave.flushPending()
    const draftId = autosave.currentDraftId()
    autosave.stop()
    onClose()
    if (draftId) void window.api.discardDraft(draftId)
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    // The Enter key submits the form even with the Send button disabled, so
    // the receipt test lives here, not only on the button.
    if (sending || sent || !hasRecipient(recipients)) return

    setSending(true)
    setSendError(null)
    try {
      // Absorb any autosave write in flight, then branch by whether the
      // compose has a server draft at all: with one, send through the
      // atomic update+send pair so it is consumed in the same operation
      // (messages.send would leave the live draft lingering in Drafts);
      // without one, the typed-and-sent-instantly case is still today's
      // fresh send.
      await autosave.flushPending()
      const draftId = autosave.currentDraftId()
      autosave.suspend()
      try {
        if (draftId) {
          await window.api.sendDraft({
            draftId,
            ...recipients,
            subject,
            body: body.text,
            bodyHtml: body.html || undefined,
            ...attach.field
          })
        } else {
          await window.api.sendEmail({
            ...recipients,
            subject,
            body: body.text,
            bodyHtml: body.html || undefined,
            ...attach.field
          })
        }
      } finally {
        autosave.resume()
      }
      autosave.stop()
      setSent(true)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error))
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

      <label className="composerField composerField-grow">
        <span>Message</span>
        <BodyEditor
          ref={editorRef}
          initialHtml=""
          placeholder="Type your message..."
          onNonImageFiles={(files) => void attach.addFiles(files)}
          onChange={setBody}
        />
      </label>

      <AttachmentChips
        attachments={attach.attachments}
        error={attach.error}
        picking={attach.picking}
        onPick={attach.pick}
        onRemove={attach.remove}
      />

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
