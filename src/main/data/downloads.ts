import { BrowserWindow, session, shell } from 'electron'

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

  constructor(window: BrowserWindow) {
    this.window = window
    this.setupDownloadHandler()
  }

  private setupDownloadHandler(): void {
    session.defaultSession.on('will-download', (_event, item) => {
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
        dl.electronItem = undefined // Release reference
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
}
