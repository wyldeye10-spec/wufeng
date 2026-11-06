import { useCallback, useEffect, useRef, useState } from 'react'
import {
  JournalStore,
  StorageError,
  sortMemos,
  type Memo,
  type StorageMode,
} from '../lib/store'

function describe(error: unknown): string {
  if (error instanceof StorageError) return error.message
  if (error instanceof Error) return error.message
  return '本机卷库出现未知错误'
}

export interface Journal {
  items: Memo[]
  ready: boolean
  mode: StorageMode
  loadError: string | null
  write: (memo: Memo) => Promise<void>
  erase: (id: string) => Promise<void>
  insert: (memo: Memo) => void
  replace: (memo: Memo) => void
  drop: (id: string) => void
  retry: () => void
}

export function useJournal(): Journal {
  const [items, setItems] = useState<Memo[]>([])
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<StorageMode>('idb')
  const [loadError, setLoadError] = useState<string | null>(null)
  const storeRef = useRef<JournalStore | null>(null)

  const load = useCallback(async () => {
    setReady(false)
    setLoadError(null)
    try {
      const store = await JournalStore.open()
      storeRef.current = store
      const rows = await store.readAll()
      setItems(sortMemos(rows))
      setMode(store.mode)
    } catch (error) {
      storeRef.current = null
      setLoadError(describe(error))
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const write = useCallback(async (memo: Memo) => {
    const store = storeRef.current
    if (!store) throw new StorageError('卷库尚未启封')
    await store.write(memo)
  }, [])

  const erase = useCallback(async (id: string) => {
    const store = storeRef.current
    if (!store) throw new StorageError('卷库尚未启封')
    await store.erase(id)
  }, [])

  const insert = useCallback((memo: Memo) => {
    setItems((prev) => sortMemos([...prev.filter((item) => item.id !== memo.id), memo]))
  }, [])

  const replace = useCallback((memo: Memo) => {
    setItems((prev) => {
      if (!prev.some((item) => item.id === memo.id)) return prev
      return sortMemos(prev.map((item) => (item.id === memo.id ? memo : item)))
    })
  }, [])

  const drop = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  return {
    items,
    ready,
    mode,
    loadError,
    write,
    erase,
    insert,
    replace,
    drop,
    retry: () => {
      void load()
    },
  }
}
