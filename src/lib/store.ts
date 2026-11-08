export interface Memo {
  id: string
  title: string
  content: string
  done: boolean
  createdAt: number
  completedAt: number | null
}

export type StorageMode = 'idb' | 'local' | 'memory'

const DB_NAME = 'wufeng-juanzong'
const DB_VERSION = 1
const STORE_NAME = 'memos'
const LOCAL_KEY = 'wufeng.memos.v1'
const OPEN_TIMEOUT_MS = 2500

export class StorageError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'StorageError'
    this.cause = cause
  }
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // ignore
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function createMemo(title: string, content: string): Memo {
  return {
    id: newId(),
    title,
    content,
    done: false,
    createdAt: Date.now(),
    completedAt: null,
  }
}

/** 宽容读取旧数据；字段不合法则丢弃该条，绝不静默篡改正文。 */
function normalizeMemo(raw: unknown): Memo | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || !value.id) return null
  if (typeof value.title !== 'string' || typeof value.content !== 'string') return null
  const createdAt =
    typeof value.createdAt === 'number' && Number.isFinite(value.createdAt)
      ? value.createdAt
      : Date.now()
  const done = value.done === true
  const completedAt =
    done && typeof value.completedAt === 'number' && Number.isFinite(value.completedAt)
      ? value.completedAt
      : done
        ? createdAt
        : null

  return {
    id: value.id,
    title: value.title,
    content: value.content,
    done,
    createdAt,
    completedAt,
  }
}

export function sortMemos(list: Memo[]): Memo[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('此浏览器不支持 IndexedDB'))
      return
    }

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(new StorageError('无法开启本地卷库', error))
      return
    }

    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new StorageError('本地卷库开启超时'))
    }, OPEN_TIMEOUT_MS)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }

    request.onsuccess = () => {
      const db = request.result
      if (settled) {
        db.close()
        return
      }
      settled = true
      window.clearTimeout(timer)
      db.onversionchange = () => db.close()
      resolve(db)
    }

    request.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      reject(new StorageError('无法开启本地卷库', request.error))
    }

    request.onblocked = () => {
      // 另一个旧版本页面占着数据库；等它关闭或超时后退回兼容存储。
    }
  })
}

function canUseLocalStorage(): boolean {
  try {
    const probe = '__wufeng_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

/**
 * 三层存储：IndexedDB（首选）→ localStorage（兼容）→ 内存（仅本次会话）。
 * 所有写操作等待事务真正完成，避免“界面成功、数据丢失”。
 */
export class JournalStore {
  readonly mode: StorageMode
  private readonly db: IDBDatabase | null
  private memory: Memo[]

  private constructor(mode: StorageMode, db: IDBDatabase | null, memory: Memo[] = []) {
    this.mode = mode
    this.db = db
    this.memory = memory
  }

  static async open(): Promise<JournalStore> {
    try {
      const db = await openDatabase()
      return new JournalStore('idb', db)
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[wufeng] IndexedDB unavailable, falling back:', error)
      }
    }

    if (canUseLocalStorage()) {
      return new JournalStore('local', null)
    }

    return new JournalStore('memory', null)
  }

  async readAll(): Promise<Memo[]> {
    if (this.mode === 'idb' && this.db) {
      try {
        const tx = this.db.transaction(STORE_NAME, 'readonly')
        const rows = await requestToPromise(tx.objectStore(STORE_NAME).getAll())
        await transactionDone(tx)
        return rows.map(normalizeMemo).filter((memo): memo is Memo => memo !== null)
      } catch (error) {
        throw new StorageError('读取本地卷宗失败', error)
      }
    }

    if (this.mode === 'local') {
      let raw: string | null = null
      try {
        raw = window.localStorage.getItem(LOCAL_KEY)
      } catch (error) {
        throw new StorageError('读取兼容卷库失败', error)
      }
      if (!raw) return []
      try {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.map(normalizeMemo).filter((memo): memo is Memo => memo !== null)
      } catch (error) {
        throw new StorageError('兼容卷库数据损坏', error)
      }
    }

    return [...this.memory]
  }

  async write(memo: Memo): Promise<void> {
    if (this.mode === 'idb' && this.db) {
      try {
        const tx = this.db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).put(memo)
        await transactionDone(tx)
        return
      } catch (error) {
        throw new StorageError('写入本地卷宗失败', error)
      }
    }

    if (this.mode === 'local') {
      try {
        const raw = window.localStorage.getItem(LOCAL_KEY)
        const parsed: unknown = raw ? JSON.parse(raw) : []
        const rows = Array.isArray(parsed) ? parsed : []
        const next = rows.filter((row) => {
          return !(row && typeof row === 'object' && (row as Memo).id === memo.id)
        })
        next.push(memo)
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next))
        return
      } catch (error) {
        throw new StorageError('兼容卷库写入失败', error)
      }
    }

    this.memory = sortMemos([...this.memory.filter((item) => item.id !== memo.id), memo])
  }

  /** 批量写入：导入备份时一次事务落库，避免逐条写带来的半途状态。 */
  async writeMany(memos: Memo[]): Promise<void> {
    if (memos.length === 0) return

    if (this.mode === 'idb' && this.db) {
      try {
        const tx = this.db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        for (const memo of memos) store.put(memo)
        await transactionDone(tx)
        return
      } catch (error) {
        throw new StorageError('批量写入本地卷宗失败', error)
      }
    }

    if (this.mode === 'local') {
      try {
        const raw = window.localStorage.getItem(LOCAL_KEY)
        const parsed: unknown = raw ? JSON.parse(raw) : []
        const rows = Array.isArray(parsed) ? parsed : []
        const byId = new Map<string, unknown>()
        for (const row of rows) {
          if (row && typeof row === 'object' && typeof (row as Memo).id === 'string') {
            byId.set((row as Memo).id, row)
          }
        }
        for (const memo of memos) byId.set(memo.id, memo)
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify([...byId.values()]))
        return
      } catch (error) {
        throw new StorageError('批量写入兼容卷库失败', error)
      }
    }

    const byId = new Map(this.memory.map((memo) => [memo.id, memo]))
    for (const memo of memos) byId.set(memo.id, memo)
    this.memory = sortMemos([...byId.values()])
  }

  async erase(id: string): Promise<void> {
    if (this.mode === 'idb' && this.db) {
      try {
        const tx = this.db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).delete(id)
        await transactionDone(tx)
        return
      } catch (error) {
        throw new StorageError('从本地卷宗抹去失败', error)
      }
    }

    if (this.mode === 'local') {
      try {
        const raw = window.localStorage.getItem(LOCAL_KEY)
        const parsed: unknown = raw ? JSON.parse(raw) : []
        const rows = Array.isArray(parsed) ? parsed : []
        const next = rows.filter((row) => {
          return !(row && typeof row === 'object' && (row as Memo).id === id)
        })
        window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next))
        return
      } catch (error) {
        throw new StorageError('从兼容卷库抹去失败', error)
      }
    }

    this.memory = this.memory.filter((memo) => memo.id !== id)
  }
}
