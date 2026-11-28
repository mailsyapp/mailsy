import { useLeftSends } from '../hooks/useLeftSends'
import { leftSends, UNDO_SEND_DELAY_MS } from '../lib/pendingSend'

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

export function LeftSendNotices({
  onOpenDraft
}: {
  onOpenDraft: (draftId: string) => void
}): React.JSX.Element | null {
  const sends = useLeftSends()
  if (sends.length === 0) return null
  return (
    <div className="leftSendNotices" role="region" aria-label="Outgoing messages">
      {sends.map((send) => {
        if (send.phase === 'waiting') {
          return <UndoSendNotice key={send.id} onUndo={send.undo} />
        }
        if (send.phase === 'failed' || send.phase === 'undone') {
          return (
            <div className="undoSendNotice" key={send.id}>
              {send.phase === 'failed' ? (
                <span role="alert">Message not sent: {send.error}</span>
              ) : (
                <span role="status">Sending undone. The message is in Drafts.</span>
              )}
              {send.draftId && (
                <button
                  type="button"
                  onClick={() => {
                    leftSends.remove(send.id)
                    onOpenDraft(send.draftId!)
                  }}
                >
                  Open draft
                </button>
              )}
              <button type="button" onClick={() => leftSends.remove(send.id)}>
                Dismiss
              </button>
            </div>
          )
        }
        return (
          <div className="undoSendNotice" key={send.id}>
            <span role="status">{send.phase === 'preparing' ? 'Preparing...' : 'Sending...'}</span>
          </div>
        )
      })}
    </div>
  )
}
