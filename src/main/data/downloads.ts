import { app, BrowserWindow, session, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join, dirname, extname, basename } from 'path'
import type { AgentController } from '../ai/agent'
import { IPC } from '../../shared/ipc-channels'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const DOWNLOADS_FILE = join(DATA_DIR, 'downloads.json')

export interface DownloadItem {
  id: string
  filename: string
  url: string
  savePath: string
  totalBytes: number
  receivedBytes: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startTime: number
}

export class DownloadManager {
  private downloads = new Map<string, { item: DownloadItem; electronItem?: Electron.DownloadItem }>()
  private window: BrowserWindow
  private agent: AgentController | null = null

  constructor(window: BrowserWindow) {
    this.window = window
    this.load()
    this.setupDownloadHandler()
  }

  /** Set agent controller for AI auto-rename (v0.3.0) */
  setAgent(agent: AgentController): void {
    this.agent = agent
  }

  private setupDownloadHandler(): void {
    const sessions = [
      session.defaultSession,
      session.fromPartition('persist:oculo')
    ]
    for (const ses of sessions) {
      this.attachToSession(ses)
    }
    this.trackedPartitions = new Set(['default', 'persist:oculo'])
  }

  private trackedPartitions = new Set<string>()

  trackSession(partition: string): void {
    if (this.trackedPartitions.has(partition)) return
    this.trackedPartitions.add(partition)
    this.attachToSession(session.fromPartition(partition))
  }

  private attachToSession(ses: Electron.Session): void {
    ses.on('will-download', (_event, item) => {
      const id = `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const dlItem: DownloadItem = {
        id,
        filename: item.getFilename(),
        url: item.getURL(),
        savePath: item.getSavePath() || '',
        totalBytes: item.getTotalBytes(),
        receivedBytes: 0,
        state: 'progressing',
        startTime: Date.now()
      }

      this.downloads.set(id, { item: dlItem, electronItem: item })

      item.on('updated', (_ev, state) => {
        const dl = this.downloads.get(id)
        if (!dl) return
        dl.item.receivedBytes = item.getReceivedBytes()
        dl.item.totalBytes = item.getTotalBytes()
        dl.item.savePath = item.getSavePath()
        dl.item.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      })

      item.once('done', (_ev, state) => {
        const dl = this.downloads.get(id)
        if (!dl) return
        dl.item.receivedBytes = item.getReceivedBytes()
        dl.item.savePath = item.getSavePath()
        dl.item.state = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
        dl.electronItem = undefined
        this.save()

        // AI auto-rename on successful download (v0.3.0)
        if (state === 'completed' && this.agent && dl.item.savePath) {
          this.tryAutoRename(dl.item).catch(() => {})
        }
      })
    })
  }

  list(): DownloadItem[] {
    return Array.from(this.downloads.values())
      .map(d => d.item)
      .sort((a, b) => b.startTime - a.startTime)
  }

  cancel(id: string): void {
    const dl = this.downloads.get(id)
    if (dl?.electronItem) {
      dl.electronItem.cancel()
    }
  }

  openFile(savePath: string): void {
    shell.openPath(savePath)
  }

  showInFolder(savePath: string): void {
    shell.showItemInFolder(savePath)
  }

  // === AI Auto-Rename (v0.3.0) ===

  private async tryAutoRename(dlItem: DownloadItem): Promise<void> {
    if (!this.agent) return
    const originalName = dlItem.filename
    const ext = extname(originalName)
    const prompt = `Suggest a clean, descriptive filename for a downloaded file. Original name: "${originalName}", URL: "${dlItem.url}". Reply with ONLY the filename including extension. Keep it short (<60 chars). If the name is already clean, reply with the exact same name.`
    const suggested = await this.agent.quickComplete(prompt, 60)
    if (!suggested || suggested.length < 3 || suggested.length > 80) return

    // Sanitize: remove path separators, control chars
    const clean = suggested.replace(/[/\\:*?"<>|\x00-\x1f]/g, '').trim()
    if (!clean || clean === originalName) return

    // Ensure same extension
    const suggestedExt = extname(clean)
    const finalName = suggestedExt ? clean : clean + ext

    // Rename on disk
    const dir = dirname(dlItem.savePath)
    const newPath = join(dir, finalName)
    if (existsSync(newPath)) return // don't overwrite existing files

    try {
      renameSync(dlItem.savePath, newPath)
      dlItem.filename = finalName
      dlItem.savePath = newPath
      this.save()
      // Notify renderer
      this.window.webContents.send(IPC.DOWNLOAD_UPDATED, dlItem)
    } catch { /* rename failed, keep original */ }
  }

  // === Persistence ===

  private load(): void {
    try {
      if (existsSync(DOWNLOADS_FILE)) {
        const items: DownloadItem[] = JSON.parse(readFileSync(DOWNLOADS_FILE, 'utf-8'))
        for (const item of items) {
          // Mark any previously-progressing downloads as interrupted (app was closed)
          if (item.state === 'progressing') item.state = 'interrupted'
          this.downloads.set(item.id, { item })
        }
      }
    } catch { /* corrupted file, start fresh */ }
  }

  private save(): void {
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      const items = Array.from(this.downloads.values()).map(d => d.item)
      writeFileSync(DOWNLOADS_FILE, JSON.stringify(items, null, 2))
    } catch { /* write failed */ }
  }
}
