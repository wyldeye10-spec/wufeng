import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import {
  buildChains,
  categoryLabel,
  sortChains,
  stepLabel,
  type Chain,
  type ChainSort,
} from '../lib/chain'
import { MEMO_ICONS, type Memo, type MemoIcon } from '../lib/store'
import { useBodyLock } from '../hooks/useEnvironment'
import { MemoMark } from './MemoMark'
import { ConfirmDialog } from './ConfirmDialog'
import { TaskForm, type TaskDraft } from './TaskForm'

type View =
  | { mode: 'idle' }
  | { mode: 'new'; kind: MemoIcon }
  | { mode: 'edit'; id: string }
  | { mode: 'follow'; id: string }

interface DragState {
  chainId: string
  id: string
  order: string[]
}

interface StudioProps {
  memos: Memo[]
  reducedMotion: boolean
  seedNew: boolean
  notify: (message: string) => void
  onCreate: (draft: TaskDraft) => Promise<Memo>
  onUpdate: (id: string, draft: TaskDraft) => Promise<void>
  onAddFollowUp: (anchorId: string, draft: TaskDraft) => Promise<Memo>
  onReorder: (chainId: string, order: string[]) => Promise<void>
  onMove: (id: string, direction: -1 | 1) => Promise<void>
  onErase: (id: string) => Promise<void>
}

const SORTS: { value: ChainSort; label: string; hint: string }[] = [
  { value: 'category', label: '类别', hint: '故事 → 轶闻 → 收集，再按创建时间' },
  { value: 'created', label: '创建', hint: '按脉络创建时间先后' },
  { value: 'updated', label: '修改', hint: '最近修改的排在前面' },
]

const GRIP = (
  <svg viewBox="0 0 16 20" width="14" height="18" aria-hidden="true" focusable="false">
    <g fill="currentColor">
      <circle cx="5" cy="5" r="1.35" />
      <circle cx="11" cy="5" r="1.35" />
      <circle cx="5" cy="10" r="1.35" />
      <circle cx="11" cy="10" r="1.35" />
      <circle cx="5" cy="15" r="1.35" />
      <circle cx="11" cy="15" r="1.35" />
    </g>
  </svg>
)

