import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

export interface Bookmark {
  id: string
  title: string
  url: string
  favicon?: string
  parentId: string | null
  index: number
  createdAt: number
  type: 'bookmark' | 'folder' | 'separator'
}

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const BOOKMARKS_FILE = join(DATA_DIR, 'bookmarks.json')

export class BookmarkStore {
  private bookmarks: Bookmark[] = []

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      if (existsSync(BOOKMARKS_FILE)) {
        const data = readFileSync(BOOKMARKS_FILE, 'utf-8')
        this.bookmarks = JSON.parse(data)
      }
    } catch {
      this.bookmarks = []
    }
  }

  private save(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(BOOKMARKS_FILE, JSON.stringify(this.bookmarks, null, 2))
    } catch (err) {
      console.error('Failed to save bookmarks:', err)
    }
  }

  list(): Bookmark[] {
    return [...this.bookmarks]
  }

  add(title: string, url: string, favicon?: string, parentId: string | null = null): Bookmark {
    const bookmark: Bookmark = {
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      url,
      favicon,
      parentId,
      index: this.bookmarks.filter(b => b.parentId === parentId).length,
      createdAt: Date.now(),
      type: 'bookmark'
    }
    this.bookmarks.push(bookmark)
    this.save()
    return bookmark
  }

  update(id: string, updates: Partial<Pick<Bookmark, 'title' | 'url' | 'favicon' | 'parentId' | 'index'>>): Bookmark | null {
    const idx = this.bookmarks.findIndex(b => b.id === id)
    if (idx === -1) return null
    this.bookmarks[idx] = { ...this.bookmarks[idx], ...updates }
    this.save()
    return this.bookmarks[idx]
  }

  delete(id: string): boolean {
    const len = this.bookmarks.length
    this.bookmarks = this.bookmarks.filter(b => b.id !== id)
    if (this.bookmarks.length !== len) {
      this.save()
      return true
    }
    return false
  }

  findByUrl(url: string): Bookmark | undefined {
    return this.bookmarks.find(b => b.type === 'bookmark' && b.url === url)
  }

  search(query: string): Bookmark[] {
    const lq = query.toLowerCase()
    return this.bookmarks.filter(b =>
      b.type === 'bookmark' && (
        b.title.toLowerCase().includes(lq) ||
        b.url.toLowerCase().includes(lq)
      )
    )
  }
}
