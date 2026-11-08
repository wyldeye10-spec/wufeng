import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AddSeal } from './components/AddSeal'
import { ArchiveTools } from './components/ArchiveTools'
import { Composer } from './components/Composer'
import { EmptyState } from './components/EmptyState'
import { Masthead } from './components/Masthead'
import { MemoRow } from './components/MemoRow'
import { SectionBanner } from './components/SectionBanner'
import { Toast } from './components/Toast'
import { usePrefersReducedMotion } from './hooks/useEnvironment'
import { useJournal } from './hooks/useJournal'
import { createMemo, type Memo, type MemoIcon } from './lib/store'
import { clampChars } from './lib/text'

type EditorState = { mode: 'new' } | { mode: 'edit'; memo: Memo }

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })

function focusMemoControl(id: string, selector: string): void {
  window.setTimeout(() => {
    if (document.querySelector('.composer')) return
    const row = Array.from(document.querySelectorAll<HTMLElement>('.memo')).find(
      (element) => element.dataset.id === id,
    )
    row?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true })
  }, 60)
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
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const [erasingId, setErasingId] = useState<string | null>(null)
  const [leavingId, setLeavingId] = useState<string | null>(null)
  const [arrivingDoneId, setArrivingDoneId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const toastId = useRef(0)
  const noticeShown = useRef(false)
  const flipSnapshot = useRef<LayoutSnapshot | null>(null)

  const notify = (message: string) => {
    toastId.current += 1
    setToast({ id: toastId.current, message })
  }

  const { ready, mode, loadError, items, write, writeMany, erase, insert, merge, replace, drop } =
    journal

  const open = useMemo(() => items.filter((memo) => !memo.done), [items])
  const done = useMemo(() => items.filter((memo) => memo.done), [items])

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
    if (!enteringId) return
    const timer = window.setTimeout(() => {
      setEnteringId((current) => (current === enteringId ? null : current))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [enteringId])

  useEffect(() => {
    if (!enteringId) return
    const timer = window.setTimeout(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('.memo')).find(
        (element) => element.dataset.id === enteringId,
      )
      row?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
      })
      row?.querySelector<HTMLElement>('.memo__body')?.focus({ preventScroll: true })
    }, 140)
    return () => window.clearTimeout(timer)
  }, [enteringId, reducedMotion])

  useEffect(() => {
    if (!arrivingDoneId) return
    const timer = window.setTimeout(() => {
      setArrivingDoneId((current) => (current === arrivingDoneId ? null : current))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [arrivingDoneId])

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
    // 仅当条目重新分布时执行位移动画。
  }, [items, reducedMotion])

  useEffect(() => {
    if (!erasingId) return
    const timer = window.setTimeout(
      () => {
        snapshot()
        drop(erasingId)
        setErasingId(null)
        window.setTimeout(() => {
          document.querySelector<HTMLElement>('.add-seal')?.focus({ preventScroll: true })
        }, 60)
      },
      reducedMotion ? 0 : 300,
    )
    return () => window.clearTimeout(timer)
  }, [erasingId, drop, reducedMotion])

  const create = async (draft: { title: string; content: string; icon: MemoIcon }) => {
    const memo = createMemo(
      clampChars(draft.title, 8).trim(),
      clampChars(draft.content, 50).trim(),
      draft.icon,
    )
    await write(memo)
    setEditor(null)
    snapshot()
    insert(memo)
    setEnteringId(memo.id)
    setAnnouncement(`《${memo.title}》已记下。`)
  }

  const update = async (draft: { title: string; content: string; icon: MemoIcon }) => {
    if (!editor || editor.mode !== 'edit') return
    const current = items.find((item) => item.id === editor.memo.id) ?? editor.memo
    const next: Memo = {
      ...current,
      title: clampChars(draft.title, 8).trim(),
      content: clampChars(draft.content, 50).trim(),
      icon: draft.icon,
    }
    await write(next)
    setEditor(null)
    replace(next)
    setAnnouncement(`《${next.title}》已改记。`)
    focusMemoControl(next.id, '.memo__body')
  }

  const complete = async (memo: Memo) => {
    const next: Memo = { ...memo, done: true, completedAt: Date.now() }
    try {
      await write(next)
    } catch (error) {
      notify('落印未成，此事未能写入本机卷宗。')
      throw error
    }

    if (reducedMotion) {
      snapshot()
      replace(next)
    } else {
      // 先看朱印落定，再让未竟条目淡出；状态切换后再让已了条目淡入。
      await wait(560)
      setLeavingId(memo.id)
      await wait(320)
      snapshot()
      replace(next)
      setLeavingId(null)
      setArrivingDoneId(memo.id)
    }

    setAnnouncement(`《${memo.title}》已了。`)
    focusMemoControl(memo.id, '.memo__seal')
  }

  const undo = async (memo: Memo) => {
    const next: Memo = { ...memo, done: false, completedAt: null }
    try {
      await write(next)
    } catch (error) {
      notify('撤印未成，卷宗未能更新。')
      throw error
    }

    await wait(reducedMotion ? 0 : 260)
    snapshot()
    replace(next)
    setAnnouncement(`《${memo.title}》重归未竟。`)
    focusMemoControl(memo.id, '.memo__stamp')
  }

  const eraseCurrent = async (): Promise<Memo | null> => {
    if (!editor || editor.mode !== 'edit') return null
    const target = items.find((item) => item.id === editor.memo.id) ?? editor.memo

    try {
      await erase(target.id)
    } catch (error) {
      notify('抹去未成，卷宗未能更新。')
      throw error
    }
    return target
  }

  const finishErase = (target: Memo) => {
    setEditor(null)
    setErasingId(target.id)
    setAnnouncement(`已抹去《${target.title}》。`)
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
        <Masthead />

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
                  {open.length > 0 ? (
                    <div className="ledger">
                      {open.map((memo) => (
                        <MemoRow
                          key={memo.id}
                          memo={memo}
                          entering={enteringId === memo.id}
                          erasing={erasingId === memo.id}
                          leaving={leavingId === memo.id}
                          arriving={arrivingDoneId === memo.id}
                          onEdit={(item) => setEditor({ mode: 'edit', memo: item })}
                          onComplete={complete}
                          onUndo={undo}
                        />
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
                          entering={enteringId === memo.id}
                          erasing={erasingId === memo.id}
                          leaving={leavingId === memo.id}
                          arriving={arrivingDoneId === memo.id}
                          onEdit={(item) => setEditor({ mode: 'edit', memo: item })}
                          onComplete={complete}
                          onUndo={undo}
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

        <footer className="colophon">
          {ready && !loadError ? (
            <ArchiveTools memos={items} onImport={importMemos} onNotify={notify} />
          ) : null}
          <span className="colophon__rule" aria-hidden="true" />
          <p className="colophon__verse">事有始终，念有归处。</p>
          <p className="colophon__note">
            {mode === 'memory'
              ? '本机存储不可用；记录只存在于本次开启期间。'
              : mode === 'local'
                ? '此卷存于浏览器本地（兼容模式）。清除网站数据、卸载应用或设备损坏后，记录可能不可寻回。'
                : '此卷存于本机。清除网站数据、卸载应用或设备损坏后，记录可能不可寻回。'}
          </p>
          <p className="colophon__sign" aria-hidden="true">
            无 锋
          </p>
        </footer>
      </div>

      {ready && !loadError ? <AddSeal onClick={() => setEditor({ mode: 'new' })} /> : null}

      {editor ? (
        <Composer
          key={editor.mode === 'edit' ? editor.memo.id : 'new'}
          mode={editor.mode}
          memo={editor.mode === 'edit' ? editor.memo : undefined}
          onClose={() => setEditor(null)}
          onSubmit={editor.mode === 'new' ? create : update}
          onDelete={editor.mode === 'edit' ? eraseCurrent : undefined}
          onDeleteFinished={editor.mode === 'edit' ? finishErase : undefined}
          reducedMotion={reducedMotion}
        />
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
