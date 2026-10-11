import { useMemo } from 'react'
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

  const emailDocument = `<!doctype html>
<html>
  <head>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"
    >
  </head>
  <body>${sanitizedHtml}</body>
</html>`

  return (
    <div>
      <button type="button" onClick={onBack}>
        ← Back to inbox
      </button>

      <h2>{email.subject}</h2>
      <p>
        {email.from} — {email.date}
      </p>
      <p>{email.snippet}</p>

      {detailLoading ? (
        <p>Loading email...</p>
      ) : detail?.bodyHtml ? (
        <iframe
          title="Email content"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={emailDocument}
          style={{ width: '100%', height: '70vh', border: 0 }}
        />
      ) : detail?.bodyText ? (
        <pre style={{ whiteSpace: 'pre-wrap' }}>{detail.bodyText}</pre>
      ) : (
        <div className="snippet">{email.snippet}</div>
      )}
    </div>
  )
}