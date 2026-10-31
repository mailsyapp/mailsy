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
  type MailLabel = import('../shared/types').MailLabel
  type SyncReason = import('../shared/sync').SyncReason
  type SyncResult = import('../shared/sync').SyncResult

  interface Window {
    electron: ElectronAPI
    api: {
      signIn(): Promise<void>
      isSignedIn(): Promise<boolean>
      signOut(): Promise<void>
      listFolder(options?: ListFolderOptions): Promise<MailPage>
      syncMail(reason: SyncReason): Promise<SyncResult>
      onSyncResult(listener: (result: SyncResult) => void): () => void
      getMessage(id: string): Promise<EmailDetail>
      getThread(threadId: string): Promise<EmailThread>
      sendEmail(request: SendEmailRequest): Promise<void>
      sendDraft(request: SendDraftRequest): Promise<void>
      saveDraft(request: SaveDraftRequest): Promise<string>
      discardDraft(draftId: string): Promise<void>
      pickAttachments(): Promise<import('../shared/types').ComposeAttachment[]>
      getAttachment(messageId: string, attachmentId: string): Promise<string>
      modifyLabels(request: ModifyLabelsRequest): Promise<void>
      snoozeThread(threadId: string, restoreAt: number): Promise<void>
      restoreThread(threadId: string): Promise<void>
      snoozeTick(): Promise<number>
      listLabels(): Promise<MailLabel[]>
      createUserLabel(name: string): Promise<MailLabel>
      deleteUserLabel(id: string): Promise<void>
    }
  }
}
