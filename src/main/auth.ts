import { app, safeStorage, shell } from 'electron'
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library'
import { google } from 'googleapis'
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

const CLIENT_ID = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID as string
const CLIENT_SECRET = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET as string
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

function makeClient(redirectUri?: string): OAuth2Client {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'Google OAuth credentials are missing. Set MAIN_VITE_GOOGLE_CLIENT_ID and MAIN_VITE_GOOGLE_CLIENT_SECRET in .env'
    )
  }
  return new OAuth2Client({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri
  })
}

const tokenPath = (): string => path.join(app.getPath('userData'), 'refresh-token.bin')

function saveRefreshToken(token: string): void {
  fs.writeFileSync(tokenPath(), safeStorage.encryptString(token))
}

function loadRefreshToken(): string | null {
  if (!fs.existsSync(tokenPath())) return null
  return safeStorage.decryptString(fs.readFileSync(tokenPath()))
}

export function signIn(): Promise<void> {
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex')
    const server = http.createServer()

    server.listen(0, '127.0.0.1', async () => {
      try {
        const port = (server.address() as AddressInfo).port
        const client = makeClient(`http://127.0.0.1:${port}`)
        const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()

        server.on('request', async (req, res) => {
          const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
          const code = url.searchParams.get('code')

          if (!code || url.searchParams.get('state') !== state) {
            res.end('Waiting for Google...')
            return
          }

          try {
            const { tokens } = await client.getToken({ code, codeVerifier })
            if (!tokens.refresh_token) throw new Error('Google sent no refresh token')
            saveRefreshToken(tokens.refresh_token)
            res.end('Signed in! You can close this tab and go back to the app.')
            resolve()
          } catch (err) {
            res.end('Sign-in failed. Check the app for details.')
            reject(err)
          } finally {
            server.close()
            server.closeAllConnections()
          }
        })

        const authUrl = client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: SCOPES,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: CodeChallengeMethod.S256
        })
        await shell.openExternal(authUrl)
      } catch (err) {
        server.close()
        reject(err)
      }
    })
  })
}

export type GmailClient = ReturnType<typeof google.gmail>

export function getGmailClient(): GmailClient {
  const refreshToken = loadRefreshToken()
  if (!refreshToken) throw new Error('Not signed in yet')

  const client = makeClient()
  client.setCredentials({ refresh_token: refreshToken })
  // google-auth-library caches the access token and refreshes it once
  // expired; nothing here manages tokens manually.
  return google.gmail({ version: 'v1', auth: client })
}

// Delete-then-revoke: removing the file makes sign-out instant and final even
// when the Google call fails (offline or the token is already dead), whereas
// revoking first could leave the app usable with a token we just told Google
// to kill. The revoke is fire-and-forget; its only job is best-effort cleanup
// of the grant on Google's side. A fresh bare client does the revoking: the
// revoke endpoint needs no OAuth credentials, so sign-out must not depend on
// them staying present.
export function signOut(): void {
  const refreshToken = loadRefreshToken()
  accountEmailPromise = null
  invalidateStoredGrant()
  if (refreshToken) {
    new OAuth2Client()
      .revokeToken(refreshToken)
      .catch((e) => console.warn('Gmail token revoke failed:', e))
  }
}

// A refresh token rejected with invalid_grant is dead: Google expired or
// revoked it, and no retry reactivates it. Only a fresh consent round
// restores mail access, so keeping the file would make isSignedIn() report
// signed-in forever and leave every launch in the same dead end.
export function invalidateStoredGrant(): void {
  if (fs.existsSync(tokenPath())) fs.unlinkSync(tokenPath())
}

export function isSignedIn(): boolean {
  return loadRefreshToken() !== null
}

// The signed-in account's address, cached because send and thread fetches
// both need it and a profile call per send is quota for nothing. A failed
// lookup is not cached, so the next call retries; sign-out drops the cache
// because a new session is a different account.
let accountEmailPromise: Promise<string> | null = null

export function getAccountEmail(): Promise<string> {
  if (!accountEmailPromise) {
    accountEmailPromise = (async () => {
      try {
        const gmail = getGmailClient()
        const profile = await gmail.users.getProfile({ userId: 'me' })
        const email = profile.data.emailAddress
        if (!email) throw new Error('Could not determine the signed-in Gmail address')
        return email
      } catch (e) {
        accountEmailPromise = null
        throw e
      }
    })()
  }
  return accountEmailPromise
}
