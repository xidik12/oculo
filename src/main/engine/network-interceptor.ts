import { Session } from 'electron'

export interface HarEntry {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    headers: { name: string; value: string }[]
  }
  response: {
    status: number
    statusText: string
    headers: { name: string; value: string }[]
    content: {
      size: number
      mimeType: string
    }
  }
  timings: {
    send: number
    wait: number
    receive: number
  }
}

export interface HarLog {
  version: string
  creator: { name: string; version: string }
  entries: HarEntry[]
}

/**
 * Network interceptor that records/replays HTTP requests in HAR format.
 * Uses Electron's session.webRequest API.
 */
export class NetworkInterceptor {
  private recording = false
  private entries: HarEntry[] = []
  private pendingRequests = new Map<string, { startTime: number; method: string; url: string; headers: Record<string, string> }>()

  /** Start recording network requests */
  startRecording(session: Session): void {
    if (this.recording) return
    this.recording = true
    this.entries = []
    this.pendingRequests.clear()

    session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (this.recording) {
        this.pendingRequests.set(details.id.toString(), {
          startTime: Date.now(),
          method: details.method,
          url: details.url,
          headers: (details as any).requestHeaders || {}
        })
      }
      callback({})
    })

    session.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
      if (!this.recording) return
      const pending = this.pendingRequests.get(details.id.toString())
      if (!pending) return
      this.pendingRequests.delete(details.id.toString())

      const entry: HarEntry = {
        startedDateTime: new Date(pending.startTime).toISOString(),
        time: Date.now() - pending.startTime,
        request: {
          method: pending.method,
          url: pending.url,
          headers: Object.entries(pending.headers).map(([name, value]) => ({
            name,
            value: String(value)
          }))
        },
        response: {
          status: details.statusCode,
          statusText: details.statusLine || '',
          headers: Object.entries(details.responseHeaders || {}).map(([name, value]) => ({
            name,
            value: Array.isArray(value) ? value.join(', ') : String(value)
          })),
          content: {
            size: 0,
            mimeType: (details.responseHeaders?.['content-type'] as unknown as string) || 'application/octet-stream'
          }
        },
        timings: {
          send: 0,
          wait: Date.now() - pending.startTime,
          receive: 0
        }
      }

      this.entries.push(entry)

      // Cap at 5000 entries
      if (this.entries.length > 5000) {
        this.entries = this.entries.slice(-5000)
      }
    })

    session.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (details) => {
      this.pendingRequests.delete(details.id.toString())
    })
  }

  /** Stop recording */
  stopRecording(): void {
    this.recording = false
    this.pendingRequests.clear()
  }

  /** Get recorded entries as HAR */
  getHarLog(): HarLog {
    return {
      version: '1.2',
      creator: { name: 'Oculo', version: '0.4.0' },
      entries: [...this.entries]
    }
  }

  /** Get summary of recorded requests */
  getSummary(): string {
    if (this.entries.length === 0) return 'No requests recorded'

    const byStatus = new Map<number, number>()
    const byType = new Map<string, number>()

    for (const entry of this.entries) {
      byStatus.set(entry.response.status, (byStatus.get(entry.response.status) || 0) + 1)
      const type = entry.response.content.mimeType.split(';')[0]
      byType.set(type, (byType.get(type) || 0) + 1)
    }

    const statusSummary = [...byStatus.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ')

    return `${this.entries.length} requests recorded | Status: ${statusSummary}`
  }

  /** Check if currently recording */
  isRecording(): boolean {
    return this.recording
  }

  /** Clear recorded entries */
  clear(): void {
    this.entries = []
    this.pendingRequests.clear()
  }
}
