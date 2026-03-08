import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs'

const DATA_DIR = join(app.getPath('userData'), 'oculo-data')
const SESSIONS_DIR = join(DATA_DIR, 'sessions')
const MAX_SESSIONS = 50
const MAX_ENTRIES_PER_SESSION = 5000
const MAX_TOTAL_DISK_BYTES = 500 * 1024 * 1024 // 500 MB

export interface SessionEntry {
  timestamp: number
  type: 'tool_call' | 'tool_result' | 'screenshot' | 'navigation' | 'page_snapshot'
  toolName?: string
  args?: Record<string, unknown>
  result?: string
  url?: string
  screenshot?: string   // file path to screenshot
  snapshot?: string     // page description at that moment
}

export interface SessionRecord {
  id: string
  startedAt: number
  entries: SessionEntry[]
  status: 'recording' | 'stopped'
}

/**
 * SessionRecorder — records all MCP tool calls and page states for replay/debugging.
 *
 * Sessions are stored as individual JSON files in userData/sessions/.
 * Auto-captures tool calls and results. Supports manual screenshots and snapshots.
 * Max 50 sessions with auto-cleanup of oldest.
 */
export class SessionRecorder {
  private activeSession: SessionRecord | null = null

  constructor() {
    this.ensureDir()
  }

