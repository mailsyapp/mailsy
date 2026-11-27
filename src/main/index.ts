import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  signIn,
  signOut,
  isSignedIn,
  saveOAuthCredentials,
  getOAuthCredentialsStatus
} from './auth'
import { pickAttachments, saveAttachmentFile } from './attachments'
import { installApplicationMenu } from './editMenu'
import {
  discardDraft,
  armSyncClock,
  createUserLabel,
  deleteUserLabel,
  draftExists,
  fetchAttachment,
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
  installApplicationMenu()
  electronApp.setAppUserModelId('com.electron')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  ipcMain.handle('auth:sign-in', () => signIn())
  ipcMain.handle('auth:save-credentials', (_e, creds) => saveOAuthCredentials(creds))
  ipcMain.handle('auth:credentials-status', () => getOAuthCredentialsStatus())
  ipcMain.handle('auth:is-signed-in', () => isSignedIn())
  ipcMain.handle('auth:sign-out', () => signOut())
  ipcMain.handle('gmail:list', (_event, options?: ListFolderOptions) => fetchFolder(options))
  ipcMain.handle('gmail:get', (_event, id: string, draftId?: string) => fetchMessage(id, draftId))
  ipcMain.handle('gmail:thread', (_event, threadId: string) => fetchThread(threadId))
  ipcMain.handle('gmail:sync', (_event, reason: SyncReason) => syncMail(reason))
  ipcMain.handle('gmail:send', (_event, request: SendEmailRequest) => sendEmail(request))
  ipcMain.handle('gmail:send-draft', (_event, request: SendDraftRequest) => sendDraft(request))
  ipcMain.handle('gmail:save-draft', (_event, request: SaveDraftRequest) => saveDraft(request))
  ipcMain.handle('gmail:discard-draft', (_event, draftId: string) => discardDraft(draftId))
  ipcMain.handle('gmail:draft-exists', (_event, draftId: string) => draftExists(draftId))
  ipcMain.handle('attachments:pick', () => pickAttachments())
  ipcMain.handle('gmail:get-attachment', (_event, messageId: string, attachmentId: string) =>
    fetchAttachment(messageId, attachmentId)
  )
  ipcMain.handle(
    'attachments:save',
    (_event, messageId: string, attachmentId: string, filename: string) =>
      saveAttachmentFile(messageId, attachmentId, filename)
  )
  ipcMain.handle('gmail:modify', (_event, request: ModifyLabelsRequest) => modifyLabels(request))
  ipcMain.handle('gmail:list-labels', () => listLabels())
  ipcMain.handle('gmail:create-label', (_event, name: string) => createUserLabel(name))
  ipcMain.handle('gmail:delete-label', (_event, id: string) => deleteUserLabel(id))
  ipcMain.handle('gmail:snooze', (_event, threadId: string, restoreAt: number) =>
    snoozeThread(threadId, restoreAt)
  )
  ipcMain.handle('gmail:snooze-restore', (_event, threadId: string) => restoreThread(threadId))
  ipcMain.handle('gmail:snooze-tick', () => sweepDueSnoozed())
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
