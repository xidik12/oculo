import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import crypto from 'crypto'
import { IPC } from '../../shared/ipc-channels'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const WATCHERS_FILE = join(DATA_DIR, 'watchers.json')

export interface WatcherEntry {
  id: string
  url: string
  interval: number  // ms
  lastHash: string
  lastChecked: number
  active: boolean
}

export class WatcherStore {
  private watchers = new Map<string, WatcherEntry>()
  private timers = new Map<string, NodeJS.Timeout>()
  private mainWindow: BrowserWindow

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
    this.load()
    // Restart active watchers
    for (const [, entry] of this.watchers) {
      if (entry.active) this.startPolling(entry)
    }
  }

  list(): WatcherEntry[] {
    return Array.from(this.watchers.values())
  }

  add(url: string, intervalMs = 60_000): WatcherEntry {
    const id = `watch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const entry: WatcherEntry = {
      id,
      url,
      interval: Math.max(10_000, intervalMs),  // minimum 10s
      lastHash: '',
      lastChecked: 0,
      active: true
    }
    this.watchers.set(id, entry)
    this.save()
    this.startPolling(entry)
    return entry
  }

  remove(id: string): boolean {
    const timer = this.timers.get(id)
    if (timer) clearInterval(timer)
    this.timers.delete(id)
    const deleted = this.watchers.delete(id)
    if (deleted) this.save()
    return deleted
  }

  private startPolling(entry: WatcherEntry): void {
    // Initial check
    this.checkForChanges(entry).catch(() => {})

    const timer = setInterval(() => {
      this.checkForChanges(entry).catch(() => {})
    }, entry.interval)

    this.timers.set(entry.id, timer)
  }

  private async checkForChanges(entry: WatcherEntry): Promise<void> {
    let hidden: BrowserWindow | null = null
    try {
      // Create a hidden window to fetch the page
      hidden = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      })

      await hidden.loadURL(entry.url)
      // Wait a bit for JS rendering
      await new Promise(r => setTimeout(r, 2000))

      const text = await hidden.webContents.executeJavaScript('document.body.innerText')

      const hash = crypto.createHash('sha256').update(text).digest('hex')
      entry.lastChecked = Date.now()

      if (entry.lastHash && hash !== entry.lastHash) {
        // Content changed — notify renderer
        if (!this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IPC.WATCHER_CHANGED, { id: entry.id, url: entry.url })
        }
      }

      entry.lastHash = hash
      this.save()
    } catch {
      // Fetch failed — skip this check
    } finally {
      if (hidden && !hidden.isDestroyed()) hidden.destroy()
    }
  }

  stopAll(): void {
    for (const [, timer] of this.timers) clearInterval(timer)
    this.timers.clear()
  }

  private load(): void {
    try {
      if (existsSync(WATCHERS_FILE)) {
        const entries: WatcherEntry[] = JSON.parse(readFileSync(WATCHERS_FILE, 'utf-8'))
        for (const entry of entries) {
          this.watchers.set(entry.id, entry)
        }
      }
    } catch { /* corrupted file, start fresh */ }
  }

  private save(): void {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      const entries = Array.from(this.watchers.values())
      writeFileSync(WATCHERS_FILE, JSON.stringify(entries, null, 2))
    } catch { /* write failed */ }
  }
}
