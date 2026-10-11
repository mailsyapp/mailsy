import { useState } from 'react'
import type { EmailSummary } from '../../shared/types'

function App(): React.JSX.Element {
  const [emails, setEmails] = useState<EmailSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

      <ul className="emails">
        {emails.map((email) => (
          <li key={email.id}>
            <strong>{email.subject}</strong>
            <div className="from">{email.from}</div>
            <div className="snippet">{email.snippet}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default App