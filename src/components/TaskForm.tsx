import { useId, useRef, useState, type FormEvent } from 'react'
import { MEMO_ICON_LABELS, type MemoIcon } from '../lib/store'
import { clampChars, countChars, isBlank } from '../lib/text'
import { MEMO_MARK_OPTIONS, MemoMark } from './MemoMark'

export interface TaskDraft {
  title: string
  content: string
  icon: MemoIcon
}

interface TaskFormProps {
  mode: 'create' | 'edit' | 'follow'
  category: MemoIcon
  initial?: { title: string; content: string; icon: MemoIcon }
  /** 编辑时允许改类别；新建与续写时类别已定。 */
  showCategory?: boolean
  submitLabel: string
  onSubmit: (draft: TaskDraft) => Promise<void>
  onCancel: () => void
}

const TITLE_LIMIT = 8
const CONTENT_LIMIT = 50

export function TaskForm({
  mode,
  category,
  initial,
  showCategory = false,
  submitLabel,
  onSubmit,
  onCancel,
}: TaskFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const [icon, setIcon] = useState<MemoIcon>(initial?.icon ?? category)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const composing = useRef(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const contentId = useId()
  const errorId = useId()
  const markId = useId()

  const titleCount = countChars(title)
  const contentCount = countChars(content)

  const guardClamp = (value: string, limit: number, update: (next: string) => void) => {
    if (composing.current) {
      // 输入法组合期间绝不截断，否则拼音会被拦腰斩断。
      update(value)
      return
    }
    update(clampChars(value, limit))
  }

  const finishComposition = () => {
    composing.current = false
    window.setTimeout(() => {
      setTitle((current) => clampChars(current, TITLE_LIMIT))
      setContent((current) => clampChars(current, CONTENT_LIMIT))
    }, 0)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    setError(null)

    const nextTitle = clampChars(title, TITLE_LIMIT).trim()
    const nextContent = clampChars(content, CONTENT_LIMIT).trim()

    if (isBlank(nextTitle)) {
      setError('题，不可空。')
      titleRef.current?.focus()
      return
    }
    if (isBlank(nextContent)) {
      setError('文，不可空。')
      contentRef.current?.focus()
      return
    }

    setSaving(true)
    try {
      await onSubmit({ title: nextTitle, content: nextContent, icon })
    } catch {
      setError('落笔未成，卷宗未能写入本机。')
      setSaving(false)
    }
  }

  return (
    <form className={`task-form task-form--${mode}`} onSubmit={(event) => void submit(event)}>
      {showCategory ? (
        <div className="task-form__field task-form__field--mark">
          <span className="task-form__label" id={markId}>
            类别
          </span>
          <div className="mark-picker" role="group" aria-labelledby={markId}>
            {MEMO_MARK_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`mark-choice${icon === option.value ? ' is-selected' : ''}`}
                aria-pressed={icon === option.value}
                onClick={() => setIcon(option.value)}
                disabled={saving}
              >
                <MemoMark icon={option.value} size={26} />
                <span className="mark-choice__label">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="task-form__mark" aria-hidden="true">
          <span className="task-form__icon">
            <MemoMark icon={icon} size={38} />
          </span>
          <span className="task-form__kind">{MEMO_ICON_LABELS[icon]}</span>
          <span className="task-form__kind-note">
            {mode === 'follow' ? '承前一事' : '新开一脉'}
          </span>
        </div>
      )}

      <div className="task-form__field">
        <div className="task-form__top">
          <label className="task-form__label" htmlFor={titleId}>
            任务标题
          </label>
          <span
            className={`task-form__count${titleCount >= TITLE_LIMIT ? ' is-limit' : ''}`}
            aria-live="polite"
          >
            {titleCount}/{TITLE_LIMIT}
          </span>
        </div>
        <input
          id={titleId}
          ref={titleRef}
          className="task-form__input task-form__input--title"
          value={title}
          onChange={(event) => guardClamp(event.target.value, TITLE_LIMIT, setTitle)}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={finishComposition}
          placeholder="八字以内"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="next"
          aria-describedby={error ? errorId : undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              contentRef.current?.focus()
            }
          }}
        />
      </div>

      <div className="task-form__field">
        <div className="task-form__top">
          <label className="task-form__label" htmlFor={contentId}>
            任务细则
          </label>
          <span
            className={`task-form__count${contentCount >= CONTENT_LIMIT ? ' is-limit' : ''}`}
            aria-live="polite"
          >
            {contentCount}/{CONTENT_LIMIT}
          </span>
        </div>
        <textarea
          id={contentId}
          ref={contentRef}
          className="task-form__input task-form__input--content"
          value={content}
          onChange={(event) => guardClamp(event.target.value, CONTENT_LIMIT, setContent)}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={finishComposition}
          placeholder="五十字以内，写尽即可"
          rows={3}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby={error ? errorId : undefined}
        />
      </div>

      <p className={`task-form__error${error ? ' is-visible' : ''}`} id={errorId} role="alert">
        {error ?? '\u00a0'}
      </p>

      <div className="task-form__foot">
        <button type="button" className="task-form__cancel" onClick={onCancel} disabled={saving}>
          罢
        </button>
        <button type="submit" className="task-form__submit" disabled={saving} aria-busy={saving}>
          <span>{saving ? '落笔' : submitLabel}</span>
        </button>
      </div>
    </form>
  )
}
