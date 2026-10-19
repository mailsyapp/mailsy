import { useState } from 'react'
import type { EmailDetail as EmailDetailData, ThreadSummary } from '../../../shared/types'

type DraftEditorProps = {
  // The draft row: subject plus the draftId/messageIds the send path needs.
  row: ThreadSummary
  detail: EmailDetailData | null
  detailLoading: boolean
  // Reports the sent draft's row id once the send succeeded. Row removal is
  // owned by App (2s delay so the "Message sent." proof stays on screen,
  // exactly-once by construction because App never unmounts).
  onSent: (id: string) => void
}

function DraftForm({
  detail,
  draftId,
  messageId,
  onSent
}: {
  detail: EmailDetailData
  draftId?: string
  messageId: string
  onSent: (id: string) => void
}): React.JSX.Element {
  const [to, setTo] = useState(detail.to || '')
  const [subject, setSubject] = useState(detail.subject || '')
  const [body, setBody] = useState(detail.bodyText || detail.snippet || '')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (sending || sent || !to.trim()) return

    setSending(true)
    setSendError(null)
    setNotice(null)
    try {
      if (draftId) {
        // Atomic send: drafts.send removes the draft server-side in the same
        // operation. Sending succeeds => the row is guaranteed to be pruned
        // by App; a failure here leaves the draft and this form (with its
        // error) in place to retry — never a silently lingering draft.
        await window.api.sendDraft({
          draftId,
          to,
          subject,
          body,
          threadId: detail.threadId || undefined,
          // The draft's own In-Reply-To header is the message it was a reply
          // to. detail.messageId is the draft's unsent Message-ID and would
          // be bogus to send.
          inReplyTo: detail.inReplyTo || undefined,
          references: detail.references || undefined
        })
      } else {
        // No draft ID (shouldn't happen for rows from the Drafts folder):
        // send as a new message but do NOT report sent — the unknown draft
        // is still in Gmail, and dropping the row would hide that fact.
        await window.api.sendEmail({ to, subject, body })
        setNotice(
          'Sent as a new message; the original draft entry was left in place (unknown draft ID).'
        )
        return
      }
      setSent(true)
      onSent(messageId)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="composer composer-fill" onSubmit={handleSend}>
      <h2 id="draft-editor-title">Draft</h2>

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
      {notice && <p role="status">{notice}</p>}

      <div className="composerActions">
        {/* Once sent, the draft no longer exists server-side (a second send
            would surface a confusing drafts.update 404, not a new mail), so
            the button retires instead of re-arming. */}
        <button type="submit" disabled={sending || sent || !to.trim()}>
          {sending ? 'Sending...' : sent ? 'Sent' : 'Send'}
        </button>
      </div>
      {sent && <p role="status">Message sent.</p>}
    </form>
  )
}

export function DraftEditor({
  row,
  detail,
  detailLoading,
  onSent
}: DraftEditorProps): React.JSX.Element {
  // Mount the form only once the draft content arrives so fields initialize
  // from it directly. Remounting via key={row.id} in App resets per draft,
  // and the row id (thread id) is what App prunes on send.
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
      messageId={row.id}
      onSent={onSent}
    />
  )
}
