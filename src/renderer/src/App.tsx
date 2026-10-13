import { useCallback, useEffect, useRef, useState } from 'react'
import type { EmailSummary, EmailDetail as EmailDetailData } from '../../shared/types'
import { EmailDetail } from './components/EmailDetail'

const INBOX_PAGE_SIZE = 30

function App(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [emails, setEmails] = useState<EmailSummary[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | null | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<EmailDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const selectedEmail = emails.find((e) => e.id === selectedId) ?? null
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const sidebarRef = useRef<HTMLElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const hasMore = nextPageToken !== null

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
      const page = await window.api.getInbox({ maxResults: INBOX_PAGE_SIZE })
      setEmails(page.emails)
      setNextPageToken(page.nextPageToken)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const loadMore = useCallback(async (): Promise<void> => {
    if (loading || loadingMore || nextPageToken === null) return
    setLoadingMore(true)
    try {
      const page = await window.api.getInbox({
        maxResults: INBOX_PAGE_SIZE,
        pageToken: nextPageToken ?? undefined
      })
      setEmails((prev) => [...prev, ...page.emails])
      setNextPageToken(page.nextPageToken)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }, [loading, loadingMore, nextPageToken])

  useEffect(() => {
    const sentinel = sentinelRef.current
    const root = sidebarRef.current
    if (!sentinel || !root || nextPageToken === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { root, rootMargin: '400px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, nextPageToken])

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
        const page = await window.api.getInbox({ maxResults: INBOX_PAGE_SIZE })
        if (!cancelled) {
          setEmails(page.emails)
          setNextPageToken(page.nextPageToken)
        }
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
        <aside className="email-sidebar" aria-label="Inbox" ref={sidebarRef}>
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
          {hasMore ? (
            <>
              <div ref={sentinelRef} aria-hidden="true" />
              {loadingMore ? (
                <p role="status">Loading more...</p>
              ) : (
                !loading && (
                  <button type="button" onClick={() => void loadMore()}>
                    Load more
                  </button>
                )
              )}
            </>
          ) : (
            emails.length > 0 && !loading && <p className="snippet">You&apos;re all caught up</p>
          )}
        </aside>

        <section className="email-content" aria-label="Email content">
          {selectedEmail ? (
            <EmailDetail
              key={selectedEmail.id}
              email={selectedEmail}
              detail={detail}
              detailLoading={detailLoading}
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
