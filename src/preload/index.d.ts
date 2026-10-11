import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  type EmailSummary = import('../shared/types').EmailSummary

  interface Window {
    electron: ElectronAPI
    api: {
      signIn(): Promise<void>
      getInbox(): Promise<EmailSummary[]>
    }
  }
}