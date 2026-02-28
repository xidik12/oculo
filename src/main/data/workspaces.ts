import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { Workspace } from '../../shared/types'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const WORKSPACES_FILE = join(DATA_DIR, 'workspaces.json')

export class WorkspaceStore {
  private workspaces: Workspace[] = []

  constructor() {
    this.load()
    // Ensure default workspace exists
    if (this.workspaces.length === 0) {
      this.workspaces.push({
        id: 'default',
        name: 'Default',
        color: '#60a5fa',
        tabIds: [],
        tabUrls: [],
        aiHistory: [],
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      })
      this.save()
    }
  }

  private load(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      if (existsSync(WORKSPACES_FILE)) {
        const data = readFileSync(WORKSPACES_FILE, 'utf-8')
        this.workspaces = JSON.parse(data)
      }
    } catch {
      this.workspaces = []
    }
  }

  private save(): void {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(WORKSPACES_FILE, JSON.stringify(this.workspaces, null, 2))
    } catch (err) {
      console.error('Failed to save workspaces:', err)
    }
  }

  list(): Workspace[] {
    return [...this.workspaces]
  }

  create(name: string, color: string): Workspace {
    const workspace: Workspace = {
      id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      color,
      tabIds: [],
      tabUrls: [],
      aiHistory: [],
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    }
    this.workspaces.push(workspace)
    this.save()
    return workspace
  }

  get(id: string): Workspace | undefined {
    return this.workspaces.find(w => w.id === id)
  }

  update(id: string, updates: Partial<Omit<Workspace, 'id' | 'createdAt'>>): Workspace | null {
    const idx = this.workspaces.findIndex(w => w.id === id)
    if (idx === -1) return null
    this.workspaces[idx] = { ...this.workspaces[idx], ...updates }
    this.save()
    return this.workspaces[idx]
  }

  saveState(id: string, tabIds: string[], tabUrls: string[], aiHistory: Array<{ role: string; content: unknown }>): void {
    const idx = this.workspaces.findIndex(w => w.id === id)
    if (idx === -1) return
    this.workspaces[idx].tabIds = tabIds
    this.workspaces[idx].tabUrls = tabUrls
    this.workspaces[idx].aiHistory = aiHistory
    this.workspaces[idx].lastActiveAt = Date.now()
    this.save()
  }

  delete(id: string): boolean {
    if (id === 'default') return false // Can't delete default
    const len = this.workspaces.length
    this.workspaces = this.workspaces.filter(w => w.id !== id)
    if (this.workspaces.length !== len) {
      this.save()
      return true
    }
    return false
  }
}
