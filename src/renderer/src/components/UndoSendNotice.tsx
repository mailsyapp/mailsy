import { UNDO_SEND_DELAY_MS } from '../lib/pendingSend'

export function UndoSendNotice({ onUndo }: { onUndo: () => void }): React.JSX.Element {
  return (
    <div className="undoSendNotice">
      <span role="status">Message will send in {UNDO_SEND_DELAY_MS / 1000} seconds.</span>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
    </div>
  )
}
