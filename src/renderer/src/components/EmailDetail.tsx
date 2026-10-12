import { useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import type { EmailSummary, EmailDetail as EmailDetailData } from '../../../shared/types'

type EmailDetailProps = {
  email: EmailSummary
  detail: EmailDetailData | null
  detailLoading: boolean
  onBack: () => void
}

export function EmailDetail({
  email,
  detail,
  detailLoading,
  onBack,
}: EmailDetailProps) {
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

  type Draft = {
    to: string
    subject: string
    body: string
  }

  const [draft, setDraft] = useState<Draft | null>(null)

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

  function replyToEmail() {
    if (!detail) return

    const originalText = detail.bodyText || email.snippet
    const quotedText = originalText
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')

    setDraft({
      to: detail.replyTo.trim() || detail.from.trim() || email.from,
      subject: /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`,
      body: `\n\nOn ${email.date}, ${email.from} wrote:\n${quotedText}`,
    })
  }

  function forwardEmail() {
    if (!detail) return

    const originalText = detail.bodyText || email.snippet

    setDraft({
      to: '',
      subject: /^fwd:/i.test(email.subject) ? email.subject : `Fwd: ${email.subject}`,
      body: `\n\n---------- Forwarded message ----------\nFrom: ${email.from}\nDate: ${email.date}\nSubject: ${email.subject}\n\n${originalText}`,
    })
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
          role="dialog"
          aria-modal="true"
          aria-labelledby="composer-title"
          onSubmit={(event) => event.preventDefault()}
        >
          <h2 id="composer-title">Compose email</h2>

          <label className="composerField">
            <span>To</span>
            <input
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

          <div className="composerActions">
            <button type="button" onClick={() => setDraft(null)}>Cancel</button>
            <button type="submit" disabled>Send</button>
          </div>
        </form>
      )}
    </div>
  )
}