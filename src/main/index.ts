import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { signIn, signOut, isSignedIn } from './auth'
import {
  discardDraft,
  fetchFolder,
  fetchMessage,
  fetchThread,
  modifyLabels,
  saveDraft,
  sendDraft,
  sendEmail
} from './mail'
import type {
  ListFolderOptions,
  ModifyLabelsRequest,
  SaveDraftRequest,
  SendEmailRequest,
  SendDraftRequest
} from '../shared/types'

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
  ipcMain.handle('auth:sign-out', () => signOut())
  ipcMain.handle('gmail:list', (_event, options?: ListFolderOptions) => fetchFolder(options))
  ipcMain.handle('gmail:get', (_event, id: string) => fetchMessage(id))
  ipcMain.handle('gmail:thread', (_event, threadId: string) => fetchThread(threadId))
  ipcMain.handle('gmail:send', (_event, request: SendEmailRequest) => sendEmail(request))
  ipcMain.handle('gmail:send-draft', (_event, request: SendDraftRequest) => sendDraft(request))
  ipcMain.handle('gmail:save-draft', (_event, request: SaveDraftRequest) => saveDraft(request))
  ipcMain.handle('gmail:discard-draft', (_event, draftId: string) => discardDraft(draftId))
  ipcMain.handle('gmail:modify', (_event, request: ModifyLabelsRequest) => modifyLabels(request))

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
