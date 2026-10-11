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
        <div dangerouslySetInnerHTML={{ __html: detail.bodyHtml }} />
      ) : detail?.bodyText ? (
        <pre style={{ whiteSpace: 'pre-wrap' }}>{detail.bodyText}</pre>
      ) : (
        <div className="snippet">{email.snippet}</div>
      )}
    </div>
  )
}