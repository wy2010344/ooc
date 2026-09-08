/**
 * 记事本数据层：笔记与执行历史存 IndexedDB。
 * 用 idb（极小 Promise 封装，少自造轮子）：openDB 管迁移，get/put/getAll 管事务。
 * 键统一存小写后的笔记名，像真实文件系统那样管理。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { NotebookEntry } from './engine.js'

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

interface NoteRow {
  name: string
  source: string
  updatedAt: string
}

interface NotebookDatabase extends DBSchema {
  notes: { key: string; value: NoteRow }
  history: {
    key: string
    value: RunHistoryItem
    indexes: { 'noteName': string }
  }
}

let dbPromise: Promise<IDBPDatabase<NotebookDatabase>> | null = null

function getDb(): Promise<IDBPDatabase<NotebookDatabase>> {
  // 惰性单例：只在首次访问时打开（Node 下安全）
  if (!dbPromise) {
    dbPromise = openDB<NotebookDatabase>('ooc-notebook', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'name' })
        }
        if (!db.objectStoreNames.contains('history')) {
          const h = db.createObjectStore('history', { keyPath: 'id' })
          h.createIndex('noteName', 'noteName')
        }
      },
    })
  }
  return dbPromise
}

export const store = {
  /** 列出全部笔记，按名排序 */
  async list(): Promise<NotebookEntry[]> {
    const db = await getDb()
    const rows = await db.getAll('notes')
    return rows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, source }) => ({ name, source }))
  },

  async get(name: string): Promise<NoteRow | undefined> {
    const db = await getDb()
    return (await db.get('notes', name.toLowerCase())) ?? undefined
  },

  /** 新增或覆盖笔记（同名著为准，编辑自动保存场景） */
  async upsert(name: string, source: string): Promise<NoteRow> {
    const row: NoteRow = {
      name: name.toLowerCase(),
      source,
      updatedAt: new Date().toISOString(),
    }
    const db = await getDb()
    await db.put('notes', row)
    return row
  },

  /** 重命名：目标不存在时成功，返回 true */
  async rename(fromName: string, toName: string): Promise<boolean> {
    const targetKey = toName.toLowerCase()
    const db = await getDb()
    if (await db.get('notes', targetKey)) return false
    const row = await db.get('notes', fromName.toLowerCase())
    if (!row) return false
    await db.put('notes', { ...row, name: targetKey })
    await db.delete('notes', fromName.toLowerCase())
    return true
  },

  async remove(name: string): Promise<void> {
    const db = await getDb()
    await db.delete('notes', name.toLowerCase())
  },

  /* ---------- 执行历史 ---------- */

  async logRun(item: Omit<RunHistoryItem, 'id'>): Promise<void> {
    const row: RunHistoryItem = {
      ...item,
      noteName: item.noteName.toLowerCase(),
      id: `${item.noteName.toLowerCase()}|${item.at}`,
    }
    const db = await getDb()
    await db.put('history', row)
  },

  /** 某条笔记最近 N 次执行历史（新→旧） */
  async historyFor(name: string, limit = 20): Promise<RunHistoryItem[]> {
    const db = await getDb()
    const all = await db.getAllFromIndex(
      'history',
      'noteName',
      name.toLowerCase(),
    )
    return all
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
  },
}