import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { AuditEntry } from '../../shared/types'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const LOG_FILE = join(DATA_DIR, 'audit.jsonl')

export class AuditLog {
  private nextId = 1

  constructor() {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
      // Count existing entries to set nextId
      if (existsSync(LOG_FILE)) {
        const lines = readFileSync(LOG_FILE, 'utf-8').split('\n').filter(l => l.trim())
        this.nextId = lines.length + 1
      }
    } catch (err) {
      console.error('Failed to initialize audit log:', err)
    }
  }

  log(
    action: string,
    target: string,
    result: 'success' | 'failed' | 'blocked' | 'confirmed' | 'denied',
    details?: string,
    toolName?: string
  ): void {
    try {
      const entry: AuditEntry = {
        id: this.nextId++,
        timestamp: Date.now(),
        action,
        target: target.substring(0, 500),
        result,
        details: details?.substring(0, 1000),
        toolName
      }
      appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n')
    } catch (err) {
      console.error('Failed to log audit entry:', err)
    }
  }

  query(limit: number = 100, offset: number = 0): AuditEntry[] {
    try {
      if (!existsSync(LOG_FILE)) return []
      const lines = readFileSync(LOG_FILE, 'utf-8').split('\n').filter(l => l.trim())
      // Reverse for newest-first, then apply offset and limit
      const reversed = lines.reverse()
      return reversed.slice(offset, offset + limit).map(line => JSON.parse(line))
    } catch {
      return []
    }
  }

  cleanup(retentionDays: number = 30): number {
    try {
      if (!existsSync(LOG_FILE)) return 0
      const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000)
      const lines = readFileSync(LOG_FILE, 'utf-8').split('\n').filter(l => l.trim())
      const kept = lines.filter(line => {
        try { return JSON.parse(line).timestamp >= cutoff } catch { return false }
      })
      const removed = lines.length - kept.length
      writeFileSync(LOG_FILE, kept.join('\n') + (kept.length ? '\n' : ''))
      return removed
    } catch {
      return 0
    }
  }

  close(): void {
    // No-op: file-based log doesn't need cleanup
  }
}
