import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { PinnedApp } from '../../shared/types'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const PINNED_APPS_FILE = join(DATA_DIR, 'pinned-apps.json')

export class PinnedAppStore {
  private apps: PinnedApp[] = []

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      if (existsSync(PINNED_APPS_FILE)) {
        const data = readFileSync(PINNED_APPS_FILE, 'utf-8')
        this.apps = JSON.parse(data)
      }
    } catch {
      this.apps = []
    }
  }

  private save(): void {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(PINNED_APPS_FILE, JSON.stringify(this.apps, null, 2))
    } catch (err) {
      console.error('Failed to save pinned apps:', err)
    }
  }

  list(): PinnedApp[] {
    return [...this.apps].sort((a, b) => a.position - b.position)
  }

  add(url: string, title: string, favicon?: string, width: number = 320): PinnedApp {
    // Don't add duplicates
    const existing = this.apps.find(a => a.url === url)
    if (existing) return existing

    const position = this.apps.length > 0
      ? Math.max(...this.apps.map(a => a.position)) + 1
      : 0

    const pinnedApp: PinnedApp = {
      id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      title,
      favicon,
      width,
      position
    }
    this.apps.push(pinnedApp)
    this.save()
    return pinnedApp
  }

  remove(id: string): boolean {
    const len = this.apps.length
    this.apps = this.apps.filter(a => a.id !== id)
    if (this.apps.length !== len) {
      this.save()
      return true
    }
    return false
  }

  update(id: string, updates: Partial<Pick<PinnedApp, 'title' | 'favicon' | 'width' | 'position'>>): PinnedApp | null {
    const idx = this.apps.findIndex(a => a.id === id)
    if (idx === -1) return null
    this.apps[idx] = { ...this.apps[idx], ...updates }
    this.save()
    return this.apps[idx]
  }

  /** Bulk save — replaces entire list (used by renderer for reordering) */
  saveAll(apps: PinnedApp[]): void {
    this.apps = apps
    this.save()
  }

  get(id: string): PinnedApp | undefined {
    return this.apps.find(a => a.id === id)
  }
}
