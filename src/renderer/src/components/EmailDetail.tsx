import { useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import type {
  EmailSummary,
  EmailDetail as EmailDetailData,
  SendEmailRequest
} from '../../../shared/types'

type EmailDetailProps = {
  email: EmailSummary
  detail: EmailDetailData | null
  detailLoading: boolean
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[character] ?? character
  })
}

function plainTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>')
}

function formatDraftHtml(body: string, quoteText: string, quoteHtml: string): string {
  if (!quoteText) return plainTextToHtml(body)

  const quoteStart = body.indexOf(quoteText)
  if (quoteStart === -1) return plainTextToHtml(body)

  const quoteEnd = quoteStart + quoteText.length
  return (
    plainTextToHtml(body.slice(0, quoteStart)) +
    quoteHtml +
    plainTextToHtml(body.slice(quoteEnd))
  )
}

export function EmailDetail({
  email,
  detail,
  detailLoading,
}: EmailDetailProps): React.JSX.Element {
  const sanitizedHtml = useMemo(
    () =>
      DOMPurify.sanitize(detail?.bodyHtml ?? '', {
        USE_PROFILES: { html: true },
        FORBID_TAGS: [
          'iframe',
          'frame',
          'object',
          'embed',
          'form',
          'input',
          'button',
          'textarea',
          'select',
        ],
      }),
    [detail?.bodyHtml],
  )

  const [draft, setDraft] = useState<SendEmailRequest | null>(null)
  const [quotedContent, setQuotedContent] = useState<{ text: string; html: string } | null>(
    null
  )
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const emailDocument = `<!doctype html>
<html>
  <head>
    <style>
      html, body {
        margin: 0;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,"Helvetica Neue", Arial, sans-serif;
      }
    </style>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; font-src https: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"
    >
  </head>
  <body>${sanitizedHtml}</body>
</html>`
  const senderName =
  email.from.match(/^(.*?)\s*<[^>]+>$/)?.[1].replace(/^"|"$/g, '') ??
  email.from

  function replyToEmail(): void {
    if (!detail) return

    setSendError(null)
    setSent(false)
    const originalText = detail.bodyText || email.snippet
    const quotedText = `On ${email.date}, ${email.from} wrote:\n${originalText
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`
    const quotedHtml = `<p>On ${escapeHtml(email.date)}, ${escapeHtml(email.from)} wrote:</p><blockquote>${
      sanitizedHtml || `<pre>${escapeHtml(originalText)}</pre>`
    }</blockquote>`

    setQuotedContent({ text: quotedText, html: quotedHtml })
    setDraft({
      to: detail.replyTo.trim() || detail.from.trim() || email.from,
      subject: /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`,
      body: `\n\n${quotedText}`,
      threadId: detail.threadId || undefined,
      inReplyTo: detail.messageId || undefined,
      references:
        [detail.references, detail.messageId].filter(Boolean).join(' ') || undefined
    })
  }

  function forwardEmail(): void {
    if (!detail) return

    setSendError(null)
    setSent(false)
    const originalText = detail.bodyText || email.snippet
    const forwardHeader = [
      '---------- Forwarded message ----------',
      `From: ${email.from}`,
      `To: ${detail.to}`,
      `Date: ${email.date}`,
      `Subject: ${email.subject}`
    ].join('\n')
    const quotedText = `${forwardHeader}\n\n${originalText}`
    const quotedHtml = `<p>${forwardHeader
      .split('\n')
      .map(escapeHtml)
      .join('<br>')}</p><blockquote>${
      sanitizedHtml || `<pre>${escapeHtml(originalText)}</pre>`
    }</blockquote>`

    setQuotedContent({ text: quotedText, html: quotedHtml })
    setDraft({
      to: '',
      subject: /^fwd:/i.test(email.subject) ? email.subject : `Fwd: ${email.subject}`,
      body: `\n\n${quotedText}`,
      threadId: detail.threadId || undefined,
      inReplyTo: detail.messageId || undefined,
      references:
        [detail.references, detail.messageId].filter(Boolean).join(' ') || undefined
    })
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!draft || sending) return

    setSending(true)
    setSendError(null)
    setSent(false)
    try {
      await window.api.sendEmail({
        ...draft,
        ...(quotedContent
          ? { bodyHtml: formatDraftHtml(draft.body, quotedContent.text, quotedContent.html) }
          : {})
      })
      setDraft(null)
      setQuotedContent(null)
      setSent(true)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <h2>{email.subject}</h2>
      <div>
        <div>{senderName}</div>
        {detail?.to && <div>To: {detail.to}</div>}
        {detail?.cc && <div>Cc: {detail.cc}</div>}
        {detail?.bcc && <div>Bcc: {detail.bcc}</div>}
        {detail?.replyTo && <div>Reply-To: {detail.replyTo}</div>}
        <div>{email.date}</div>
      </div>

      {detailLoading ? (
        <p>Loading email...</p>
      ) : detail?.bodyHtml ? (
        <iframe
          title="Email content"
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          srcDoc={emailDocument}
          onLoad={(event) => {
            const frame = event.currentTarget
            const doc = frame.contentDocument
            if (!doc) return

            const height = Math.max(
              doc.documentElement.scrollHeight,
              doc.body.scrollHeight,
            )
            frame.style.height = `${height}px`
          }}
          style={{ width: '100%', border: 0 }}
        />
      ) : detail?.bodyText ? (
        <pre style={{ whiteSpace: 'pre-wrap' }}>{detail.bodyText}</pre>
      ) : (
        <div className="snippet">{email.snippet}</div>
      )}
      <button onClick={ replyToEmail }>reply</button>
      <button onClick={ forwardEmail }>forward</button>

      {draft && (
        <form
          className="composer"
          onSubmit={handleSend}
        >
          <h2 id="composer-title">Compose email</h2>

          <label className="composerField">
            <span>To</span>
            <input
              required
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </label>

          <label className="composerField">
            <span>Subject</span>
            <input
              value={draft.subject}
              onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
            />
          </label>

          <label className="composerField">
            <span>Message</span>
            <textarea
              rows={12}
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </label>

          {sendError && <p role="alert">{sendError}</p>}

          <div className="composerActions">
            <button
              type="button"
              onClick={() => {
                setDraft(null)
                setQuotedContent(null)
              }}
            >
              Cancel
            </button>
            <button type="submit" disabled={sending || !draft.to.trim()}>
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>
      )}
      {sent && <p role="status">Message sent.</p>}
    </div>
  )
}