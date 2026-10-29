import { dialog } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { ATTACHMENTS_TOTAL_LIMIT_BYTES, type ComposeAttachment } from '../shared/types'

// Local file picking for the composer. It sits outside mail/ because
// choosing local files is not Gmail work; index.ts wires the single verb
// as 'attachments:pick'.

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
    throw new Error(
      `Attachments are too large to send (${Math.floor(totalBytes / (1024 * 1024))} MB). Gmail's limit is 25 MB per message.`
    )
  }
  return attachments
}
