import { useId, useState } from 'react'
import type { RecipientLines } from '../../../shared/types'

type RecipientFieldsProps = {
  to: string
  cc: string
  bcc: string
  onChange: (patch: RecipientLines) => void
}

export function RecipientFields({
  to,
  cc,
  bcc,
  onChange
}: RecipientFieldsProps): React.JSX.Element {
  const [ccOpen, setCcOpen] = useState(Boolean(cc))
  const [bccOpen, setBccOpen] = useState(Boolean(bcc))
  const showCc = ccOpen || cc.trim() !== ''
  const showBcc = bccOpen || bcc.trim() !== ''
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