  private ensureDir(): void {
    try {
      if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true })
    } catch {
      // best effort
    }
  }

  /**
   * Start a new recording session.
   * Returns the session ID.
   */
  start(): string {
    // Stop any active session first
    if (this.activeSession) {
      this.stop()
    }

    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.activeSession = {
      id,
      startedAt: Date.now(),
      entries: [],
      status: 'recording'
    }

    this.autoCleanup()
    console.log(`[SessionRecorder] Started recording: ${id}`)
    return id
  }

  /**
   * Stop the current recording session.
   * Saves the session to disk.
   */
  stop(): SessionRecord | null {
    if (!this.activeSession) return null

    this.activeSession.status = 'stopped'
    this.saveSession(this.activeSession)
    const session = { ...this.activeSession }
    console.log(`[SessionRecorder] Stopped recording: ${session.id} (${session.entries.length} entries)`)
    this.activeSession = null
    return session
  }

  /**
   * Check if recording is currently active.
   */
  isRecording(): boolean {
    return this.activeSession !== null && this.activeSession.status === 'recording'
  }

  /**
   * Get the active session ID, or null if not recording.
   */
  getActiveSessionId(): string | null {
    return this.activeSession?.id || null
  }

  /**
   * Add an entry to the current recording session.
   * No-op if not recording.
   */
  addEntry(entry: Omit<SessionEntry, 'timestamp'>): void {
    if (!this.activeSession || this.activeSession.status !== 'recording') return

    if (this.activeSession.entries.length >= MAX_ENTRIES_PER_SESSION) {
      console.warn(`[SessionRecorder] Max entries (${MAX_ENTRIES_PER_SESSION}) reached — auto-stopping session ${this.activeSession.id}`)
      this.stop()
      return
    }

    this.activeSession.entries.push({
      ...entry,
      timestamp: Date.now()
    })

    // Auto-save every 10 entries to avoid data loss
    if (this.activeSession.entries.length % 10 === 0) {
      this.saveSession(this.activeSession)
    }
  }

  /**
   * Record a tool call (before execution).
   */
  recordToolCall(toolName: string, args: Record<string, unknown>): void {
    this.addEntry({
      type: 'tool_call',
      toolName,
      args
    })
  }

  /**
   * Record a tool result (after execution).
   */
  recordToolResult(toolName: string, result: string): void {
    this.addEntry({
      type: 'tool_result',
      toolName,
      result: result.substring(0, 5000) // cap result size for storage
    })
  }

  /**
   * Record a navigation event.
   */
  recordNavigation(url: string): void {
    this.addEntry({
      type: 'navigation',
      url
    })
  }

  /**
   * Record a screenshot capture.
   */
  recordScreenshot(filePath: string): void {
    this.addEntry({
      type: 'screenshot',
      screenshot: filePath
    })
  }

  /**
   * Record a page snapshot (description/accessibility tree).
   */
  recordPageSnapshot(url: string, snapshot: string): void {
    this.addEntry({
      type: 'page_snapshot',
      url,
      snapshot: snapshot.substring(0, 3000) // cap for storage
    })
  }

  /**
   * Get a specific session by ID.
   */
  getSession(id: string): SessionRecord | null {
    // Check active session first
    if (this.activeSession?.id === id) {
      return { ...this.activeSession }
    }

    // Load from disk
    const filePath = join(SESSIONS_DIR, `${id}.json`)
    try {
      if (!existsSync(filePath)) return null
      const data = readFileSync(filePath, 'utf-8')
      return JSON.parse(data) as SessionRecord
    } catch {
      return null
    }
  }

  /**
   * List all recorded sessions (summary info only, not full entries).
   */
  listSessions(): Array<{ id: string; startedAt: number; entryCount: number; status: string }> {
    const sessions: Array<{ id: string; startedAt: number; entryCount: number; status: string }> = []

    // Include active session
    if (this.activeSession) {
      sessions.push({
        id: this.activeSession.id,
        startedAt: this.activeSession.startedAt,
        entryCount: this.activeSession.entries.length,
        status: this.activeSession.status
      })
    }

    // Load summaries from disk
    try {
      const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json')).sort().reverse()
      for (const file of files) {
        try {
          const data = JSON.parse(readFileSync(join(SESSIONS_DIR, file), 'utf-8')) as SessionRecord
          // Skip if it's the active session (already added above)
          if (this.activeSession && data.id === this.activeSession.id) continue
          sessions.push({
            id: data.id,
            startedAt: data.startedAt,
            entryCount: data.entries.length,
            status: data.status
          })
        } catch {
          // skip corrupted files
        }
      }
    } catch {
      // sessions dir not available
    }

    // Sort by startedAt descending
    sessions.sort((a, b) => b.startedAt - a.startedAt)
    return sessions
  }

  /**
   * Export a session as a JSON string for debugging/sharing.
   */
  exportSession(id: string): string | null {
    const session = this.getSession(id)
    if (!session) return null
    return JSON.stringify(session, null, 2)
  }

  /**
   * Save a session record to disk.
   */
  private saveSession(session: SessionRecord): void {
    try {
      this.ensureDir()
      const filePath = join(SESSIONS_DIR, `${session.id}.json`)
      writeFileSync(filePath, JSON.stringify(session, null, 2))
    } catch (err) {
      console.error(`[SessionRecorder] Failed to save session ${session.id}:`, err)
    }
  }

  /**
   * Auto-cleanup: remove oldest sessions beyond MAX_SESSIONS.
   */
  private autoCleanup(): void {
    try {
      const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json')).sort()

      // Remove oldest sessions beyond MAX_SESSIONS
      if (files.length > MAX_SESSIONS) {
        const toDelete = files.slice(0, files.length - MAX_SESSIONS)
        for (const file of toDelete) {
          // Never delete the active session file
          if (this.activeSession && file === `${this.activeSession.id}.json`) continue
          try {
            unlinkSync(join(SESSIONS_DIR, file))
          } catch {
            // skip individual file errors
          }
        }
        console.log(`[SessionRecorder] Cleaned up ${toDelete.length} old session(s) (count limit)`)
      }

      // Remove oldest sessions if total disk usage exceeds MAX_TOTAL_DISK_BYTES
      const remainingFiles = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json')).sort()
      let totalSize = 0
      const fileSizes: Array<{ name: string; size: number }> = []
      for (const file of remainingFiles) {
        try {
          const size = statSync(join(SESSIONS_DIR, file)).size
          totalSize += size
          fileSizes.push({ name: file, size })
        } catch {
          // skip
        }
      }

      if (totalSize > MAX_TOTAL_DISK_BYTES) {
        let removed = 0
        for (const { name, size } of fileSizes) {
          if (totalSize <= MAX_TOTAL_DISK_BYTES) break
          // Never delete the active session file
          if (this.activeSession && name === `${this.activeSession.id}.json`) continue
          try {
            unlinkSync(join(SESSIONS_DIR, name))
            totalSize -= size
            removed++
          } catch {
            // skip
          }
        }
        if (removed > 0) {
          console.log(`[SessionRecorder] Cleaned up ${removed} old session(s) (disk limit)`)
        }
      }
    } catch {
      // best effort cleanup
    }
  }
}
