import { useState } from 'react'
import { useOnMount } from '../hooks/useOnMount'
import type { EmailDetail } from '../../../shared/types'
import { errorMessage, sizeLabel } from '../lib/format'
import { imageMimeOf, looksLikeImageName } from '../lib/attachmentFile'

export function MessageAttachments({
  message
}: {
  message: EmailDetail
}): React.JSX.Element | null {
  const [previews, setPreviews] = useState<Map<string, string | null>>(new Map())
  const [savingName, setSavingName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useOnMount((isMounted) => {
    const imageRefs = message.attachments.filter((ref) => looksLikeImageName(ref.filename))
    Promise.all(
      imageRefs.map(async (ref) => ({
        id: ref.attachmentId,
        src: await window.api
          .getAttachment(message.id, ref.attachmentId)
          .then((data) => `data:${imageMimeOf(ref.filename)};base64,${data}`)
          .catch(() => null)
      }))
    ).then((entries) => {
      if (isMounted()) setPreviews(new Map(entries.map((entry) => [entry.id, entry.src])))
    })
  })

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
              <img src={src} alt={ref.filename} />
            </figure>
          )
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
