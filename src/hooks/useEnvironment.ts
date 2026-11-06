import { useEffect, useState } from 'react'

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  return reduced
}

export function useBodyLock(active: boolean): void {
  useEffect(() => {
    if (!active) return

    const html = document.documentElement
    const body = document.body
    const previous = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      bodyPaddingRight: body.style.paddingRight,
    }
    const scrollbar = Math.max(0, window.innerWidth - html.clientWidth)

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`

    return () => {
      html.style.overflow = previous.htmlOverflow
      body.style.overflow = previous.bodyOverflow
      body.style.overscrollBehavior = previous.bodyOverscroll
      body.style.paddingRight = previous.bodyPaddingRight
    }
  }, [active])
}

/**
 * 让固定层跟随可视视口。
 * iOS 软键盘主要靠 visualViewport.resize；桌面窗口缩放和部分 WebView
 * 只发 window.resize，因此两套事件都监听，并用 min() 防止可视视口读数滞后。
 */
export function useVisualViewport(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const viewport = window.visualViewport
    const root = document.documentElement

    const update = () => {
      const height = viewport ? Math.min(viewport.height, window.innerHeight) : window.innerHeight
      const top = viewport?.offsetTop ?? 0
      root.style.setProperty('--vv-height', `${Math.round(height)}px`)
      root.style.setProperty('--vv-top', `${Math.round(top)}px`)
    }

    const scheduleUpdate = () => {
      update()
      window.setTimeout(update, 140)
      window.setTimeout(update, 360)
    }

    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    document.addEventListener('focusin', scheduleUpdate)
    document.addEventListener('focusout', scheduleUpdate)

    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      document.removeEventListener('focusin', scheduleUpdate)
      document.removeEventListener('focusout', scheduleUpdate)
      root.style.removeProperty('--vv-height')
      root.style.removeProperty('--vv-top')
    }
  }, [active])
}
