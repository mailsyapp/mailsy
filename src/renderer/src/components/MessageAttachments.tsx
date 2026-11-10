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
// each chip its save affordance through the native save dialog, and an
// image the preview fetch failed for falls back to its chip the same way.
export function MessageAttachments({
  message
}: {
  message: EmailDetail
}): React.JSX.Element | null {
  // The image previews, keyed by attachment id: a fetched ref's data URL,
  // `null` once its fetch failed (its save chip stands in). The parent keys
  // this component by message id, so the map holds one message's round and
  // stays fetch-once state.
  const [previews, setPreviews] = useState<Map<string, string | null>>(new Map())
  const [savingName, setSavingName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const imageRefs = message.attachments.filter((ref) => looksLikeImageName(ref.filename))
    let alive = true
    // One atomic round: every image preview lands together (bytes or a null
    // failure), so the render below has no per-ref transitions and no
    // restart race over a growing map.
    Promise.all(
      imageRefs.map(async (ref) => ({
        id: ref.attachmentId,
        src: await window.api
          .getAttachment(message.id, ref.attachmentId)
          .then((data) => `data:${imageMimeOf(ref.filename)};base64,${data}`)
          .catch(() => null)
      }))
    ).then((entries) => {
      if (alive) setPreviews(new Map(entries.map((entry) => [entry.id, entry.src])))
    })
    return () => {
      alive = false
    }
    // Refs settle once per open message; the key={message.id} remount owns
    // the reset between messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      {message.attachments.map((ref) => {
        const src = looksLikeImageName(ref.filename) ? previews.get(ref.attachmentId) : null
        if (src === undefined)
          return (
            <figure key={ref.attachmentId} className="readAttachment-preview">
              <figcaption role="status">Loading {ref.filename}...</figcaption>
            </figure>
          )
        if (src)
          return (
            <figure key={ref.attachmentId} className="readAttachment-preview">
              {/* The alt stays the file name: the preview is that file. */}
              <img src={src} alt={ref.filename} />
            </figure>
          )
        // A non-image ref, or an image whose preview fetch failed: the chip
        // is its affordance either way.
        return (
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
        )
      })}
      {error && (
        <p className="attachmentBar-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
