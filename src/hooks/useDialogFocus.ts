import { useEffect, type KeyboardEvent, type RefObject } from 'react'

export function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((node) => {
    return node.getAttribute('aria-hidden') !== 'true' && node.offsetParent !== null
  })
}

export function trapDialogKeys(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
  onClose: () => void,
): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    onClose()
    return
  }

  if (event.key !== 'Tab') return

  const nodes = getFocusable(container)
  if (nodes.length === 0) {
    event.preventDefault()
    container?.focus()
    return
  }

  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const active = document.activeElement

  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

/** 弹层打开时接管焦点，关闭后归还；供对话框、卷纸编辑层共用。 */
export function useDialogFocus(
  containerRef: RefObject<HTMLElement | null>,
  initialRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => {
      const target =
        initialRef?.current ?? getFocusable(containerRef.current)[0] ?? containerRef.current
      target?.focus({ preventScroll: true })
    }, 40)

    return () => {
      window.clearTimeout(timer)
      if (previous && document.contains(previous)) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [containerRef, initialRef])
}
