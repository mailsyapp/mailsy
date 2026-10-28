import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  EmailDetail,
  EmailThread,
  ListFolderOptions,
  MailLabel,
  ModifyLabelsRequest,
  SaveDraftRequest,
  SendDraftRequest,
  SendEmailRequest,
  ThreadPage
} from '../shared/types'
import type { SyncReason, SyncResult } from '../shared/sync'

const api = {
  signIn: (): Promise<void> => ipcRenderer.invoke('auth:sign-in'),
  isSignedIn: (): Promise<boolean> => ipcRenderer.invoke('auth:is-signed-in'),
  signOut: (): Promise<void> => ipcRenderer.invoke('auth:sign-out'),
  listFolder: (options?: ListFolderOptions): Promise<ThreadPage> =>
    ipcRenderer.invoke('gmail:list', options),
  // The canonical refresh funnel: every path — the renderer's Refresh
  // button here, main's adaptive clock and window-focus trigger inside
  // sync — settles through the main-process sync.
  syncMail: (reason: SyncReason): Promise<SyncResult> => ipcRenderer.invoke('gmail:sync', reason),
  // Pushed sweep results ('clock' and 'focus' have no awaiting caller):
  // the subscription returns its own unsubscribe, the shape of a listener
  // tie the renderer owns across sign-in flips.
  onSyncResult: (listener: (result: SyncResult) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, result: SyncResult): void =>
      listener(result)
    ipcRenderer.on('gmail:sync-result', wrapped)
    return () => {
      ipcRenderer.removeListener('gmail:sync-result', wrapped)
    }
  },
  getMessage: (id: string): Promise<EmailDetail> => ipcRenderer.invoke('gmail:get', id),
  getThread: (threadId: string): Promise<EmailThread> =>
    ipcRenderer.invoke('gmail:thread', threadId),
  sendEmail: (request: SendEmailRequest): Promise<void> =>
    ipcRenderer.invoke('gmail:send', request),
  sendDraft: (request: SendDraftRequest): Promise<void> =>
    ipcRenderer.invoke('gmail:send-draft', request),
  saveDraft: (request: SaveDraftRequest): Promise<string> =>
    ipcRenderer.invoke('gmail:save-draft', request),
  discardDraft: (draftId: string): Promise<void> =>
    ipcRenderer.invoke('gmail:discard-draft', draftId),
  modifyLabels: (request: ModifyLabelsRequest): Promise<void> =>
    ipcRenderer.invoke('gmail:modify', request),
  snoozeThread: (threadId: string, restoreAt: number): Promise<void> =>
    ipcRenderer.invoke('gmail:snooze', threadId, restoreAt),
  restoreThread: (threadId: string): Promise<void> =>
    ipcRenderer.invoke('gmail:snooze-restore', threadId),
  snoozeTick: (): Promise<number> => ipcRenderer.invoke('gmail:snooze-tick'),
  listLabels: (): Promise<MailLabel[]> => ipcRenderer.invoke('gmail:list-labels'),
  createUserLabel: (name: string): Promise<MailLabel> =>
    ipcRenderer.invoke('gmail:create-label', name),
  deleteUserLabel: (id: string): Promise<void> => ipcRenderer.invoke('gmail:delete-label', id)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
