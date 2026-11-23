import { useId, useState } from 'react'
import { loadSignature, saveSignature } from '../lib/signature'
import { plainTextToHtml } from '../lib/emailHtml'
import type { BodyEditorHandle } from './BodyEditor'

type SignatureBarProps = {
  editor: React.RefObject<BodyEditorHandle | null>
  present: boolean
}

export function SignatureBar({ editor, present }: SignatureBarProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const fieldId = useId()

  function toggle(): void {
    const handle = editor.current
    if (present) {
      handle?.removeSignatureBlock()
      return
    }
    const stored = loadSignature()
    if (stored.trim() === '') {
      setDraft('')
      setEditing(true)
      return
    }
    handle?.insertSignatureBlock(plainTextToHtml(stored))
  }

  function save(): void {
    saveSignature(draft)
    setEditing(false)
    const handle = editor.current
    if (draft.trim() === '') {
      if (present) handle?.removeSignatureBlock()
      return
    }
    if (present) handle?.insertSignatureBlock(plainTextToHtml(draft))
  }

  return (
    <div className="signatureBar">
      {editing ? (
        <div className="signatureEdit">
          <label htmlFor={fieldId}>Signature</label>
          <textarea
            id={fieldId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. Best,&#10;Ada"
          />
          <div className="signatureEdit-actions">
            <button type="button" onClick={save}>
              Save signature
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" aria-pressed={present} onClick={toggle}>
            Signature
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(loadSignature())
              setEditing(true)
            }}
          >
            Edit signature
          </button>
        </>
      )}
    </div>
  )
}
