import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  type EmailSummary = import('../shared/types').EmailSummary
  type EmailDetail = import('../shared/types').EmailDetail
  type EmailThread = import('../shared/types').EmailThread
  type ListFolderOptions = import('../shared/types').ListFolderOptions
  type MailPage = import('../shared/types').MailPage
  type SendEmailRequest = import('../shared/types').SendEmailRequest
  type SendDraftRequest = import('../shared/types').SendDraftRequest
  type SaveDraftRequest = import('../shared/types').SaveDraftRequest
  type ModifyLabelsRequest = import('../shared/types').ModifyLabelsRequest

  interface Window {
    electron: ElectronAPI
    api: {
      signIn(): Promise<void>
      isSignedIn(): Promise<boolean>
      signOut(): Promise<void>
      listFolder(options?: ListFolderOptions): Promise<MailPage>
      getMessage(id: string): Promise<EmailDetail>
      getThread(threadId: string): Promise<EmailThread>
      sendEmail(request: SendEmailRequest): Promise<void>
      sendDraft(request: SendDraftRequest): Promise<void>
      saveDraft(request: SaveDraftRequest): Promise<string>
      discardDraft(draftId: string): Promise<void>
      modifyLabels(request: ModifyLabelsRequest): Promise<void>
      snoozeThread(threadId: string, restoreAt: number): Promise<void>
      restoreThread(threadId: string): Promise<void>
      snoozeTick(): Promise<number>
    }
  }
}
