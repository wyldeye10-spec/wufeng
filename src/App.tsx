import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AddSeal } from './components/AddSeal'
import { ArchiveTools } from './components/ArchiveTools'
import { ConfirmDialog } from './components/ConfirmDialog'
import { EmptyState } from './components/EmptyState'
import { Masthead } from './components/Masthead'
import { MemoRow } from './components/MemoRow'
import { SectionBanner } from './components/SectionBanner'
import { Studio } from './components/Studio'
import { Toast } from './components/Toast'
import type { TaskDraft } from './components/TaskForm'
import { usePrefersReducedMotion, useBodyLock } from './hooks/useEnvironment'
import { useJournal } from './hooks/useJournal'
import {
  buildChains,
  CATEGORY_ORDER,
  categoryLabel,
  nextTask,
  sortChains,
  stepInfo,
  stepLabel,
} from './lib/chain'
import { createMemo, type Memo } from './lib/store'
import { clampChars } from './lib/text'

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })

function focusMemoControl(id: string, selector: string): void {
  window.setTimeout(() => {
    const row = Array.from(document.querySelectorAll<HTMLElement>('.memo')).find(
      (element) => element.dataset.id === id,
    )
    row?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true })
  }, 80)
}

interface RowSnapshot {
  top: number
  left: number
  state: string
  chapterTop: number
}

interface LayoutSnapshot {
  chapters: Map<string, number>
  rows: Map<string, RowSnapshot>
}

function measureLayout(): LayoutSnapshot {
  const chapters = new Map<string, number>()
  document.querySelectorAll<HTMLElement>('.chapter').forEach((chapter) => {
    const kind = chapter.classList.contains('chapter--done') ? 'done' : 'open'
    chapters.set(kind, chapter.getBoundingClientRect().top)
  })

  const rows = new Map<string, RowSnapshot>()
  document.querySelectorAll<HTMLElement>('.memo').forEach((row) => {
    const id = row.dataset.id
    const state = row.dataset.state
    const chapter = row.closest<HTMLElement>('.chapter')
    if (!id || !state || !chapter) return
    const rect = row.getBoundingClientRect()
    rows.set(id, {
      top: rect.top,
      left: rect.left,
      state,
      chapterTop: chapter.getBoundingClientRect().top,
    })
  })

  return { chapters, rows }
}

