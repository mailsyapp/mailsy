import type { ComposeAttachment } from '../../../shared/types'

// Reads as bytes under 1 KB, kilobytes under 1 MB, one decimal for MB.
// Gmail's ref sizes report the raw base64 payload, so these are close
// enough at chip scale and never claimed to be exact.
function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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