export function Studio({
  memos,
  reducedMotion,
  seedNew,
  notify,
  onCreate,
  onUpdate,
  onAddFollowUp,
  onReorder,
  onMove,
  onErase,
}: StudioProps) {
  const [sortMode, setSortMode] = useState<ChainSort>('category')
  const [chooserOpen, setChooserOpen] = useState(seedNew)
  const [view, setView] = useState<View>({ mode: 'idle' })
  const [confirmErase, setConfirmErase] = useState<Memo | null>(null)
  const [erasing, setErasing] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const dragDone = useRef(false)
  dragRef.current = drag
  useBodyLock(confirmErase !== null)

  const chains = useMemo(() => sortChains(buildChains(memos), sortMode), [memos, sortMode])
  const byId = useMemo(() => new Map(memos.map((memo) => [memo.id, memo])), [memos])

  useEffect(() => {
    if (view.mode !== 'edit' && view.mode !== 'follow') return
    if (!memos.some((memo) => memo.id === view.id)) setView({ mode: 'idle' })
  }, [memos, view])

  const expandedId = view.mode === 'edit' || view.mode === 'follow' ? view.id : null

  const scrollToCard = (id: string) => {
    window.setTimeout(() => {
      document.getElementById(`card-${id}`)?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'nearest',
      })
    }, 90)
  }

  const openCard = (id: string) => {
    if (expandedId === id) {
      setView({ mode: 'idle' })
      return
    }
    setView({ mode: 'edit', id })
    scrollToCard(id)
  }

  const run = async (action: () => Promise<void>, fallback: string) => {
    try {
      await action()
      return true
    } catch {
      notify(fallback)
      return false
    }
  }

  const createTask = async (draft: TaskDraft) => {
    try {
      const created = await onCreate(draft)
      setView({ mode: 'idle' })
      scrollToCard(created.id)
    } catch {
      notify('落笔未成，卷宗未能写入本机。')
    }
  }

  const updateTask = async (id: string, draft: TaskDraft) => {
    const ok = await run(() => onUpdate(id, draft), '改记未成，卷宗未能更新。')
    if (ok) setView({ mode: 'idle' })
  }

  const followUp = async (anchorId: string, draft: TaskDraft) => {
    try {
      const created = await onAddFollowUp(anchorId, draft)
      setView({ mode: 'edit', id: created.id })
      scrollToCard(created.id)
    } catch {
      notify('添笔未成，卷宗未能更新。')
    }
  }

  const eraseNow = async () => {
    if (!confirmErase || erasing) return
    setErasing(true)
    const ok = await run(() => onErase(confirmErase.id), '抹去未成，卷宗未能更新。')
    setErasing(false)
    if (ok) {
      setConfirmErase(null)
      setView({ mode: 'idle' })
    }
  }

  const startDrag = (event: PointerEvent<HTMLButtonElement>, chain: Chain, memo: Memo) => {
    if (memo.done) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    dragDone.current = false
    setDrag({
      chainId: chain.id,
      id: memo.id,
      order: chain.tasks.filter((task) => !task.done).map((task) => task.id),
    })
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current
    if (!current) return
    const deck = document.querySelector<HTMLElement>(
      `.stack[data-chain="${CSS.escape(current.chainId)}"] .stack__deck`,
    )
    if (!deck) return
    const cards = Array.from(deck.querySelectorAll<HTMLElement>('.card[data-open="true"]'))
    const others = cards.filter((card) => card.dataset.id !== current.id)
    const pointerY = event.clientY
    let insertion = 0
    for (const card of others) {
      const rect = card.getBoundingClientRect()
      if (pointerY > rect.top + rect.height / 2) insertion += 1
    }
    const without = current.order.filter((id) => id !== current.id)
    const next = [...without.slice(0, insertion), current.id, ...without.slice(insertion)]
    if (next.join('|') !== current.order.join('|')) {
      setDrag({ ...current, order: next })
    }
  }

  const endDrag = () => {
    const current = dragRef.current
    if (!current || dragDone.current) return
    dragDone.current = true
    setDrag(null)
    const chain = chains.find((item) => item.id === current.chainId)
    if (!chain) return
    const before = chain.tasks.filter((task) => !task.done).map((task) => task.id)
    if (before.join('|') === current.order.join('|')) return
    void run(() => onReorder(current.chainId, current.order), '顺序未成，卷宗未能更新。')
  }

  const cancelDrag = () => {
    dragDone.current = true
    setDrag(null)
  }

  const moveByKeyboard = (memo: Memo, direction: -1 | 1) => {
    void run(() => onMove(memo.id, direction), '顺序未成，卷宗未能更新。')
  }

  return (
    <main className="studio" aria-labelledby="studio-title">
      <header className="studio__head">
        <p className="studio__kicker">藏 锋 · 编 辑</p>
        <h2 className="studio__title" id="studio-title">
          编排
        </h2>
        <p className="studio__note">
          点开一张卡片，可改类别、标题与细则；按住右侧把手，只可调换同一脉络里的先后。已了之事不可逆。
        </p>
      </header>

      <div className="studio__bar">
        <button
          type="button"
          className={`studio__new${chooserOpen ? ' is-open' : ''}`}
          aria-expanded={chooserOpen}
          onClick={() => {
            const next = !chooserOpen
            setChooserOpen(next)
            if (!next && view.mode === 'new') setView({ mode: 'idle' })
          }}
        >
          <span className="studio__new-plus" aria-hidden="true">
            <i />
            <i />
          </span>
          新建任务
        </button>

        <div className="studio__sort" role="group" aria-label="任务排序">
          {SORTS.map((sort) => (
            <button
              key={sort.value}
              type="button"
              className={`studio__sort-button${sortMode === sort.value ? ' is-active' : ''}`}
              aria-pressed={sortMode === sort.value}
              title={sort.hint}
              onClick={() => setSortMode(sort.value)}
            >
              {sort.label}
            </button>
          ))}
        </div>
      </div>

      <p className="studio__sort-note">
        {SORTS.find((sort) => sort.value === sortMode)?.hint}
      </p>

      {chooserOpen ? (
        <div className="kind-picker" role="group" aria-label="选择任务类别">
          <p className="kind-picker__hint">先择其类</p>
          <div className="kind-picker__row">
            {MEMO_ICONS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="kind-choice"
                aria-label={`新建${categoryLabel(kind)}`}
                onClick={() => {
                  setChooserOpen(false)
                  setView({ mode: 'new', kind })
                  window.setTimeout(() => {
                    document.getElementById('new-task-title')?.scrollIntoView({
                      behavior: reducedMotion ? 'auto' : 'smooth',
                      block: 'center',
                    })
                  }, 80)
                }}
              >
                <MemoMark icon={kind} size={30} />
                <span className="kind-choice__label">{categoryLabel(kind)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {view.mode === 'new' ? (
        <section className="studio__new-sheet" aria-labelledby="new-task-title">
          <header className="studio__new-head">
            <div>
              <p className="studio__new-kicker">新 记 · {categoryLabel(view.kind)}</p>
              <h3 className="studio__new-title" id="new-task-title">
                写一件{categoryLabel(view.kind)}
              </h3>
            </div>
            <button
              type="button"
              className="studio__new-close"
              onClick={() => setView({ mode: 'idle' })}
              aria-label="收起新建"
            >
              罢
            </button>
          </header>
          <TaskForm
            key={`new-${view.kind}`}
            mode="create"
            category={view.kind}
            submitLabel="记下"
            onSubmit={createTask}
            onCancel={() => setView({ mode: 'idle' })}
          />
        </section>
      ) : null}

      {chains.length === 0 ? (
        <p className="studio__empty">卷中尚无脉络。先新建一事。</p>
      ) : (
        <ol className="stacks">
          {chains.map((chain) => {
            const openTasks = chain.tasks.filter((task) => !task.done)
            const doneTasks = chain.tasks.filter((task) => task.done)
            const isDragging = drag?.chainId === chain.id
            const order = isDragging
              ? drag.order
              : openTasks.map((task) => task.id)
            const tasks = [
              ...doneTasks,
              ...order.map((id) => byId.get(id)).filter((memo): memo is Memo => !!memo),
            ]
            const chainExpanded = expandedId
              ? chain.tasks.some((task) => task.id === expandedId)
              : false
            const openIndex = (memo: Memo) => openTasks.findIndex((task) => task.id === memo.id)

            return (
              <li className="stack" key={chain.id} data-chain={chain.id}>
                <div className="stack__head">
                  <MemoMark icon={chain.category} size={18} />
                  <span className="stack__label">{categoryLabel(chain.category)}</span>
                  <span className="stack__count">共 {chain.tasks.length} 事</span>
                  <span className={`stack__now${chain.head ? '' : ' is-ended'}`}>
                    {chain.head ? '进行中' : '已尽'}
                  </span>
                </div>

                <div
                  className={`stack__deck${chainExpanded ? ' is-open' : ''}${
                    isDragging ? ' is-dragging' : ''
                  }`}
                >
                  {tasks.map((memo, index) => {
                    const expanded = expandedId === memo.id
                    const isHead = chain.head?.id === memo.id
                    const indexInOpen = openIndex(memo)
                    const canMoveUp = !memo.done && indexInOpen > 0
                    const canMoveDown =
                      !memo.done && indexInOpen >= 0 && indexInOpen < openTasks.length - 1

                    return (
                      <article
                        key={memo.id}
                        id={`card-${memo.id}`}
                        className={[
                          'card',
                          memo.done ? 'is-done' : '',
                          isHead ? 'is-current' : '',
                          expanded ? 'is-editing' : '',
                          drag?.id === memo.id ? 'is-dragging' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        data-id={memo.id}
                        data-open={memo.done ? undefined : 'true'}
                        style={{ '--i': index } as CSSProperties}
                      >
                        <div className="card__top">
                          <span className="card__step" aria-hidden="true">
                            {stepLabel(index + 1)}
                          </span>
                          <button
                            type="button"
                            className="card__open"
                            aria-expanded={expanded}
                            aria-controls={expanded ? `card-edit-${memo.id}` : undefined}
                            onClick={() => openCard(memo.id)}
                          >
                            <span className="card__title">{memo.title}</span>
                            <span className="card__state">
                              {memo.done ? '已了' : isHead ? '当前' : '后续'}
                            </span>
                          </button>
                          {memo.done ? (
                            <span className="card__drag card__drag--done" aria-hidden="true" />
                          ) : (
                            <button
                              type="button"
                              className="card__drag"
                              aria-label={`拖动排序：${memo.title}`}
                              onPointerDown={(event) => startDrag(event, chain, memo)}
                              onPointerMove={moveDrag}
                              onPointerUp={endDrag}
                              onPointerCancel={cancelDrag}
                              onLostPointerCapture={endDrag}
                              onKeyDown={(event) => {
                                if (event.key === 'ArrowUp') {
                                  event.preventDefault()
                                  if (canMoveUp) moveByKeyboard(memo, -1)
                                } else if (event.key === 'ArrowDown') {
                                  event.preventDefault()
                                  if (canMoveDown) moveByKeyboard(memo, 1)
                                }
                              }}
                            >
                              {GRIP}
                            </button>
                          )}
                        </div>

                        <p className="card__content">{memo.content}</p>

                        {expanded ? (
                          <div className="card__editor" id={`card-edit-${memo.id}`}>
                            <div className="card__editor-head">
                              <div>
                                <p className="card__editor-kicker">
                                  {categoryLabel(chain.category)} · {stepLabel(index + 1)} · 共{' '}
                                  {chain.tasks.length} 事
                                </p>
                                <h3 className="card__editor-title">
                                  {memo.done ? '已了之事' : '改记'}
                                </h3>
                              </div>
                              <button
                                type="button"
                                className="card__editor-close"
                                onClick={() => setView({ mode: 'idle' })}
                                aria-label="收起编辑"
                              >
                                罢
                              </button>
                            </div>

                            <TaskForm
                              key={`edit-${memo.id}`}
                              mode="edit"
                              category={chain.category}
                              initial={memo}
                              showCategory
                              submitLabel="保存"
                              onSubmit={(draft) => updateTask(memo.id, draft)}
                              onCancel={() => setView({ mode: 'idle' })}
                            />

                            <div className="card__tools">
                              <div className="card__tools-group">
                                <span className="card__order">
                                  {memo.done
                                    ? `第 ${index + 1} 事 · 已了`
                                    : `第 ${indexInOpen + 1} 事 / 共 ${openTasks.length} 事`}
                                </span>
                                {!memo.done ? (
                                  <>
                                    <button
                                      type="button"
                                      className="task-tool"
                                      onClick={() => moveByKeyboard(memo, -1)}
                                      disabled={!canMoveUp}
                                    >
                                      前移
                                    </button>
                                    <button
                                      type="button"
                                      className="task-tool"
                                      onClick={() => moveByKeyboard(memo, 1)}
                                      disabled={!canMoveDown}
                                    >
                                      后移
                                    </button>
                                  </>
                                ) : null}
                              </div>
                              <div className="card__tools-group">
                                {!memo.done ? (
                                  <button
                                    type="button"
                                    className="task-tool"
                                    onClick={() => {
                                      setView({ mode: 'follow', id: memo.id })
                                      window.setTimeout(() => {
                                        document
                                          .querySelector<HTMLInputElement>(
                                            `#card-${memo.id} .card__follow .task-form__input--title`,
                                          )
                                          ?.focus({ preventScroll: false })
                                      }, 60)
                                    }}
                                  >
                                    添加后续任务
                                  </button>
                                ) : null}
                                {!memo.done ? (
                                  <button
                                    type="button"
                                    className="task-tool task-tool--danger"
                                    onClick={() => setConfirmErase(memo)}
                                  >
                                    抹去
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            {memo.done ? (
                              <p className="card__sealed-note">
                                已了之事不可撤销，也不可抹去；此处只可修字。
                              </p>
                            ) : null}

                            {view.mode === 'follow' && view.id === memo.id ? (
                              <div className="card__follow">
                                <p className="card__follow-title">
                                  在《{memo.title}》之后添一笔
                                </p>
                                <TaskForm
                                  mode="follow"
                                  category={chain.category}
                                  submitLabel="记下"
                                  onSubmit={(draft) => followUp(memo.id, draft)}
                                  onCancel={() => setView({ mode: 'edit', id: memo.id })}
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {confirmErase ? (
        <ConfirmDialog
          seal="抹"
          title="抹去此事？"
          note="此笔将从卷宗中消失，不可复得。"
          confirmLabel="抹去"
          cancelLabel="留下"
          busy={erasing}
          onCancel={() => {
            if (!erasing) setConfirmErase(null)
          }}
          onConfirm={() => void eraseNow()}
        />
      ) : null}
    </main>
  )
}
