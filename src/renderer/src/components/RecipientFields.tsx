import { useId, useState } from 'react'
import type { RecipientLines } from '../../../shared/types'

type RecipientFieldsProps = {
  to: string
  cc: string
  bcc: string
  onChange: (patch: RecipientLines) => void
}

// Gmail's recipient block: To is always visible, Cc and Bcc sit collapsed
// until the links on the To row reveal them. Reveal is one-way and the links
// disappear once opened, so reveal is idempotent and a click can never hide
// (and later lose) typed content. Composers restored from state that already
// carries cc/bcc — a reply-all or a Gmail draft saved with carbon lists —
// open those fields ready-filled.
export function RecipientFields({
  to,
  cc,
  bcc,
  onChange
}: RecipientFieldsProps): React.JSX.Element {
  const [ccOpen, setCcOpen] = useState(Boolean(cc))
  const [bccOpen, setBccOpen] = useState(Boolean(bcc))
  // Reveal is one-way from a link click, but a replaced in-place draft can
  // carry carbon lists into a field that is still hidden: the reply blocks
  // render above an open inline composer, so reply-all after a plain reply
  // swaps the component's props without remounting. Content present makes
  // its field visible, no effect needed; the mirror direction (emptied
  // while opened by a click) stays open, which a link can never undo.
  const showCc = ccOpen || cc.trim() !== ''
  const showBcc = bccOpen || bcc.trim() !== ''
  // The To row is a grid div (the reveal links live beside the input), so
  // the span is a real label by htmlFor, not by wrapping.
  const toId = useId()

  return (
    <>
      <div className="composerField composerField-reveal">
        <label htmlFor={toId}>To</label>
        <input id={toId} value={to} onChange={(event) => onChange({ to: event.target.value })} />
        {(!showCc || !showBcc) && (
          <span className="composerReveal">
            {!showCc && (
              <button type="button" onClick={() => setCcOpen(true)}>
                Cc
              </button>
            )}
            {!showBcc && (
              <button type="button" onClick={() => setBccOpen(true)}>
                Bcc
              </button>
            )}
          </span>
        )}
      </div>
      {showCc && (
        <label className="composerField">
          <span>Cc</span>
          <input value={cc} onChange={(event) => onChange({ cc: event.target.value })} />
        </label>
      )}
      {showBcc && (
        <label className="composerField">
          <span>Bcc</span>
          <input value={bcc} onChange={(event) => onChange({ bcc: event.target.value })} />
        </label>
      )}
    </>
  )
}
