import { useState } from 'react'
import type { EmailSummary, EmailDetail as EmailDetailData } from '../../shared/types'
import { EmailDetail } from './components/EmailDetail'

function App(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [emails, setEmails] = useState<EmailSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<EmailDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const selectedEmail = emails.find((e) => e.id === selectedId) ?? null

  async function handleSelect(id: string): Promise<void> {
    setSelectedId(id)
    setDetail(null)
    setDetailLoading(true)
    setError(null)
    try {
      setDetail(await window.api.getMessage(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDetailLoading(false)
    }
  }

  function handleBack(): void {
    setSelectedId(null)
    setDetail(null)
  }

  async function handleSignIn(): Promise<void> {
    setError(null)
    try {
      await window.api.signIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleLoad(): Promise<void> {
    setError(null)
    setLoading(true)
    try {
      setEmails(await window.api.getInbox())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <h1>Mailsy</h1>
      <div className="actions">
        <button onClick={handleSignIn}>Sign in with Google</button>
        <button onClick={handleLoad} disabled={loading}>
          {loading ? 'Loading...' : 'Load inbox'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {selectedEmail ? (
        <div className="email-detail">
          <EmailDetail
            email={selectedEmail}
            detail={detail}
            detailLoading={detailLoading}
            onBack={handleBack}
          />
        </div>
      ) : (
        <ul className="emails">
          {emails.map((email) => (
            <li
              key={email.id}
              style={{
                width: '30dvw',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <button
                type="button"
                onClick={() => handleSelect(email.id)}
                style={{ all: 'unset', display: 'block', cursor: 'pointer', width: '100%' }}
              >
                <strong className="email-text">{email.subject}</strong>
                <div className="from email-text">{email.from}</div>
                <div className="snippet email-text">{email.snippet}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default App
