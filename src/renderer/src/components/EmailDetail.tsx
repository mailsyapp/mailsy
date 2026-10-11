import type { EmailSummary } from '../../../shared/types'

export function EmailDetail({ email, onBack }: { email: EmailSummary, onBack: () => void }) {
  return (
    <div>
      <button type="button" onClick={onBack}>← Back to inbox</button>
      <h2>{email.subject}</h2>
      <p>{email.from} — {email.date}</p>
      <p>{email.snippet}</p>
    </div>
  )
}