import { dialog } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fetchAttachment } from './mail/messages'
import {
  ATTACHMENTS_TOTAL_LIMIT_BYTES,
  attachmentsLimitError,
  type ComposeAttachment
} from '../shared/types'

// Local file handling for attachments: the composer's picking (native
// dialog) and received mail's saving (save dialog plus write). Both sit
// outside mail/ because talking to the local filesystem is not Gmail
// work; index.ts wires the verbs as 'attachments:pick' and
// 'attachments:save'.

async function readAttachmentFile(path: string): Promise<ComposeAttachment> {
  const bytes = await readFile(path)
  return {
    filename: basename(path),
    size: bytes.length,
    data: bytes.toString('base64')
  }
}

// Opens the native file picker and returns the picked files fully in
// memory as ComposeAttachment records (base64). Nothing picked means the
// user cancelled: the composer keeps its files unchanged. The pick's total
// is checked here so an over-budget selection fails at pick time with the
// real sentence, and the boundary re-check in send exists only for a
// mutated request that skipped this gate.
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

// A remote name can carry anything a MIME header allowed, so only its
// final segment survives — with separators of either platform stripped —
// and path-traversal shapes collapse to nothing. The dialog's own picker
// is still the authority on where files land; this only pre-fills it.
function displayNameOf(raw: string): string {
  const safe = raw.split(/[/\\]/).pop() ?? ''
  if (!safe || safe === '.' || safe === '..') return 'attachment'
  return safe
}

// Saves one stored attachment's bytes to a file the user chooses through
// the native save dialog. The fetch stays in main: the bytes never need
// to round-trip back through the renderer, and a cancelled dialog writes
// nothing. Resolves to true only when the file was written.
export async function saveAttachmentFile(
  messageId: string,
  attachmentId: string,
  filename: string
): Promise<boolean> {
  // fetchAttachment validates both ids with the same sentence the get
  // bridge throws, so this guard keeps the user-facing name check alone.
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
