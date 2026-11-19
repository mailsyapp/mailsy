import { useState } from 'react'
import type { OAuthCredentials } from '../../../shared/types'

interface Props {
  onSubmit: (credentials: OAuthCredentials) => Promise<void>
  onCancel: () => void
}

export function OAuthCredentialsSetup({ onSubmit, onCancel }: Props): React.JSX.Element {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (pending || !clientId.trim() || !clientSecret.trim()) return
    setPending(true)
    setError(null)
    try {
      await onSubmit({ clientId: clientId.trim(), clientSecret: clientSecret.trim() })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="oauth-setup" aria-labelledby="oauth-setup-heading">
      <h1 id="oauth-setup-heading">Set up Google sign-in</h1>
      <p>
        This copy of Mailsy needs Google OAuth credentials. Create a Desktop app OAuth client in
        your Google Cloud project, then enter its credentials below. They are stored encrypted on
        this device.
      </p>
      <p>
        <a
          href="https://developers.google.com/identity/protocols/oauth2/native-app"
          target="_blank"
          rel="noreferrer"
        >
          Desktop app OAuth guide
        </a>
        {' · '}
        <a
          href="https://console.cloud.google.com/apis/credentials"
          target="_blank"
          rel="noreferrer"
        >
          Google Cloud Console credentials
        </a>
      </p>
      <form onSubmit={submit} aria-busy={pending}>
        <label htmlFor="oauth-client-id">Client ID</label>
        <input
          id="oauth-client-id"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={pending}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <label htmlFor="oauth-client-secret">Client secret</label>
        <input
          id="oauth-client-secret"
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          disabled={pending}
          autoComplete="off"
          required
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" disabled={pending || !clientId.trim() || !clientSecret.trim()}>
            {pending ? 'Signing in…' : 'Save & sign in'}
          </button>
          <button type="button" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  )
}
