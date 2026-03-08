import { BrowserWindow } from 'electron'
import { PipelineStep, PatternSuggestion } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'

interface ToolCallRecord {
  tool: string
  action?: string
  domain: string
  args: Record<string, unknown>
  timestamp: number
}

/**
 * Detects repeated action sequences from individual MCP tool calls
 * and suggests saving them as reusable pipelines.
 */
export class PatternDetector {
  private buffer: ToolCallRecord[] = []
  private dismissed = new Set<string>()
  private suggested = new Set<string>()
  private mainWindow: BrowserWindow

  private static MAX_BUFFER = 100
  private static MIN_SEQ_LEN = 3
  private static MAX_SEQ_LEN = 8
  private static MIN_OCCURRENCES = 2

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  /** Record a tool call after execution */
  recordToolCall(tool: string, args: Record<string, unknown>, domain?: string): void {
    // Only track browser interaction tools
    if (!['page', 'act', 'fill', 'read'].includes(tool)) return

    const action = tool === 'act' ? String(args.action || '') : undefined
    const resolvedDomain = domain || this.extractDomain(args)
    if (!resolvedDomain) return

    this.buffer.push({
      tool,
      action,
      domain: resolvedDomain,
      args: { ...args },
      timestamp: Date.now()
    })

    // Cap buffer
    if (this.buffer.length > PatternDetector.MAX_BUFFER) {
      this.buffer = this.buffer.slice(-PatternDetector.MAX_BUFFER)
    }

    // Scan for patterns
    this.scan()
  }

  /** Dismiss a suggestion so it's not re-suggested */
  dismiss(id: string): void {
    this.dismissed.add(id)
    this.suggested.delete(id)
  }

  private extractDomain(args: Record<string, unknown>): string {
    const url = String(args.url || '')
    if (url) {
      try { return new URL(url).hostname } catch { /* ignore */ }
    }
    return ''
  }

  /** Get signature for a tool call (used for subsequence matching) */
  private getSignature(record: ToolCallRecord): string {
    if (record.action) return `${record.tool}:${record.action}`
    return record.tool
  }

  /** Scan buffer for repeated subsequences on the same domain */
  private scan(): void {
    // Group records by domain
    const byDomain = new Map<string, ToolCallRecord[]>()
    for (const rec of this.buffer) {
      const existing = byDomain.get(rec.domain) || []
      existing.push(rec)
      byDomain.set(rec.domain, existing)
    }

    for (const [domain, records] of byDomain) {
      if (records.length < PatternDetector.MIN_SEQ_LEN * PatternDetector.MIN_OCCURRENCES) continue

      // Try each sequence length from longest to shortest
      for (let len = PatternDetector.MAX_SEQ_LEN; len >= PatternDetector.MIN_SEQ_LEN; len--) {
        if (records.length < len * PatternDetector.MIN_OCCURRENCES) continue

        // Use the most recent sequence of `len` as the candidate
        const candidate = records.slice(-len)
        const candidateSigs = candidate.map(r => this.getSignature(r))
        const candidateKey = candidateSigs.join('|')

        // Count how many times this signature appears in the buffer
        let occurrences = 0
        for (let i = 0; i <= records.length - len; i++) {
          const window = records.slice(i, i + len)
          const windowSigs = window.map(r => this.getSignature(r))
          if (windowSigs.join('|') === candidateKey) {
            occurrences++
          }
        }

        if (occurrences >= PatternDetector.MIN_OCCURRENCES) {
          const id = `pattern-${domain}-${candidateKey.replace(/[^a-zA-Z0-9:]/g, '_')}`

          // Skip if already dismissed or suggested
          if (this.dismissed.has(id) || this.suggested.has(id)) continue

          // Build pipeline steps from the most recent occurrence
          const steps = this.buildSteps(candidate)
          const suggestion: PatternSuggestion = {
            id,
            domain,
            sequenceLength: len,
            occurrences,
            suggestedName: this.generateName(candidate, domain),
            steps
          }

          this.suggested.add(id)

          // Send to renderer
          try {
            if (!this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send(IPC.PIPELINE_SUGGEST, suggestion)
            }
          } catch { /* window destroyed */ }

          // Only suggest one pattern per scan
          return
        }
      }
    }
  }

  /** Convert tool call records into PipelineStep[] */
  private buildSteps(records: ToolCallRecord[]): PipelineStep[] {
    return records.map(rec => {
      const { tool, args } = rec
      const cleanArgs = { ...args }
      // Remove screenshot flags to keep pipelines lean
      delete cleanArgs.screenshot

      switch (tool) {
        case 'page':
          return { page: cleanArgs as any }
        case 'act':
          return { act: cleanArgs as any }
        case 'fill':
          return { fill: cleanArgs as any }
        case 'read':
          return { read: cleanArgs as any }
        default:
          return { act: cleanArgs as any }
      }
    })
  }

  /** Generate a human-readable name for a pattern */
  private generateName(records: ToolCallRecord[], domain: string): string {
    const actions = records
      .filter(r => r.action)
      .map(r => r.action!)
    const uniqueActions = [...new Set(actions)]

    if (uniqueActions.length > 0) {
      const shortDomain = domain.replace(/^www\./, '').split('.')[0]
      return `${uniqueActions.slice(0, 3).join(' + ')} on ${shortDomain}`
    }
    return `workflow on ${domain}`
  }
}
