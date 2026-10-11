import { useEffect, useState } from 'react'
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
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

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
      setSignedIn(true)
      await handleLoad()
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

  useEffect(() => {
    let cancelled = false

    async function initialize(): Promise<void> {
      let isAuthenticated: boolean
      try {
        isAuthenticated = await window.api.isSignedIn()
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
        return
      }

      if (cancelled) return
      setSignedIn(isAuthenticated)
      if (!isAuthenticated) return

      setLoading(true)
      try {
        const inbox = await window.api.getInbox()
        if (!cancelled) setEmails(inbox)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void initialize()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app">
      <div className="actions">
        {signedIn === false && <button onClick={handleSignIn}>Sign in with Google</button>}
        {loading && <span role="status">Loading inbox...</span>}
      </div>

      {error && <p className="error">{error}</p>}

      <main className="mail-layout">
        <aside className="email-sidebar" aria-label="Inbox">
          <ul className="emails">
            {emails.map((email) => (
              <li key={email.id}>
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
        </aside>

        <section className="email-content" aria-label="Email content">
          {selectedEmail ? (
            <EmailDetail
              email={selectedEmail}
              detail={detail}
              detailLoading={detailLoading}
              onBack={handleBack}
            />
          ) : (
            <p>Nothing open yet :P</p>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
