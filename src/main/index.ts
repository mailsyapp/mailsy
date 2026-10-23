import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { signIn, signOut, isSignedIn } from './auth'
import {
  discardDraft,
  armSyncClock,
  createUserLabel,
  deleteUserLabel,
  fetchFolder,
  fetchMessage,
  fetchThread,
  listLabels,
  modifyLabels,
  restoreThread,
  saveDraft,
  sendDraft,
  sendEmail,
  snoozeThread,
  syncMail,
  sweepDueSnoozed
} from './mail'
import type {
  ListFolderOptions,
  ModifyLabelsRequest,
  SaveDraftRequest,
  SendEmailRequest,
  SendDraftRequest
} from '../shared/types'
import type { SyncReason } from '../shared/sync'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Window focus is one of the sync triggers: mail that arrived while the
  // app sat in the background appears at the regain, not at the next
  // sweep tick. Failures count toward the clock's own backoff.
  mainWindow.on('focus', () => {
    void syncMail('focus').catch(() => {})
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('auth:sign-in', () => signIn())
  ipcMain.handle('auth:is-signed-in', () => isSignedIn())
  // Signing out ends the mailbox session: the stored grant's teardown
  // (invalidateStoredGrant) fires the per-account state teardown
  // registered in mail/sync.ts, so the history cursor can never survive
  // into the next sign-in and sweep a different account from a random
  // offset. A dead grant goes through the same teardown, so both paths
  // out of a session land there.
  ipcMain.handle('auth:sign-out', () => signOut())
  ipcMain.handle('gmail:list', (_event, options?: ListFolderOptions) => fetchFolder(options))
  ipcMain.handle('gmail:get', (_event, id: string) => fetchMessage(id))
  ipcMain.handle('gmail:thread', (_event, threadId: string) => fetchThread(threadId))
  // The canonical refresh: the renderer's Refresh button is the only
  // renderer-invoked path; the adaptive clock and window focus fire
  // inside main.
  ipcMain.handle('gmail:sync', (_event, reason: SyncReason) => syncMail(reason))
  ipcMain.handle('gmail:send', (_event, request: SendEmailRequest) => sendEmail(request))
  ipcMain.handle('gmail:send-draft', (_event, request: SendDraftRequest) => sendDraft(request))
  ipcMain.handle('gmail:save-draft', (_event, request: SaveDraftRequest) => saveDraft(request))
  ipcMain.handle('gmail:discard-draft', (_event, draftId: string) => discardDraft(draftId))
  ipcMain.handle('gmail:modify', (_event, request: ModifyLabelsRequest) => modifyLabels(request))
  ipcMain.handle('gmail:list-labels', () => listLabels())
  ipcMain.handle('gmail:create-label', (_event, name: string) => createUserLabel(name))
  ipcMain.handle('gmail:delete-label', (_event, id: string) => deleteUserLabel(id))
  ipcMain.handle('gmail:snooze', (_event, threadId: string, restoreAt: number) =>
    snoozeThread(threadId, restoreAt)
  )
  ipcMain.handle('gmail:snooze-restore', (_event, threadId: string) => restoreThread(threadId))
  ipcMain.handle('gmail:snooze-tick', () => sweepDueSnoozed())

  // The app was closed at some parked thread's wake time: the catch-up
  // restores everything due now. Signed-out launches skip quietly; the
  // sweep retries on the next tick after sign-in.
  void sweepDueSnoozed().catch((e: unknown) => {
    console.warn('startup snooze catch-up skipped:', e)
  })

  armSyncClock()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
