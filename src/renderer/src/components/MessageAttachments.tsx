import { useState } from 'react'
import type { EmailDetail } from '../../../shared/types'
import { sizeLabel } from '../lib/format'

// A message's own attachment files, shown wherever the message renders:
// received mail in a thread, the sent read view, the stored draft's
// backup — wherever the detail list carries these refs. Each chip is its
// save affordance: clicking it opens the native save dialog with the
// file's own name pre-filled, so no extra button or menu is needed. The
// size labels are the same helper the composer chips use.
export function MessageAttachments({
  message
}: {
  message: EmailDetail
}): React.JSX.Element | null {
  const [savingName, setSavingName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (message.attachments.length === 0) return null

  async function save(ref: EmailDetail['attachments'][number]): Promise<void> {
    if (savingName) return
    setSavingName(ref.filename)
    setError(null)
    try {
      await window.api.saveAttachment(message.id, ref.attachmentId, ref.filename)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingName(null)
    }
  }

  return (
    <div className="readAttachments">
      {message.attachments.map((ref) => (
        <button
          key={ref.attachmentId}
          type="button"
          className="attachmentChip attachmentChip-save"
          disabled={Boolean(savingName)}
          onClick={() => void save(ref)}
        >
          {savingName === ref.filename ? 'Saving...' : ref.filename}
          <span className="attachmentChip-size">{sizeLabel(ref.size)}</span>
        </button>
      ))}
      {error && (
        <p className="attachmentBar-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
