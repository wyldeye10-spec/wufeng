import type { Memo } from '../lib/store'
import { MemoMark } from './MemoMark'
import { Seal } from './Seal'

interface MemoRowProps {
  memo: Memo
  sinking: boolean
  rising: boolean
  arriving: boolean
  /** 同一脉络中的序号，例如「其二」；单件脉络不显示。 */
  step?: string
  onComplete: (memo: Memo) => void
}

export function MemoRow({ memo, sinking, rising, arriving, step, onComplete }: MemoRowProps) {
  const classes = [
    'memo',
    memo.done ? 'is-done' : 'is-open',
    sinking ? 'is-sinking' : '',
    rising ? 'is-rising' : '',
    arriving ? 'is-arriving' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={classes} data-id={memo.id} data-state={memo.done ? 'done' : 'open'}>
      <div className="memo__body">
        <span className="memo__head">
          <MemoMark icon={memo.icon} size={26} className="memo__mark" />
          <span className="memo__title">{memo.title}</span>
          {step && !memo.done ? (
            <span className="memo__step" aria-label={`脉络${step}`}>
              {step}
            </span>
          ) : null}
        </span>
        <span className="memo__content">{memo.content}</span>
      </div>

      <div className="memo__end">
        {memo.done ? (
          <span className="memo__seal" role="img" aria-label="已了">
            <Seal chars="已了" />
          </span>
        ) : (
          <button
            type="button"
            className="memo__stamp"
            aria-label={`盖印完成：${memo.title}`}
            onClick={() => onComplete(memo)}
            disabled={sinking}
          >
            <span className="memo__stamp-corner memo__stamp-corner--tl" aria-hidden="true" />
            <span className="memo__stamp-corner memo__stamp-corner--tr" aria-hidden="true" />
            <span className="memo__stamp-corner memo__stamp-corner--bl" aria-hidden="true" />
            <span className="memo__stamp-corner memo__stamp-corner--br" aria-hidden="true" />
            <span className="memo__stamp-char">了</span>
          </button>
        )}
      </div>
    </article>
  )
}
