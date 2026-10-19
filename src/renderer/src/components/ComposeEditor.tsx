import { useState } from 'react'

type ComposeEditorProps = {
  // Closes the composer without sending. App owns the content pane (an open
  // compose and an open email are mutually exclusive), so this is the same
  // close that selecting a row or switching folders runs.
  onClose: () => void
}

// A fresh message is a SendEmailRequest with no thread/in-reply fields; the
// request shape is the marker, so the regular send bridge covers it as-is.
export function ComposeEditor({ onClose }: ComposeEditorProps): React.JSX.Element {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // Once sent, the form retires instead of re-arming: a second send would be
  // a real second message, not a retry (there is no draft to consume).
  const [sent, setSent] = useState(false)

  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (sending || sent || !to.trim()) return

    setSending(true)
    setSendError(null)
    try {
      await window.api.sendEmail({ to, subject, body })
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

      <label className="composerField">
        <span>To</span>
        <input required value={to} onChange={(event) => setTo(event.target.value)} />
      </label>

      <label className="composerField">
        <span>Subject</span>
        <input value={subject} onChange={(event) => setSubject(event.target.value)} />
      </label>

      <label className="composerField composerField-grow">
        <span>Message</span>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} />
      </label>

      {sendError && <p role="alert">{sendError}</p>}

      <div className="composerActions">
        <button type="button" onClick={onClose}>
          {sent ? 'Close' : 'Cancel'}
        </button>
        <button type="submit" disabled={sending || sent || !to.trim()}>
          {sending ? 'Sending...' : sent ? 'Sent' : 'Send'}
        </button>
      </div>
      {sent && <p role="status">Message sent.</p>}
    </form>
  )
}
