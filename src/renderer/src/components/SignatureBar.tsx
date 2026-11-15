import { useId, useState } from 'react'
import { loadSignature, saveSignature, signatureHtml } from '../lib/signature'
import type { BodyEditorHandle } from './BodyEditor'

type SignatureBarProps = {
  // The body editor's handle ref: insert and remove go through the one
  // DOM owner, and each operation's report flows back through the
  // editor's onChange, which is what keeps `present` truthful.
  editor: React.RefObject<BodyEditorHandle | null>
  // Whether the body currently carries the signature block.
  present: boolean
}

// The per-compose signature row, part of the shared ComposerBody so every
// composer surface carries it: a toggle that adds/removes the signature
// block at the body's end, and an inline editor for the stored text. The
// stored signature is account-level (it persists across composes via
// localStorage); whether a given message carries it is per-compose state
// in the body itself — deleting the block by hand is as legitimate as
// toggling it off, and re-adding uses the stored text again.
export function SignatureBar({ editor, present }: SignatureBarProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  // The panel's working text, reloaded at open so an edit abandoned in a
  // previous surface never leaks into this one's panel.
  const [draft, setDraft] = useState('')
  const fieldId = useId()

  function toggle(): void {
    const handle = editor.current
    if (present) {
      handle?.removeSignatureBlock()
      return
    }
    const stored = loadSignature()
    // Nothing stored yet: the toggle opens the editor instead of
    // inserting emptiness — the first click is where the text is born.
    if (stored.trim() === '') {
      setDraft('')
      setEditing(true)
      return
    }
    handle?.insertSignatureBlock(signatureHtml(stored))
  }

  function save(): void {
    saveSignature(draft)
    setEditing(false)
    const handle = editor.current
    // Emptying the stored signature is also a removal: a present block
    // for a signature that no longer exists would be stale content.
    if (draft.trim() === '') {
      if (present) handle?.removeSignatureBlock()
      return
    }
    // A present block re-applies the new text in place of the old one
    // (insert replaces); an absent block stays absent — the stored text
    // only joins bodies the user asks it to.
    if (present) handle?.insertSignatureBlock(signatureHtml(draft))
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
