import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  EmailDetail,
  EmailThread,
  ListFolderOptions,
  ModifyLabelsRequest,
  SendDraftRequest,
  SendEmailRequest,
  ThreadPage
} from '../shared/types'

// Custom APIs for renderer
const api = {
  signIn: (): Promise<void> => ipcRenderer.invoke('auth:sign-in'),
  isSignedIn: (): Promise<boolean> => ipcRenderer.invoke('auth:is-signed-in'),
  signOut: (): Promise<void> => ipcRenderer.invoke('auth:sign-out'),
  listFolder: (options?: ListFolderOptions): Promise<ThreadPage> =>
    ipcRenderer.invoke('gmail:list', options),
  getMessage: (id: string): Promise<EmailDetail> => ipcRenderer.invoke('gmail:get', id),
  getThread: (threadId: string): Promise<EmailThread> =>
    ipcRenderer.invoke('gmail:thread', threadId),
  sendEmail: (request: SendEmailRequest): Promise<void> =>
    ipcRenderer.invoke('gmail:send', request),
  sendDraft: (request: SendDraftRequest): Promise<void> =>
    ipcRenderer.invoke('gmail:send-draft', request),
  modifyLabels: (request: ModifyLabelsRequest): Promise<void> =>
    ipcRenderer.invoke('gmail:modify', request)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
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
