import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  type EmailSummary = import('../shared/types').EmailSummary
  type EmailDetail = import('../shared/types').EmailDetail
  type EmailThread = import('../shared/types').EmailThread
  type FetchInboxOptions = import('../shared/types').FetchInboxOptions
  type InboxPage = import('../shared/types').InboxPage
  type SendEmailRequest = import('../shared/types').SendEmailRequest

  interface Window {
    electron: ElectronAPI
    api: {
      signIn(): Promise<void>
      isSignedIn(): Promise<boolean>
      getInbox(options?: FetchInboxOptions): Promise<InboxPage>
      getMessage(id: string): Promise<EmailDetail>
      getThread(threadId: string): Promise<EmailThread>
      sendEmail(request: SendEmailRequest): Promise<void>
    }
  }
}
