import { app } from 'electron'
import { join } from 'path'
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

export interface HistoryEntry {
  url: string
  title: string
  favicon?: string
  visitedAt: number
}

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const HISTORY_FILE = join(DATA_DIR, 'history.jsonl')
const MAX_ENTRIES = 10000

export class HistoryStore {
  private entries: HistoryEntry[] = []

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      if (existsSync(HISTORY_FILE)) {
        const lines = readFileSync(HISTORY_FILE, 'utf-8').trim().split('\n').filter(Boolean)
        this.entries = lines.map(l => {
          try { return JSON.parse(l) }
          catch { return null }
        }).filter(Boolean) as HistoryEntry[]
      }
    } catch {
      this.entries = []
    }
  }

  private persist(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      const content = this.entries.map(e => JSON.stringify(e)).join('\n') + '\n'
      writeFileSync(HISTORY_FILE, content)
    } catch (err) {
      console.error('Failed to write history:', err)
    }
  }

  addVisit(url: string, title: string, favicon?: string): void {
    // Skip empty URLs and internal pages
    if (!url || url === 'about:blank' || url.startsWith('data:')) return

    const entry: HistoryEntry = { url, title: title || url, favicon, visitedAt: Date.now() }
    this.entries.push(entry)

    // Compact if too large
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES)
      this.persist()
    } else {
      // Append only
      try {
        if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
        appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n')
      } catch {
        this.persist()
      }
    }
  }

  getRecent(limit: number = 200): HistoryEntry[] {
    return this.entries.slice(-limit).reverse()
  }

  search(query: string, limit: number = 50): HistoryEntry[] {
    const lq = query.toLowerCase()
    const results: HistoryEntry[] = []
    // Search from newest to oldest
    for (let i = this.entries.length - 1; i >= 0 && results.length < limit; i--) {
      const e = this.entries[i]
      if (e.title.toLowerCase().includes(lq) || e.url.toLowerCase().includes(lq)) {
        results.push(e)
      }
    }
    return results
  }

  clear(): void {
    this.entries = []
    try { writeFileSync(HISTORY_FILE, '') } catch { /* ignore */ }
  }

  deleteUrl(url: string): void {
    this.entries = this.entries.filter(e => e.url !== url)
    this.persist()
  }
}
