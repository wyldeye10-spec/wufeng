import { countChars, isBlank } from './text'
import type { Memo } from './store'

/**
 * 卷宗备份格式：
 * {
 *   app: "无锋",
 *   format: "wufeng-journal",
 *   version: 1,
 *   exportedAt: "2026-11-08T...",
 *   memos: Memo[]
 * }
 *
 * 导入同时接受旧式裸数组，方便从更早的脚本或手工备份恢复。
 */
export const ARCHIVE_FORMAT = 'wufeng-journal'
export const ARCHIVE_VERSION = 1
export const MAX_IMPORT_MEMOS = 5000
export const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024

export interface JournalArchive {
  app: '无锋'
  format: typeof ARCHIVE_FORMAT
  version: typeof ARCHIVE_VERSION
  exportedAt: string
  memos: Memo[]
}

export interface ParsedArchive {
  memos: Memo[]
  exportedAt: string | null
}

export interface ImportSummary {
  total: number
  added: number
  updated: number
  unchanged: number
  changed: Memo[]
}

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchiveError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function readMemo(raw: unknown, index: number): Memo {
  if (!isRecord(raw)) {
    throw new ArchiveError(`第 ${index + 1} 条记录格式不正确。`)
  }

  const id = raw.id
  if (typeof id !== 'string' || !id || id.length > 200) {
    throw new ArchiveError(`第 ${index + 1} 条记录缺少有效编号。`)
  }

  const title = raw.title
  const content = raw.content
  if (typeof title !== 'string' || title.length > 1000) {
    throw new ArchiveError(`第 ${index + 1} 条记录的标题无法识别。`)
  }
  if (typeof content !== 'string' || content.length > 1000) {
    throw new ArchiveError(`第 ${index + 1} 条记录的内容无法识别。`)
  }
  if (isBlank(title)) {
    throw new ArchiveError(`第 ${index + 1} 条记录的标题为空。`)
  }
  if (isBlank(content)) {
    throw new ArchiveError(`第 ${index + 1} 条记录的内容为空。`)
  }
  if (countChars(title) > 8) {
    throw new ArchiveError(`第 ${index + 1} 条记录的标题超过 8 字。`)
  }
  if (countChars(content) > 50) {
    throw new ArchiveError(`第 ${index + 1} 条记录的内容超过 50 字。`)
  }

  if (typeof raw.done !== 'boolean') {
    throw new ArchiveError(`第 ${index + 1} 条记录缺少完成状态。`)
  }
  if (!isFiniteTime(raw.createdAt)) {
    throw new ArchiveError(`第 ${index + 1} 条记录缺少有效时间。`)
  }

  const done = raw.done
  const completedAt =
    done && isFiniteTime(raw.completedAt) ? raw.completedAt : done ? raw.createdAt : null

  return {
    id,
    title,
    content,
    done,
    createdAt: raw.createdAt,
    completedAt,
  }
}

function readMemos(raw: unknown): Memo[] {
  if (!Array.isArray(raw)) {
    throw new ArchiveError('备份里没有记录清单。')
  }
  if (raw.length > MAX_IMPORT_MEMOS) {
    throw new ArchiveError(`备份超过 ${MAX_IMPORT_MEMOS} 条上限，未导入。`)
  }

  const seen = new Set<string>()
  return raw.map((item, index) => {
    const memo = readMemo(item, index)
    if (seen.has(memo.id)) {
      throw new ArchiveError(`第 ${index + 1} 条记录与前面的记录编号重复。`)
    }
    seen.add(memo.id)
    return memo
  })
}

export function parseArchive(text: string): ParsedArchive {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new ArchiveError('文件不是有效的 JSON。')
  }

  if (Array.isArray(parsed)) {
    return { memos: readMemos(parsed), exportedAt: null }
  }

  if (!isRecord(parsed) || parsed.format !== ARCHIVE_FORMAT) {
    throw new ArchiveError('这不是无锋的卷宗备份。')
  }
  if (parsed.version !== ARCHIVE_VERSION) {
    throw new ArchiveError('备份格式版本不支持。')
  }

  return {
    memos: readMemos(parsed.memos),
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
  }
}

export function buildArchive(memos: Memo[]): JournalArchive {
  return {
    app: '无锋',
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    memos: memos.map((memo) => ({
      id: memo.id,
      title: memo.title,
      content: memo.content,
      done: memo.done,
      createdAt: memo.createdAt,
      completedAt: memo.completedAt,
    })),
  }
}

export function archiveFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `wufeng-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(
    date.getDate(),
  )}-${pad(date.getHours())}${pad(date.getMinutes())}.json`
}

function sameMemo(left: Memo, right: Memo): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.content === right.content &&
    left.done === right.done &&
    left.createdAt === right.createdAt &&
    left.completedAt === right.completedAt
  )
}

export function summarizeImport(current: Memo[], incoming: Memo[]): ImportSummary {
  const byId = new Map(current.map((memo) => [memo.id, memo]))
  const changed: Memo[] = []
  let added = 0
  let updated = 0
  let unchanged = 0

  for (const memo of incoming) {
    const existing = byId.get(memo.id)
    if (!existing) {
      added += 1
      changed.push(memo)
    } else if (!sameMemo(existing, memo)) {
      updated += 1
      changed.push(memo)
    } else {
      unchanged += 1
    }
  }

  return { total: incoming.length, added, updated, unchanged, changed }
}
