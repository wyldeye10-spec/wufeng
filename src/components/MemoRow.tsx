import { useRef, useState, type CSSProperties } from 'react'
import type { Memo } from '../lib/store'
import { MemoMark } from './MemoMark'
import { Seal } from './Seal'

interface MemoRowProps {
  memo: Memo
  entering: boolean
  erasing: boolean
  leaving: boolean
  arriving: boolean
  onEdit: (memo: Memo) => void
  onComplete: (memo: Memo) => Promise<void>
  onUndo: (memo: Memo) => Promise<void>
}

const SPLATS = Array.from({ length: 9 }, (_, index) => ({
  angle: (index * 41 + 13) % 360,
  distance: 24 + ((index * 17) % 26),
  delay: (index % 4) * 14,
  size: 2 + ((index * 7) % 4),
}))

export function MemoRow({
  memo,
  entering,
  erasing,
  leaving,
  arriving,
  onEdit,
  onComplete,
  onUndo,
}: MemoRowProps) {
  const [effect, setEffect] = useState<'stamp' | 'undo' | null>(null)
  const busy = useRef(false)

  const stamp = async () => {
    if (busy.current || memo.done) return
    busy.current = true
    setEffect('stamp')
    try {
      await onComplete(memo)
    } catch {
      // App 层已给出提示；这里只负责收起动画。
    } finally {
      busy.current = false
      setEffect(null)
    }
  }

  const undo = async () => {
    if (busy.current || !memo.done) return
    busy.current = true
    setEffect('undo')
    try {
      await onUndo(memo)
    } catch {
      // 同上
    } finally {
      busy.current = false
      setEffect(null)
    }
  }

  const classes = [
    'memo',
    memo.done ? 'is-done' : 'is-open',
    entering ? 'is-entering' : '',
    erasing ? 'is-erasing' : '',
    leaving ? 'is-leaving' : '',
    arriving ? 'is-arriving' : '',
    effect === 'stamp' ? 'is-stamping' : '',
    effect === 'undo' ? 'is-undone' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={classes} data-id={memo.id} data-state={memo.done ? 'done' : 'open'}>
      <button
        type="button"
        className="memo__body"
        aria-label={`编辑：${memo.title}`}
        onClick={() => onEdit(memo)}
        disabled={effect !== null}
      >
        <span className="memo__head">
          <MemoMark icon={memo.icon} size={26} className="memo__mark" />
          <span className="memo__title">{memo.title}</span>
          <span className="memo__edit" aria-hidden="true">
            改
          </span>
        </span>
        <span className="memo__content">{memo.content}</span>
      </button>

      <div className="memo__end">
        {memo.done ? (
          <button
            type="button"
            className="memo__seal"
            aria-label={`撤销完成：${memo.title}`}
            onClick={() => void undo()}
            disabled={effect !== null}
          >
            <Seal chars="已了" />
          </button>
        ) : (
          <button
            type="button"
            className="memo__stamp"
            aria-label={`盖印完成：${memo.title}`}
            onClick={() => void stamp()}
            disabled={effect !== null}
          >
            <span className="memo__stamp-corner memo__stamp-corner--tl" aria-hidden="true" />
            <span className="memo__stamp-corner memo__stamp-corner--tr" aria-hidden="true" />
            <span className="memo__stamp-corner memo__stamp-corner--bl" aria-hidden="true" />
            <span className="memo__stamp-corner memo__stamp-corner--br" aria-hidden="true" />
            <span className="memo__stamp-char">了</span>
          </button>
        )}
      </div>

      {effect === 'stamp' ? (
        <span className="stamp-fx" aria-hidden="true">
          <span className="stamp-fx__splats">
            {SPLATS.map((splat, index) => (
              <i
                key={index}
                style={
                  {
                    '--angle': `${splat.angle}deg`,
                    '--distance': `${splat.distance}px`,
                    '--delay': `${splat.delay}ms`,
                    '--size': `${splat.size}px`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
          <span className="stamp-fx__seal">
            <Seal chars="已了" />
          </span>
        </span>
      ) : null}
    </article>
  )
}
