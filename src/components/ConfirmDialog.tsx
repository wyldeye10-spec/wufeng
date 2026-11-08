import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { trapDialogKeys, useDialogFocus } from '../hooks/useDialogFocus'

interface ConfirmDialogProps {
  onCancel: () => void
  onConfirm: () => void
  busy?: boolean
  closing?: boolean
  seal?: string
  title?: string
  note?: string
  confirmLabel?: string
  cancelLabel?: string
}

export function ConfirmDialog({
  onCancel,
  onConfirm,
  busy = false,
  closing = false,
  seal = '抹',
  title = '此事将从卷宗中抹去。',
  note = '抹去之后，不可复得。',
  confirmLabel = '抹去',
  cancelLabel = '留下',
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  useDialogFocus(panelRef, cancelRef)

  return createPortal(
    <div
      className={`modal modal--confirm${closing ? ' modal--closing' : ''}`}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy && !closing) onCancel()
      }}
      onKeyDown={(event) => {
        if (busy || closing) return
        trapDialogKeys(event, panelRef.current, onCancel)
      }}
    >
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={panelRef}
        tabIndex={-1}
      >
        <span className="confirm__seal" aria-hidden="true">
          {seal}
        </span>
        <p className="confirm__title" id={titleId}>
          {title}
        </p>
        <p className="confirm__note" id={descriptionId}>
          {note}
        </p>
        <div className="confirm__actions">
          <button
            type="button"
            className="sheet-button sheet-button--ghost"
            onClick={onCancel}
            disabled={busy}
            ref={cancelRef}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="sheet-button sheet-button--danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
