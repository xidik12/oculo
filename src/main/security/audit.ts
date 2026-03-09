import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { AuditEntry } from '../../shared/types'

/**
 * AuditLog — tries SQLite (better-sqlite3) first, falls back to JSONL if native module unavailable.
 */
export class AuditLog {
  private db: any = null
  private jsonlPath: string
  private nextId = 1
  private usingSqlite = false

  constructor() {
    const dataDir = path.join(app.getPath('userData'), 'oculo-data')
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

    this.jsonlPath = path.join(dataDir, 'audit.jsonl')

    // Try SQLite first
    try {
      const Database = require('better-sqlite3')
      const dbPath = path.join(dataDir, 'audit.db')
      this.db = new Database(dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          action TEXT NOT NULL,
          target TEXT,
          result TEXT NOT NULL,
          details TEXT,
          toolName TEXT
        )
      `)
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)')
      this.usingSqlite = true
      this.migrateFromJsonl()
    } catch {
      // SQLite not available — use JSONL fallback
      console.log('[AuditLog] SQLite unavailable, using JSONL fallback')
      this.db = null
      // Load next ID from existing file
      try {
        if (fs.existsSync(this.jsonlPath)) {
          const lines = fs.readFileSync(this.jsonlPath, 'utf-8').trim().split('\n').filter(Boolean)
          if (lines.length > 0) {
            const last = JSON.parse(lines[lines.length - 1])
            this.nextId = (last.id || lines.length) + 1
          }
        }
      } catch { /* start fresh */ }
    }
  }

  private migrateFromJsonl(): void {
    if (!this.db || !this.usingSqlite) return
    if (!fs.existsSync(this.jsonlPath)) return

    try {
      const content = fs.readFileSync(this.jsonlPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)
      if (lines.length === 0) return

      const count = this.db.prepare('SELECT COUNT(*) as cnt FROM audit_log').get() as { cnt: number }
      if (count.cnt > 0) return

      const insert = this.db.prepare(
        'INSERT INTO audit_log (timestamp, action, target, result, details, toolName) VALUES (?, ?, ?, ?, ?, ?)'
      )
      const batch = this.db.transaction(() => {
        for (const line of lines) {
          try {
            const entry = JSON.parse(line)
            insert.run(
              entry.timestamp || Date.now(), entry.action || '',
              (entry.target || '').substring(0, 500), entry.result || 'success',
              (entry.details || '').substring(0, 1000), entry.toolName || null
            )
          } catch { /* skip */ }
        }
      })
      batch()
      fs.renameSync(this.jsonlPath, this.jsonlPath + '.migrated')
      console.log(`[AuditLog] Migrated ${lines.length} entries from JSONL to SQLite`)
    } catch (err) {
      console.error('[AuditLog] Migration failed:', err)
    }
  }

  log(action: string, target: string, result: AuditEntry['result'], details?: string, toolName?: string): void {
    const entry = {
      id: this.nextId++,
      timestamp: Date.now(),
      action,
      target: (target || '').substring(0, 500),
      result,
      details: details ? details.substring(0, 1000) : undefined,
      toolName: toolName || undefined
    }

    if (this.usingSqlite && this.db) {
      try {
        this.db.prepare(
          'INSERT INTO audit_log (timestamp, action, target, result, details, toolName) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(entry.timestamp, entry.action, entry.target, entry.result, entry.details || null, entry.toolName || null)
        return
      } catch (err) {
        console.error('[AuditLog] SQLite write failed, falling back:', err)
      }
    }

    // JSONL fallback
    try {
      fs.appendFileSync(this.jsonlPath, JSON.stringify(entry) + '\n')
    } catch (err) {
      console.error('[AuditLog] Write failed:', err)
    }
  }

  query(limit = 100, offset = 0): AuditEntry[] {
    if (this.usingSqlite && this.db) {
      try {
        return this.db.prepare(
          'SELECT * FROM audit_log ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?'
        ).all(limit, offset) as AuditEntry[]
      } catch { /* fall through */ }
    }

    // JSONL fallback
    try {
      if (!fs.existsSync(this.jsonlPath)) return []
      const lines = fs.readFileSync(this.jsonlPath, 'utf-8').trim().split('\n').filter(Boolean)
      return lines
        .map(l => { try { return JSON.parse(l) } catch { return null } })
        .filter(Boolean)
        .reverse()
        .slice(offset, offset + limit)
    } catch { return [] }
  }

  cleanup(retentionDays = 30): number {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000

    if (this.usingSqlite && this.db) {
      try {
        const result = this.db.prepare('DELETE FROM audit_log WHERE timestamp < ?').run(cutoff)
        if (result.changes > 0) {
          console.log(`[AuditLog] Cleaned up ${result.changes} entries older than ${retentionDays} days`)
        }
        return result.changes
      } catch { /* fall through */ }
    }

    // JSONL fallback
    try {
      if (!fs.existsSync(this.jsonlPath)) return 0
      const lines = fs.readFileSync(this.jsonlPath, 'utf-8').trim().split('\n').filter(Boolean)
      const kept = lines.filter(l => {
        try { return JSON.parse(l).timestamp >= cutoff } catch { return true }
      })
      const removed = lines.length - kept.length
      if (removed > 0) {
        fs.writeFileSync(this.jsonlPath, kept.join('\n') + '\n')
      }
      return removed
    } catch { return 0 }
  }

  close(): void {
    if (this.db) {
      try { this.db.close() } catch { /* already closed */ }
    }
  }
}
