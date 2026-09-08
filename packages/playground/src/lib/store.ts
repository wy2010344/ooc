/**
 * 记事本数据层：笔记全部存在 IndexedDB，键是去小写后的笔记名。
 * 像真实文件系统那样管理：list / get / upsert / rename / remove。
 */
import type { NotebookEntry } from './engine.js'

const DB_NAME = 'ooc-notebook'
const DB_VERSION = 2
const STORE = 'notes'
const STORE_HISTORY = 'history'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' })
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        // 历史记录：主键 = noteName|时间戳，按 noteName 检索
        const h = db.createObjectStore(STORE_HISTORY, {
          keyPath: 'id',
        })
        h.createIndex('noteName', 'noteName')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('无法打开 IndexedDB'))
  })
  return dbPromise
}

function tx<T>(
  mode: IDBTransactionMode,
  table: string,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(table, mode)
        const req = run(t.objectStore(table))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'))
      }),
  )
}

/** 执行历史记录 */
export interface RunHistoryItem {
  id: string
  noteName: string
  at: string
  output: string
  error: string | null
  durationMs: number
  diagnostics: number
}

export interface NoteRow {
  name: string
  source: string
  updatedAt: string
}

export const store = {
  /** 列出全部笔记，按名排序 */
  async list(): Promise<NotebookEntry[]> {
    const rows = await tx<NoteRow[]>('readonly', STORE, (s) => s.getAll())
    return (rows ?? [])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, source }) => ({ name, source }))
  },

  async get(name: string): Promise<NoteRow | undefined> {
    const row = await tx<NoteRow | undefined>('readonly', STORE, (s) =>
      s.get(name.toLowerCase()),
    )
    return row ?? undefined
  },

  /** 新增或覆盖笔记（同名著为准，编辑保存场景） */
  async upsert(name: string, source: string): Promise<NoteRow> {
    const row: NoteRow = {
      name: name.toLowerCase(),
      source,
      updatedAt: new Date().toISOString(),
    }
    await tx('readwrite', STORE, (s) => s.put(row))
    return row
  },

  /** 重命名：目标不存在时成功，返回 true */
  async rename(fromName: string, toName: string): Promise<boolean> {
    const targetKey = toName.toLowerCase()
    if (await this.get(targetKey)) return false
    const row = await this.get(fromName.toLowerCase())
    if (!row) return false
    await tx('readwrite', STORE, (s) => {
      s.delete(fromName.toLowerCase())
      return s.put({ ...row, name: targetKey })
    })
    return true
  },

  async remove(name: string): Promise<void> {
    await tx('readwrite', STORE, (s) => s.delete(name.toLowerCase()))
  },

  /* ---------- 执行历史 ---------- */

  async logRun(item: Omit<RunHistoryItem, 'id'>): Promise<void> {
    const row: RunHistoryItem = {
      ...item,
      noteName: item.noteName.toLowerCase(),
      id: `${item.noteName.toLowerCase()}|${item.at}`,
    }
    await tx('readwrite', STORE_HISTORY, (s) => s.put(row))
  },

  /** 某条笔记最近 N 次执行历史（新→旧） */
  async historyFor(name: string, limit = 20): Promise<RunHistoryItem[]> {
    const all = await tx<RunHistoryItem[]>(
      'readonly',
      STORE_HISTORY,
      (s) => s.getAll(),
    )
    const key = name.toLowerCase()
    return (all ?? [])
      .filter((h) => h.noteName === key)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
  },
}