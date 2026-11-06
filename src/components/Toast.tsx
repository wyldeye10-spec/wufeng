import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ToastProps {
  toast: { id: number; message: string } | null
  onDismiss: () => void
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!toast) return
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(onDismiss, 4600)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.id])

  if (!toast) return null

  return createPortal(
    <div className="toast" role="status" aria-live="polite">
      <span className="toast__bar" aria-hidden="true" />
      <p>{toast.message}</p>
      <button type="button" className="toast__close" onClick={onDismiss} aria-label="收起提示">
        ×
      </button>
    </div>,
    document.body,
  )
}
