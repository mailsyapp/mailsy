import type { ComposerAttachments } from './useComposerAttachments'
import { sizeLabel } from '../lib/format'

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
