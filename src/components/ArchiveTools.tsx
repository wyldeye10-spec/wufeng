import { useRef, useState, type ChangeEvent } from 'react'
import { useBodyLock } from '../hooks/useEnvironment'
import {
  ArchiveError,
  MAX_ARCHIVE_BYTES,
  archiveFileName,
  buildArchive,
  parseArchive,
  summarizeImport,
  type ImportSummary,
} from '../lib/archive'
import { sortMemos, type Memo } from '../lib/store'
import { ConfirmDialog } from './ConfirmDialog'

interface ArchiveToolsProps {
  memos: Memo[]
  onImport: (memos: Memo[]) => Promise<void>
  onNotify: (message: string) => void
}

interface ImportPreview {
  summary: ImportSummary
}

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file, 'utf-8')
  })
}

function describeImport(summary: ImportSummary): string {
  const parts = [`新增 ${summary.added} 条`]
  if (summary.updated > 0) parts.push(`覆盖 ${summary.updated} 条同号旧记`)
  if (summary.unchanged > 0) parts.push(`${summary.unchanged} 条不变`)
  return `备份共 ${summary.total} 条：${parts.join('，')}。未在备份中的现有记录会保留。`
}

export function ArchiveTools({ memos, onImport, onNotify }: ArchiveToolsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  useBodyLock(preview !== null)

  const exportData = () => {
    try {
      const archive = buildArchive(sortMemos(memos))
      const blob = new Blob([JSON.stringify(archive, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = archiveFileName()
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
      onNotify(memos.length > 0 ? `已导出 ${memos.length} 条记录。` : '卷宗尚空，已导出空白备份。')
    } catch {
      onNotify('导出未成，浏览器未能生成文件。')
    }
  }

  const chooseImport = () => {
    if (reading || importing) return
    inputRef.current?.click()
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setReading(true)
    try {
      if (file.size > MAX_ARCHIVE_BYTES) {
        throw new ArchiveError('备份文件超过 8 MB，未导入。')
      }
      const parsed = parseArchive(await readText(file))
      if (parsed.memos.length === 0) {
        onNotify('这卷备份没有记录。')
        return
      }

      const summary = summarizeImport(memos, parsed.memos)
      if (summary.changed.length === 0) {
        onNotify('这卷备份与当前卷宗一致，无需并入。')
        return
      }
      setPreview({ summary })
    } catch (error) {
      const message = error instanceof ArchiveError ? error.message : '文件无法读取。'
      onNotify(`导入失败：${message}`)
    } finally {
      setReading(false)
    }
  }

  const confirmImport = async () => {
    if (!preview || importing) return
    const summary = preview.summary
    setImporting(true)
    try {
      await onImport(summary.changed)
      const parts = [`新增 ${summary.added}`, `覆盖 ${summary.updated}`]
      if (summary.unchanged > 0) parts.push(`${summary.unchanged} 条不变`)
      onNotify(`已并入 ${summary.total} 条：${parts.join('，')}。`)
      setPreview(null)
    } catch {
      onNotify('并入未成，卷宗未能更新。')
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="archive" aria-labelledby="archive-label">
      <p className="archive__label" id="archive-label">
        卷 宗 维 护
      </p>
      <div className="archive__actions">
        <button type="button" className="archive__action" onClick={exportData}>
          <span className="archive__seal" aria-hidden="true">
            封
          </span>
          <span>导出卷宗</span>
        </button>
        <button
          type="button"
          className="archive__action"
          onClick={chooseImport}
          disabled={reading}
          aria-busy={reading}
        >
          <span className="archive__seal" aria-hidden="true">
            启
          </span>
          <span>{reading ? '启卷…' : '导入卷宗'}</span>
        </button>
      </div>
      <p className="archive__hint">导出为 JSON 备份；导入只并入，不删除现有记录。</p>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".json,application/json"
        aria-label="选择卷宗备份文件"
        tabIndex={-1}
        onChange={(event) => void handleFile(event)}
      />

      {preview ? (
        <ConfirmDialog
          seal="启"
          title="并入这卷备份？"
          note={describeImport(preview.summary)}
          confirmLabel="并入"
          cancelLabel="再想想"
          busy={importing}
          onCancel={() => {
            if (!importing) setPreview(null)
          }}
          onConfirm={() => void confirmImport()}
        />
      ) : null}
    </section>
  )
}
