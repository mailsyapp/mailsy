import type { ComposerAttachments } from './useComposerAttachments'
import { sizeLabel } from '../lib/format'

// The composer's chip row: one chip per file, the picker button always
// present. An empty set renders just the button, so a composer without
// files looks exactly like it did before any of them existed. One hook
// object in, so every surface's wiring is a single prop.
export function AttachmentChips({ attach }: { attach: ComposerAttachments }): React.JSX.Element {
  return (
    <div className="attachmentBar">
      {attach.attachments.map((attachment, index) => (
        <span key={`${attachment.filename}-${index}`} className="attachmentChip">
          {attachment.filename}
          <span className="attachmentChip-size">{sizeLabel(attachment.size)}</span>
          <button
            type="button"
            aria-label={`Remove ${attachment.filename}`}
            onClick={() => attach.remove(index)}
          >
            ×
          </button>
        </span>
      ))}
      {attach.error && (
        <p className="attachmentBar-error" role="alert">
          {attach.error}
        </p>
      )}
      <button type="button" onClick={() => void attach.pick()} disabled={attach.picking}>
        {attach.picking ? 'Picking...' : 'Attach files'}
      </button>
    </div>
  )
}
