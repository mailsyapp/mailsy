import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ComposeAttachment,
  EmailDetail,
  EmailThread,
  ListFolderOptions,
  MailLabel,
  ModifyLabelsRequest,
  OAuthCredentials,
  OAuthCredentialsStatus,
  SaveDraftRequest,
  SaveDraftResult,
  SendDraftRequest,
  SendEmailRequest,
  ThreadPage
} from '../shared/types'
import type { SyncReason, SyncResult } from '../shared/sync'
const api = {
  signIn: (): Promise<void> => ipcRenderer.invoke('auth:sign-in'),
  saveOAuthCredentials: (creds: OAuthCredentials): Promise<void> =>
    ipcRenderer.invoke('auth:save-credentials', creds),
  getOAuthCredentialsStatus: (): Promise<OAuthCredentialsStatus> =>
    ipcRenderer.invoke('auth:credentials-status'),
  isSignedIn: (): Promise<boolean> => ipcRenderer.invoke('auth:is-signed-in'),
  signOut: (): Promise<void> => ipcRenderer.invoke('auth:sign-out'),
  listFolder: (options?: ListFolderOptions): Promise<ThreadPage> =>
    ipcRenderer.invoke('gmail:list', options),
  syncMail: (reason: SyncReason): Promise<SyncResult> => ipcRenderer.invoke('gmail:sync', reason),
  onSyncResult: (listener: (result: SyncResult) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, result: SyncResult): void =>
      listener(result)
    ipcRenderer.on('gmail:sync-result', wrapped)
    return () => {
      ipcRenderer.removeListener('gmail:sync-result', wrapped)
    }
  },
  getMessage: (id: string, draftId?: string): Promise<EmailDetail> =>
    ipcRenderer.invoke('gmail:get', id, draftId),
  getThread: (threadId: string): Promise<EmailThread> =>
    ipcRenderer.invoke('gmail:thread', threadId),
  sendEmail: (request: SendEmailRequest): Promise<void> =>
    ipcRenderer.invoke('gmail:send', request),
  sendDraft: (request: SendDraftRequest): Promise<void> =>
    ipcRenderer.invoke('gmail:send-draft', request),
  saveDraft: (request: SaveDraftRequest): Promise<SaveDraftResult> =>
    ipcRenderer.invoke('gmail:save-draft', request),
  discardDraft: (draftId: string): Promise<void> =>
    ipcRenderer.invoke('gmail:discard-draft', draftId),
  draftExists: (draftId: string): Promise<boolean> =>
    ipcRenderer.invoke('gmail:draft-exists', draftId),
  pickAttachments: (): Promise<ComposeAttachment[]> => ipcRenderer.invoke('attachments:pick'),
  getAttachment: (messageId: string, attachmentId: string): Promise<string> =>
    ipcRenderer.invoke('gmail:get-attachment', messageId, attachmentId),
  saveAttachment: (messageId: string, attachmentId: string, filename: string): Promise<boolean> =>
    ipcRenderer.invoke('attachments:save', messageId, attachmentId, filename),
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
  Object.assign(window, { electron: electronAPI, api })
}
