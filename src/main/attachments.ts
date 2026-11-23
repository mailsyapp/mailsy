import { dialog } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fetchAttachment } from './mail/messages'
import {
  ATTACHMENTS_TOTAL_LIMIT_BYTES,
  attachmentsLimitError,
  type ComposeAttachment
} from '../shared/types'

async function readAttachmentFile(path: string): Promise<ComposeAttachment> {
  const bytes = await readFile(path)
  return {
    filename: basename(path),
    size: bytes.length,
    data: bytes.toString('base64')
  }
}

export async function pickAttachments(): Promise<ComposeAttachment[]> {
  const result = await dialog.showOpenDialog({
    title: 'Attach files',
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled || result.filePaths.length === 0) return []

  const attachments = await Promise.all(result.filePaths.map(readAttachmentFile))
  const totalBytes = attachments.reduce((sum, attachment) => sum + attachment.size, 0)
  if (totalBytes > ATTACHMENTS_TOTAL_LIMIT_BYTES) {
    throw new Error(attachmentsLimitError(totalBytes))
  }
  return attachments
}

function displayNameOf(raw: string): string {
  const safe = raw.split(/[/\\]/).pop() ?? ''
  if (!safe || safe === '.' || safe === '..') return 'attachment'
  return safe
}

export async function saveAttachmentFile(
  messageId: string,
  attachmentId: string,
  filename: string
): Promise<boolean> {
  if (!filename.trim()) throw new Error('Attachment name is required')
  const data = await fetchAttachment(messageId, attachmentId)
  const result = await dialog.showSaveDialog({
    title: 'Save attachment',
    defaultPath: displayNameOf(filename)
  })
  if (result.canceled || !result.filePath) return false
  await writeFile(result.filePath, Buffer.from(data, 'base64'))
  return true
}
