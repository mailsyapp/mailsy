import { useState } from 'react'
import { RecipientFields } from './RecipientFields'
import { hasRecipient, type RecipientLines } from '../lib/recipients'
import { useDraftAutosave } from './useDraftAutosave'

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
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // Once sent, the form retires instead of re-arming: a second send would
  // be a real second message, not a retry (there is no draft to consume).
  const [sent, setSent] = useState(false)
  // The carbon lists ride the same autosave payload as everything else, so
  // a restored draft reopens with them.
  const autosave = useDraftAutosave({ to, cc, bcc, subject, body }, undefined, true)

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

  function handleRecipientChange(patch: RecipientLines): void {
    if (patch.to !== undefined) setTo(patch.to)
    if (patch.cc !== undefined) setCc(patch.cc)
    if (patch.bcc !== undefined) setBcc(patch.bcc)
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    // The Enter key submits the form even with the Send button disabled, so
    // the receipt test lives here, not only on the button.
    if (sending || sent || !hasRecipient({ to, cc, bcc })) return

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
          await window.api.sendDraft({ draftId, to, cc, bcc, subject, body })
        } else {
          await window.api.sendEmail({ to, cc, bcc, subject, body })
        }
      } finally {
        autosave.resume()
      }
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
    <form className="composer composer-fill" onSubmit={handleSend}>
      <h2>New email</h2>

      <RecipientFields to={to} cc={cc} bcc={bcc} onChange={handleRecipientChange} />

      <label className="composerField">
        <span>Subject</span>
        <input value={subject} onChange={(event) => setSubject(event.target.value)} />
      </label>

      <label className="composerField composerField-grow">
        <span>Message</span>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} />
      </label>

      {sendError && <p role="alert">{sendError}</p>}
      {autosave.error && <p role="alert">Draft not saved: {autosave.error}</p>}
      {autosave.status === 'saving' && <p role="status">Saving draft...</p>}
      {autosave.status === 'saved' && <p role="status">Draft saved.</p>}

      <div className="composerActions">
        <button type="button" onClick={handleCancel}>
          {sent ? 'Close' : 'Cancel'}
        </button>
        <button type="submit" disabled={sending || sent || !hasRecipient({ to, cc, bcc })}>
          {sending ? 'Sending...' : sent ? 'Sent' : 'Send'}
        </button>
      </div>
      {sent && <p role="status">Message sent.</p>}
    </form>
  )
}
