import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { SessionMemoryEntry } from '../../shared/types'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const MEMORY_FILE = join(DATA_DIR, 'session-memory.json')
const MAX_ENTRIES = 100

export class SessionMemoryStore {
  private entries: SessionMemoryEntry[] = []

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      if (existsSync(MEMORY_FILE)) {
        const data = readFileSync(MEMORY_FILE, 'utf-8')
        this.entries = JSON.parse(data)
      }
    } catch {
      this.entries = []
    }
  }

  private save(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(MEMORY_FILE, JSON.stringify(this.entries, null, 2))
    } catch (err) {
      console.error('Failed to save session memory:', err)
    }
  }

  list(): SessionMemoryEntry[] {
    return [...this.entries]
  }

  add(summary: string, urls: string[], tags?: string[]): SessionMemoryEntry {
    const entry: SessionMemoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      summary,
      urls,
      timestamp: Date.now(),
      tags
    }
    this.entries.push(entry)
    // Auto-prune oldest
    while (this.entries.length > MAX_ENTRIES) {
      this.entries.shift()
    }
    this.save()
    return entry
  }

  clear(): void {
    this.entries = []
    this.save()
  }

  /** Format entries for inclusion in AI system prompt */
  toPromptSection(): string {
    if (this.entries.length === 0) return ''
    const recent = this.entries.slice(-10)
    const lines = recent.map(e => {
      const ago = Math.round((Date.now() - e.timestamp) / 60000)
      const timeStr = ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`
      return `  - [${timeStr}] ${e.summary} (${e.urls.slice(0, 2).join(', ')})`
    })
    return '\n\nSESSION MEMORY (recent browsing context):\n' + lines.join('\n')
  }
}
