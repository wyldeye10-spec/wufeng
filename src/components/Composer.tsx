import { useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { trapDialogKeys, useDialogFocus } from '../hooks/useDialogFocus'
import { useBodyLock, useVisualViewport } from '../hooks/useEnvironment'
import {
  DEFAULT_MEMO_ICON,
  type Memo,
  type MemoIcon,
} from '../lib/store'
import { clampChars, countChars, isBlank } from '../lib/text'
import { ConfirmDialog } from './ConfirmDialog'
import { MEMO_MARK_OPTIONS, MemoMark } from './MemoMark'

interface ComposerProps {
  mode: 'new' | 'edit'
  memo?: Memo
  onClose: () => void
  onSubmit: (draft: { title: string; content: string; icon: MemoIcon }) => Promise<void>
  onDelete?: () => Promise<Memo | null>
  onDeleteFinished?: (memo: Memo) => void
  reducedMotion: boolean
}

const TITLE_LIMIT = 8
const CONTENT_LIMIT = 50

export function Composer({
  mode,
  memo,
  onClose,
  onSubmit,
  onDelete,
  onDeleteFinished,
  reducedMotion,
}: ComposerProps) {
  const [title, setTitle] = useState(memo?.title ?? '')
  const [content, setContent] = useState(memo?.content ?? '')
  const [icon, setIcon] = useState<MemoIcon>(memo?.icon ?? DEFAULT_MEMO_ICON)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [closing, setClosing] = useState(false)
  const composing = useRef(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const contentId = useId()
  const errorId = useId()
  const markId = useId()

  useBodyLock(true)
  useVisualViewport(true)
  useDialogFocus(sheetRef, titleRef)

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
    if (saving || confirming) return
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

  const remove = async () => {
    if (!onDelete || !onDeleteFinished || saving) return
    setError(null)
    setSaving(true)
    try {
      const target = await onDelete()
      if (!target) {
        setSaving(false)
        return
      }
      // 数据先落定；确认层与卷纸层一起淡出，再让列表里的条目以墨迹消散。
      setClosing(true)
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, reducedMotion ? 0 : 380)
      })
      onDeleteFinished(target)
    } catch {
      setConfirming(false)
      setError('抹去未成，卷宗未能更新。')
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className={`composer${reducedMotion ? ' composer--calm' : ''}${closing ? ' composer--closing' : ''}`}
      role="presentation"
    >
      <div className="composer__backdrop" aria-hidden="true" />

      <div className="composer__viewport">
        <div className="sheet-roll">
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="composer-heading"
            ref={sheetRef}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (saving) {
                event.stopPropagation()
                return
              }
              if (event.nativeEvent.isComposing) return
              trapDialogKeys(event, sheetRef.current, onClose)
            }}
          >
            <div className="sheet__torn" aria-hidden="true" />

            <header className="sheet__head">
              <div>
                <p className="sheet__kicker">无 锋 · 卷 宗</p>
                <h2 className="sheet__heading" id="composer-heading">
                  {mode === 'edit' ? '改记' : '新记'}
                </h2>
              </div>
              <button
                type="button"
                className="sheet__close"
                onClick={onClose}
                disabled={saving}
                aria-label="关闭编辑"
              >
                罢
              </button>
            </header>

            <form className="sheet__form" onSubmit={(event) => void submit(event)}>
              <div className="sheet__fields">
                <div className="field field--mark">
                  <div className="field__top">
                    <span className="field__label" id={markId}>
                      事项印记
                    </span>
                  </div>
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

                <div className="field">
                  <div className="field__top">
                    <label className="field__label" htmlFor={titleId}>
                      事项标题
                    </label>
                    <span
                      className={`field__count${titleCount >= TITLE_LIMIT ? ' is-limit' : ''}`}
                      aria-live="polite"
                    >
                      {titleCount}/{TITLE_LIMIT}
                    </span>
                  </div>
                  <input
                    id={titleId}
                    ref={titleRef}
                    className="field__input field__input--title"
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

                <div className="field field--content">
                  <div className="field__top">
                    <label className="field__label" htmlFor={contentId}>
                      事项内容
                    </label>
                    <span
                      className={`field__count${contentCount >= CONTENT_LIMIT ? ' is-limit' : ''}`}
                      aria-live="polite"
                    >
                      {contentCount}/{CONTENT_LIMIT}
                    </span>
                  </div>
                  <textarea
                    id={contentId}
                    ref={contentRef}
                    className="field__input field__input--content"
                    value={content}
                    onChange={(event) =>
                      guardClamp(event.target.value, CONTENT_LIMIT, setContent)
                    }
                    onCompositionStart={() => {
                      composing.current = true
                    }}
                    onCompositionEnd={finishComposition}
                    placeholder="五十字以内，写尽即可"
                    rows={4}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    aria-describedby={error ? errorId : undefined}
                  />
                </div>
              </div>

              <p className={`sheet__error${error ? ' is-visible' : ''}`} id={errorId} role="alert">
                {error ?? '\u00a0'}
              </p>

              <footer className="sheet__foot">
                {mode === 'edit' && onDelete ? (
                  <button
                    type="button"
                    className="sheet__delete"
                    onClick={() => setConfirming(true)}
                    disabled={saving}
                  >
                    抹去此事
                  </button>
                ) : (
                  <span className="sheet__imprint" aria-hidden="true">
                    墨落为凭
                  </span>
                )}

                <button type="submit" className="seal-button" disabled={saving} aria-busy={saving}>
                  <span>{saving ? '落印' : '记下'}</span>
                </button>
              </footer>
            </form>
          </div>
        </div>
      </div>

      {confirming ? (
        <ConfirmDialog
          onCancel={() => setConfirming(false)}
          onConfirm={() => void remove()}
          busy={saving}
          closing={closing}
        />
      ) : null}
    </div>,
    document.body,
  )
}
