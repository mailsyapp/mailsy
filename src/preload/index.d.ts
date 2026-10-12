import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  type EmailSummary = import('../shared/types').EmailSummary
  type EmailDetail = import('../shared/types').EmailDetail
  type SendEmailRequest = import('../shared/types').SendEmailRequest

  interface Window {
    electron: ElectronAPI
    api: {
      signIn(): Promise<void>
      isSignedIn(): Promise<boolean>
      getInbox(): Promise<EmailSummary[]>
      getMessage(id: string): Promise<EmailDetail>
      sendEmail(request: SendEmailRequest): Promise<void>
    }
  }
}
