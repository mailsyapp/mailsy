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
  // google-auth-library fetches and caches a fresh access token from the
  // refresh token on every call; nothing here does it manually.
  return google.gmail({ version: 'v1', auth: client })
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
