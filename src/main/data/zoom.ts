import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const ZOOM_FILE = join(DATA_DIR, 'zoom-levels.json')

export class ZoomStore {
  private levels: Record<string, number> = {}

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      if (existsSync(ZOOM_FILE)) {
        this.levels = JSON.parse(readFileSync(ZOOM_FILE, 'utf-8'))
      }
    } catch {
      this.levels = {}
    }
  }

  private save(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(ZOOM_FILE, JSON.stringify(this.levels, null, 2))
    } catch { /* ignore */ }
  }

  getZoom(domain: string): number {
    return this.levels[domain] ?? 1.0
  }

  setZoom(domain: string, level: number): void {
    if (level === 1.0) {
      delete this.levels[domain]
    } else {
      this.levels[domain] = Math.max(0.25, Math.min(5.0, level))
    }
    this.save()
  }

  resetZoom(domain: string): void {
    delete this.levels[domain]
    this.save()
  }

  listAll(): Record<string, number> {
    return { ...this.levels }
  }
}
