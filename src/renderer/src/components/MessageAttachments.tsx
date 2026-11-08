import { useEffect, useState } from 'react'
import type { EmailDetail } from '../../../shared/types'
import { errorMessage, sizeLabel } from '../lib/format'
import { imageMimeOf, looksLikeImageName } from '../lib/attachmentFile'

// A message's own attachment files, shown wherever the message renders:
// received mail in a thread, the sent read view, the stored draft's backup
// — wherever the detail list carries these refs.
//
// Image refs preview themselves inline: the bytes fetch on render through
// the stored-attachment verb and land as a data URL, so a screenshot shows
// as a screenshot, not a save dialog. Non-image refs keep the chip form,
// each chip its save affordance through the native save dialog.
export function MessageAttachments({
  message
}: {
  message: EmailDetail
}): React.JSX.Element | null {
  // Data URLs keyed by attachment id once fetched; a ref the fetch failed
  // for surfaces through the shared error line instead.
  const [previews, setPreviews] = useState<Map<string, string>>(new Map())
  const [savingName, setSavingName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const imageRefs = message.attachments.filter((ref) => looksLikeImageName(ref.filename))
  const otherRefs = message.attachments.filter((ref) => !looksLikeImageName(ref.filename))

  useEffect(() => {
    let alive = true
    const missing = imageRefs.filter((ref) => !previews.has(ref.attachmentId))
    for (const ref of missing) {
      window.api
        .getAttachment(message.id, ref.attachmentId)
        .then((data) => {
          if (!alive) return
          setPreviews((prev) => {
            const next = new Map(prev)
            next.set(ref.attachmentId, `data:${imageMimeOf(ref.filename)};base64,${data}`)
            return next
          })
        })
        .catch(() => {
          if (!alive) return
          setError('Could not load preview images.')
        })
    }
    return () => {
      alive = false
    }
    // Refs settle once per open message; the map is fetch-once state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, message.attachments.length])

  if (message.attachments.length === 0) return null

  async function save(ref: EmailDetail['attachments'][number]): Promise<void> {
    if (savingName) return
    setSavingName(ref.filename)
    setError(null)
    try {
      await window.api.saveAttachment(message.id, ref.attachmentId, ref.filename)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSavingName(null)
    }
  }

  return (
    <div className="readAttachments">
      {imageRefs.map((ref) => (
        <figure key={ref.attachmentId} className="readAttachment-preview">
          {/* The alt stays the file name: the preview is that file. */}
          {previews.has(ref.attachmentId) && (
            <img src={previews.get(ref.attachmentId)} alt={ref.filename} />
          )}
          {!previews.has(ref.attachmentId) && !error && (
            <figcaption role="status">Loading {ref.filename}...</figcaption>
          )}
        </figure>
      ))}
      {otherRefs.map((ref) => (
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
