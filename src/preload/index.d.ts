import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  type EmailSummary = import('../shared/types').EmailSummary
  type EmailDetail = import('../shared/types').EmailDetail

  interface Window {
    electron: ElectronAPI
    api: {
      signIn(): Promise<void>
      isSignedIn(): Promise<boolean>
      getInbox(): Promise<EmailSummary[]>
      getMessage(id: string): Promise<EmailDetail>
    }
  }
}