export default function App() {
  const journal = useJournal()
  const reducedMotion = usePrefersReducedMotion()
  const [studioOpen, setStudioOpen] = useState(false)
  const [seedNew, setSeedNew] = useState(false)
  const [completing, setCompleting] = useState<Memo | null>(null)
  const [completingBusy, setCompletingBusy] = useState(false)
  const [sinkingId, setSinkingId] = useState<string | null>(null)
  const [risingId, setRisingId] = useState<string | null>(null)
  const [arrivingDoneId, setArrivingDoneId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const toastId = useRef(0)
  const noticeShown = useRef(false)
  const flipSnapshot = useRef<LayoutSnapshot | null>(null)
  useBodyLock(completing !== null)

  const notify = (message: string) => {
    toastId.current += 1
    setToast({ id: toastId.current, message })
  }

  const { ready, mode, loadError, items, write, writeMany, erase, insert, merge, replace, drop } =
    journal

  const chains = useMemo(() => buildChains(items), [items])
  const openChains = useMemo(
    () => sortChains(chains.filter((chain) => chain.head), 'category'),
    [chains],
  )
  const openGroups = useMemo(
    () =>
      CATEGORY_ORDER.map((icon) => ({
        icon,
        chains: openChains.filter((chain) => chain.category === icon),
      })).filter((group) => group.chains.length > 0),
    [openChains],
  )
  const done = useMemo(
    () =>
      items
        .filter((memo) => memo.done)
        .sort(
          (left, right) =>
            (right.completedAt ?? 0) - (left.completedAt ?? 0) ||
            right.createdAt - left.createdAt ||
            left.id.localeCompare(right.id),
        ),
    [items],
  )

  useEffect(() => {
    if (!ready || loadError || noticeShown.current) return
    noticeShown.current = true
    if (mode === 'local') {
      notify('本机数据库不可用，已启用兼容存储。')
    } else if (mode === 'memory') {
      notify('本机存储不可用，本次记录关闭页面即失。')
    }
  }, [ready, mode, loadError])

  useEffect(() => {
    if (!arrivingDoneId) return
    const timer = window.setTimeout(() => {
      setArrivingDoneId((current) => (current === arrivingDoneId ? null : current))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [arrivingDoneId])

  useEffect(() => {
    if (!risingId) return
    const timer = window.setTimeout(() => {
      setRisingId((current) => (current === risingId ? null : current))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [risingId])

  const snapshot = () => {
    flipSnapshot.current = measureLayout()
  }

  useLayoutEffect(() => {
    const previous = flipSnapshot.current
    flipSnapshot.current = null
    if (!previous || reducedMotion) return

    // 章节整体位移（多半是「已了之事」随卷宗高度变化而上移/下移）。
    const currentChapters = new Map<string, number>()
    document.querySelectorAll<HTMLElement>('.chapter').forEach((chapter) => {
      const kind = chapter.classList.contains('chapter--done') ? 'done' : 'open'
      currentChapters.set(kind, chapter.getBoundingClientRect().top)
    })

    previous.chapters.forEach((beforeTop, kind) => {
      const afterTop = currentChapters.get(kind)
      if (afterTop === undefined) return
      const element = document.querySelector<HTMLElement>(
        kind === 'done' ? '.chapter--done' : '.chapter--open',
      )
      const dy = beforeTop - afterTop
      if (!element || Math.abs(dy) < 1) return
      element.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
        duration: 420,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      })
    })

    // 章内条目只补间「相对章节」的位移，避免与章节位移叠加、互相压盖。
    document.querySelectorAll<HTMLElement>('.memo').forEach((row) => {
      const id = row.dataset.id
      const state = row.dataset.state
      if (!id || !state) return
      const before = previous.rows.get(id)
      if (!before || before.state !== state) return
      const afterTop = currentChapters.get(state)
      if (afterTop === undefined) return
      const rect = row.getBoundingClientRect()
      const dy = before.top - before.chapterTop - (rect.top - afterTop)
      const dx = before.left - rect.left
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      row.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: 'translate(0, 0)' },
        ],
        {
          duration: 420,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        },
      )
    })
  }, [items, reducedMotion])

  const createTask = async (draft: TaskDraft) => {
    const memo = createMemo(
      clampChars(draft.title, 8).trim(),
      clampChars(draft.content, 50).trim(),
      draft.icon,
    )
    await write(memo)
    snapshot()
    insert(memo)
    setAnnouncement(`《${memo.title}》已记下。`)
    return memo
  }

  const updateTask = async (id: string, draft: TaskDraft) => {
    const current = items.find((item) => item.id === id)
    if (!current) throw new Error('此条已不在卷中')
    const now = Date.now()
    const next: Memo = {
      ...current,
      title: clampChars(draft.title, 8).trim(),
      content: clampChars(draft.content, 50).trim(),
      icon: draft.icon,
      updatedAt: now,
    }
    const chainMemos = items.filter((memo) => memo.chainId === current.chainId)
    const updates =
      draft.icon === current.icon
        ? [next]
        : chainMemos.map((memo) => {
            if (memo.id === current.id) return next
            return { ...memo, icon: draft.icon, updatedAt: now }
          })
    await writeMany(updates)
    merge(updates)
    setAnnouncement(`《${next.title}》已改记。`)
  }

  const addFollowUp = async (anchorId: string, draft: TaskDraft) => {
    const anchor = items.find((memo) => memo.id === anchorId)
    if (!anchor) throw new Error('承接之事已不在卷中')
    if (anchor.done) throw new Error('已了之事不可再续')
    const now = Date.now()
    const siblings = items.filter((memo) => memo.chainId === anchor.chainId)
    const shifted = siblings
      .filter((memo) => memo.order > anchor.order)
      .map((memo) => ({ ...memo, order: memo.order + 1, updatedAt: now }))
    const memo = createMemo(
      clampChars(draft.title, 8).trim(),
      clampChars(draft.content, 50).trim(),
      anchor.icon,
      anchor.chainId,
      anchor.order + 1,
    )
    await writeMany([...shifted, memo])
    merge([...shifted, memo])
    setAnnouncement(`后续《${memo.title}》已添。`)
    return memo
  }

  const reorderChain = async (chainId: string, order: string[]) => {
    const chainMemos = items.filter((memo) => memo.chainId === chainId)
    const finished = chainMemos
      .filter((memo) => memo.done)
      .sort((left, right) => left.order - right.order)
    const openById = new Map(
      chainMemos.filter((memo) => !memo.done).map((memo) => [memo.id, memo]),
    )
    const ordered = order
      .map((id) => openById.get(id))
      .filter((memo): memo is Memo => memo !== undefined)
    if (ordered.length !== openById.size) throw new Error('脉络不完整')

    const now = Date.now()
    const updates: Memo[] = []
    ;[...finished, ...ordered].forEach((memo, index) => {
      if (memo.order !== index) updates.push({ ...memo, order: index, updatedAt: now })
    })
    if (updates.length === 0) return
    await writeMany(updates)
    merge(updates)
  }

  const moveTask = async (id: string, direction: -1 | 1) => {
    const current = items.find((memo) => memo.id === id)
    if (!current || current.done) return
    const chain = chains.find((item) => item.id === current.chainId)
    if (!chain) return
    const openTasks = chain.tasks.filter((memo) => !memo.done)
    const index = openTasks.findIndex((memo) => memo.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= openTasks.length) return
    const ids = openTasks.map((memo) => memo.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    await reorderChain(chain.id, ids)
  }

  const eraseTask = async (id: string) => {
    const target = items.find((memo) => memo.id === id)
    if (!target) return
    if (target.done) throw new Error('已了之事不可抹去')
    await erase(id)
    snapshot()
    drop(id)
    notify(`已抹去《${target.title}》。`)
    setAnnouncement(`已抹去《${target.title}》。`)
  }

  const requestComplete = (memo: Memo) => {
    if (memo.done) return
    setCompleting(memo)
  }

  const confirmComplete = async () => {
    const memo = completing
    if (!memo || completingBusy) return
    const chain = chains.find((item) => item.id === memo.chainId)
    const successor = chain ? nextTask(chain, memo) : null
    const next: Memo = {
      ...memo,
      done: true,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    }

    setCompletingBusy(true)
    try {
      await write(next)
    } catch {
      notify('落印未成，此事未能写入本机卷宗。')
      setCompletingBusy(false)
      return
    }
    setCompletingBusy(false)
    setCompleting(null)

    if (reducedMotion) {
      snapshot()
      replace(next)
      setArrivingDoneId(memo.id)
    } else {
      // 先在原位下沉，再从同一位置把下一事浮起。
      setSinkingId(memo.id)
      await wait(520)
      snapshot()
      replace(next)
      setSinkingId(null)
      setArrivingDoneId(memo.id)
      if (successor) setRisingId(successor.id)
    }

    setAnnouncement(
      successor
        ? `《${memo.title}》已了，《${successor.title}》接续。`
        : `《${memo.title}》已了，这一脉走完了。`,
    )
    window.setTimeout(() => {
      if (successor) focusMemoControl(successor.id, '.memo__stamp')
      else document.querySelector<HTMLElement>('.add-seal')?.focus({ preventScroll: true })
    }, 120)
  }

  const importMemos = async (incoming: Memo[]) => {
    await writeMany(incoming)
    snapshot()
    merge(incoming)
    setAnnouncement(`已并入 ${incoming.length} 条记录。`)
  }

  return (
    <div className="app">
      <div className="app__atmosphere" aria-hidden="true">
        <span className="app__ghost">锋</span>
        <span className="app__thread app__thread--one" />
        <span className="app__thread app__thread--two" />
      </div>

      <div className="page">
        <Masthead
          studioOpen={studioOpen}
          onToggleStudio={() => {
            setStudioOpen((open) => !open)
            setSeedNew(false)
          }}
        />

        {studioOpen && ready && !loadError ? (
          <Studio
            memos={items}
            reducedMotion={reducedMotion}
            seedNew={seedNew}
            notify={notify}
            onCreate={createTask}
            onUpdate={updateTask}
            onAddFollowUp={addFollowUp}
            onReorder={reorderChain}
            onMove={moveTask}
            onErase={eraseTask}
          />
        ) : (
          <main className="journal">
            {!ready ? (
              <div className="loading" role="status">
                <span className="loading__mark" aria-hidden="true" />
                <p>卷宗启封中</p>
              </div>
            ) : loadError ? (
              <div className="load-error" role="alert">
                <p className="load-error__title">卷宗未能启封。</p>
                <p className="load-error__note">{loadError}</p>
                <button type="button" className="quiet-button" onClick={journal.retry}>
                  再启一次
                </button>
              </div>
            ) : (
              <>
                {mode === 'memory' ? (
                  <p className="storage-warning" role="alert">
                    本机存储不可用，此卷仅存于本次开启期间。
                  </p>
                ) : null}

                <section className="chapter chapter--open" aria-labelledby="section-open">
                  <SectionBanner kind="open" />
                  <div className="chapter__body">
                    {openGroups.length > 0 ? (
                      <div className="ledger">
                        {openGroups.map((group) => (
                          <section
                            className="group"
                            key={group.icon}
                            aria-label={`${categoryLabel(group.icon)}类`}
                          >
                            <p className="group__label">
                              <span className="group__name">{categoryLabel(group.icon)}</span>
                              <span className="group__rule" aria-hidden="true" />
                            </p>
                            {group.chains.map((chain) => {
                              const head = chain.head
                              if (!head) return null
                              const { step, total } = stepInfo(chain, head)
                              return (
                                <MemoRow
                                  key={head.id}
                                  memo={head}
                                  sinking={sinkingId === head.id}
                                  rising={risingId === head.id}
                                  arriving={false}
                                  step={total > 1 ? stepLabel(step) : undefined}
                                  onComplete={requestComplete}
                                />
                              )
                            })}
                          </section>
                        ))}
                      </div>
                    ) : (
                      <EmptyState kind="open" />
                    )}
                  </div>
                </section>

                <section className="chapter chapter--done" aria-labelledby="section-done">
                  <SectionBanner kind="done" />
                  <div className="chapter__body">
                    {done.length > 0 ? (
                      <div className="ledger">
                        {done.map((memo) => (
                          <MemoRow
                            key={memo.id}
                            memo={memo}
                            sinking={false}
                            rising={false}
                            arriving={arrivingDoneId === memo.id}
                            onComplete={requestComplete}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState kind="done" />
                    )}
                  </div>
                </section>
              </>
            )}
          </main>
        )}

        <footer className="colophon">
          {ready && !loadError ? (
            <ArchiveTools memos={items} onImport={importMemos} onNotify={notify} />
          ) : null}
          <span className="colophon__rule" aria-hidden="true" />
          <p className="colophon__verse">事有始终，念有归处。</p>
          <p className="colophon__sign" aria-hidden="true">
            藏 锋
          </p>
        </footer>
      </div>

      {ready && !loadError && !studioOpen ? (
        <AddSeal
          onClick={() => {
            setSeedNew(true)
            setStudioOpen(true)
          }}
        />
      ) : null}

      {completing ? (
        <ConfirmDialog
          seal="了"
          title="确定吗？"
          note="确定后将不可撤销。"
          confirmLabel="已了"
          cancelLabel="取消"
          busy={completingBusy}
          onCancel={() => {
            if (!completingBusy) setCompleting(null)
          }}
          onConfirm={() => void confirmComplete()}
        />
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
