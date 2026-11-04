import type { ComposeAttachment } from '../../../shared/types'
import { sizeLabel } from '../lib/format'

// The composer's chip row: one chip per file, the picker button always
// present. An empty set renders just the button, so a composer without
// files looks exactly like it does today.
export function AttachmentChips({
  attachments,
  error,
  picking,
  onPick,
  onRemove
}: {
  attachments: ComposeAttachment[]
  error: string | null
  picking: boolean
  onPick: () => Promise<void>
  onRemove: (index: number) => void
}): React.JSX.Element {
  return (
    <div className="attachmentBar">
      {attachments.map((attachment, index) => (
        <span key={`${attachment.filename}-${index}`} className="attachmentChip">
          {attachment.filename}
          <span className="attachmentChip-size">{sizeLabel(attachment.size)}</span>
          <button
            type="button"
            aria-label={`Remove ${attachment.filename}`}
            onClick={() => onRemove(index)}
          >
            ×
          </button>
        </span>
      ))}
      {error && (
        <p className="attachmentBar-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={() => void onPick()} disabled={picking}>
        {picking ? 'Picking...' : 'Attach files'}
      </button>
    </div>
  )
}
