import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const require = createRequire(new URL('../drive/', import.meta.url))
const { _electron } = require('playwright')

// Keep the packaged preload intact: its invokes cross real IPC before main
// redirects them to the fixture. No product files or ASAR contents are edited.
export async function launchPackaged({
  executablePath,
  artifactDir,
  mockPath,
  signedOut = false,
  clock = false
}) {
  const profile = await mkdtemp(join(artifactDir, 'electron-profile-'))
  const browser = await _electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`, '--disable-background-networking'],
    env: { ...process.env, XDG_CONFIG_HOME: profile }
  })
  try {
    const page = await browser.firstWindow()
    await page.waitForFunction(() => typeof window.api?.isSignedIn === 'function')
    if (await page.evaluate(() => window.api.isSignedIn()))
      throw new Error('Packaged verification must start without a live account')
    const identity = await browser.evaluate(({ app, BrowserWindow, ipcMain, session }, profile) => {
      if (!app.isPackaged || app.getPath('userData') !== profile)
        throw new Error('Expected a packaged app with an isolated user-data directory')
      const window = BrowserWindow.getAllWindows()[0]
      window.setSize(1280, 900)
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*'] },
        (_details, callback) => callback({ cancel: true })
      )
      const channels = {
        'auth:sign-in': 'signIn',
        'auth:is-signed-in': 'isSignedIn',
        'auth:sign-out': 'signOut',
        'auth:credentials-status': 'getOAuthCredentialsStatus',
        'auth:save-credentials': 'saveOAuthCredentials',
        'gmail:list': 'listFolder',
        'gmail:get': 'getMessage',
        'gmail:thread': 'getThread',
        'gmail:sync': 'syncMail',
        'gmail:send': 'sendEmail',
        'gmail:send-draft': 'sendDraft',
        'gmail:save-draft': 'saveDraft',
        'gmail:discard-draft': 'discardDraft',
        'attachments:pick': 'pickAttachments',
        'gmail:get-attachment': 'getAttachment',
        'attachments:save': 'saveAttachment',
        'gmail:modify': 'modifyLabels',
        'gmail:list-labels': 'listLabels',
        'gmail:create-label': 'createUserLabel',
        'gmail:delete-label': 'deleteUserLabel',
        'gmail:snooze': 'snoozeThread',
        'gmail:snooze-restore': 'restoreThread',
        'gmail:snooze-tick': 'snoozeTick'
      }
      const counts = {}
      globalThis.__packagedVerification = {
        packaged: app.isPackaged,
        appPath: app.getAppPath(),
        userData: app.getPath('userData'),
        electron: process.versions.electron,
        counts
      }
      for (const [channel, method] of Object.entries(channels)) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (event, ...args) => {
          if (event.sender !== window.webContents) throw new Error('Unexpected IPC sender')
          counts[channel] = (counts[channel] ?? 0) + 1
          return event.sender.executeJavaScript(
            `window.__packagedFixtureApi[${JSON.stringify(method)}](...${JSON.stringify(args)})`
          )
        })
      }
      return globalThis.__packagedVerification
    }, profile)
    await browser.context().exposeBinding('__packagedPushSync', async (source, result) => {
      if (source.page !== page || source.frame !== page.mainFrame())
        throw new Error('Unexpected fixture sync sender')
      await browser.evaluate(({ BrowserWindow }, result) => {
        const counts = globalThis.__packagedVerification.counts
        counts['gmail:sync-result'] = (counts['gmail:sync-result'] ?? 0) + 1
        BrowserWindow.getAllWindows()[0].webContents.send('gmail:sync-result', result)
      }, result)
    })
    if (clock) await page.clock.install()
    const fixture = await readFile(mockPath, 'utf8')
    await browser.context().addInitScript({ content: `(() => {
      const fixtureWindow = { __signInClicked: false, __signOutClicked: false, __pickCalls: 0 }
      ;(function(window) { ${fixture}\n })(fixtureWindow)
      if (${JSON.stringify(signedOut)}) {
        fixtureWindow.api.isSignedIn = async () => false
        fixtureWindow.api.signIn = async () => { fixtureWindow.__signInClicked = true }
      }
      fixtureWindow.__pushSync = (result) => window.__packagedPushSync(result)
      Object.defineProperty(window, '__packagedFixtureApi', { value: fixtureWindow.api })
      for (const key of Object.keys(fixtureWindow)) {
        if (key === 'api') continue
        Object.defineProperty(window, key, {
          configurable: true,
          get: () => fixtureWindow[key],
          set: (value) => { fixtureWindow[key] = value }
        })
      }
    })()` })
    await page.waitForURL('file:**')
    const entry = page.url()
    if (!entry.startsWith('file:') || !entry.includes('/app.asar/out/renderer/'))
      throw new Error(`Not the packaged renderer: ${entry}`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    if (await page.evaluate(() => Object.getOwnPropertyDescriptor(window, 'api')?.writable !== false))
      throw new Error('The native read-only preload API was not preserved')
    await writeFile(join(artifactDir, 'packaged.json'), JSON.stringify({ ...identity, entry }, null, 2))
    return { browser, page, entry, identity }
  } catch (error) {
    await browser.close()
    throw error
  }
}
