import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { BrowserWindow, ipcMain } from 'electron'
import { SecurityManager } from '../security/vault'
import { AuditLog } from '../security/audit'
import { Redactor } from '../security/redactor'
import { AntiInjection } from '../security/anti-injection'
import { PermissionGate } from '../security/permissions'
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '../../shared/constants'
import { MediaGenerator, MediaRequest } from '../engine/media-generator'
import { AIProviderConfig } from '../../shared/ai-types'

const PORT_FILE = path.join(os.homedir(), '.oculo-port')
const BASE_PORT = 19516
const MAX_PORT = 19520

/**
 * MCP Server Manager — HTTP-based.
 *
 * Tool execution is delegated to the renderer process via IPC because
 * Electron 34's <webview> elements are only accessible from the renderer.
 * The main process cannot see webview webContents via getAllWebContents().
 */
export class McpServerManager {
  private httpServer: http.Server | null = null
  private actualPort: number | null = null
  private authToken: string
  private mainWindow: BrowserWindow
  private security: SecurityManager
  private auditLog: AuditLog
  private redactor: Redactor
  private antiInjection: AntiInjection
  private permissionGate: PermissionGate

  /** Pending tool call promises — resolved by IPC from renderer */
  private pendingToolCalls = new Map<string, { resolve: (result: string) => void; timer: NodeJS.Timeout }>()

  /** Media generator for image/video generation (runs in main process) */
  private mediaGenerator: MediaGenerator

  /** Provider configs for API key lookup */
  private providerConfigs: Map<string, AIProviderConfig> = new Map()

  /** Tool definitions served on `tools/list` */
  private readonly tools = [
    {
      name: 'page',
      description:
        'Describe the current page in compact format (~30-80 tokens). Returns URL, title, headings, forms, buttons, and links. Use this to understand what is on screen.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          scope: { type: 'string', description: 'CSS selector to scope description to a section of the page' },
          include: { type: 'array', items: { type: 'string' }, description: 'What to include: "forms", "buttons", "links", "headings", "text", "images". Default: ["forms","buttons","links","headings"]' },
          screenshot: { type: 'boolean', description: 'Attach a screenshot (default: false)' }
        }
      }
    },
    {
      name: 'act',
      description:
        'Perform an action on the page: click, navigate, scroll, press key, hover, or login. Elements are found by text, role, label, or placeholder — no snapshots needed.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: { type: 'string', enum: ['click', 'navigate', 'back', 'forward', 'scroll', 'press', 'hover', 'select', 'login', 'reload', 'screenshot', 'upload', 'type', 'focus', 'clear', 'newTab', 'switchTab', 'closeTab', 'download', 'listDownloads', 'readFile', 'clipboardImage'], description: 'Action to perform' },
          text: { type: 'string', description: 'Visible text on the element to interact with' },
          role: { type: 'string', description: 'ARIA role (button, link, textbox, etc.)' },
          name: { type: 'string', description: 'Accessible name of the element' },
          label: { type: 'string', description: 'Label text associated with the element' },
          placeholder: { type: 'string', description: 'Placeholder text of the input' },
          selector: { type: 'string', description: 'CSS selector (fallback)' },
          nth: { type: 'number', description: 'Which match to use (0-indexed, default: 0)' },
          url: { type: 'string', description: 'URL for navigate action' },
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
          amount: { type: 'number', description: 'Scroll amount in pixels' },
          key: { type: 'string', description: 'Key to press (Enter, Tab, Escape, etc.)' },
          modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifier keys (Ctrl, Shift, Alt, Meta)' },
          value: { type: 'string', description: 'Value for select action' },
          site: { type: 'string', description: 'Site domain for login action (uses credential vault)' },
          screenshot: { type: 'boolean', description: 'Attach screenshot after action' }
        },
        required: ['action']
      }
    },
    {
      name: 'fill',
      description: 'Fill multiple form fields at once by label. Handles text, select, checkbox, and textarea fields. Optionally submit the form.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          fields: { type: 'object', description: 'Map of field label to value. Use string for text/select, boolean for checkboxes.' },
          submit: { description: 'Submit the form. true = first submit button, string = button text' },
          screenshot: { type: 'boolean', description: 'Attach screenshot after filling' }
        },
        required: ['fields']
      }
    },
    {
      name: 'read',
      description: 'Extract structured data from the page (search results, tables, lists, articles). Returns compact formatted text.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          what: { type: 'string', description: 'What to extract: "search results", "products", "table data", etc.' },
          scope: { type: 'string', description: 'CSS selector to narrow extraction scope' },
          fields: { type: 'array', items: { type: 'string' }, description: 'Specific fields to extract' },
          limit: { type: 'number', description: 'Max items to return (default: 10)' },
          format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' }
        },
        required: ['what']
      }
    },
    {
      name: 'run',
      description: 'Execute a multi-step pipeline in one call. Each step can page/act/fill/read/wait. Much more efficient than calling individual tools.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          steps: {
            type: 'array',
            items: { type: 'object', description: 'Pipeline step.' },
            description: 'Array of steps to execute sequentially'
          },
          returnAll: { type: 'boolean', description: 'Return results from all steps (default: false, returns last only)' }
        },
        required: ['steps']
      }
    },
    {
      name: 'media',
      description: 'Generate images or videos from text prompts. Returns saved file path. Reuses Gemini/OpenAI keys from AI Providers settings.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          type: { type: 'string', enum: ['image', 'video'], description: 'Generate an image or video' },
          prompt: { type: 'string', description: 'What to create' },
          size: { type: 'string', description: '1024x1024, 1792x1024, etc.' },
          style: { type: 'string', description: 'natural, vivid, cinematic, anime' },
          provider: { type: 'string', description: 'Override: gemini, openai, stability, runway, kling' },
          duration: { type: 'number', description: 'Video duration in seconds' }
        },
        required: ['type', 'prompt']
      }
    }
  ]

  constructor(
    mainWindow: BrowserWindow,
    security: SecurityManager,
    auditLog: AuditLog,
    redactor: Redactor
  ) {
    this.mainWindow = mainWindow
    this.security = security
    this.auditLog = auditLog
    this.redactor = redactor
    this.antiInjection = new AntiInjection()
    this.permissionGate = new PermissionGate(mainWindow, auditLog)
    this.authToken = crypto.randomBytes(32).toString('hex')

    // Initialize media generator with API key lookup
    this.mediaGenerator = new MediaGenerator((provider: string) => {
      // Map media provider names to AI provider config names
      const providerMap: Record<string, string> = {
        'gemini': 'gemini',
        'openai': 'openai',
        'stability': 'stability',
        'runway': 'runway',
        'kling': 'kling'
      }
      const aiProviderId = providerMap[provider]
      if (!aiProviderId) return null
      return this.providerConfigs.get(aiProviderId)?.apiKey || null
    })

    // Receive tool results from renderer
    ipcMain.on('mcp:tool-result', (_event, callId: string, result: string) => {
      const pending = this.pendingToolCalls.get(callId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingToolCalls.delete(callId)
        pending.resolve(result)
      }
    })
  }

  /**
   * Execute a tool by sending it to the renderer process.
   * The renderer has access to the webview DOM elements and can executeJavaScript on them.
   */
  private executeToolViaRenderer(name: string, args: Record<string, unknown>): Promise<string> {
    return new Promise((resolve) => {
      const callId = crypto.randomUUID()

      // 30 second timeout
      const timer = setTimeout(() => {
        this.pendingToolCalls.delete(callId)
        resolve('Error: Tool call timed out after 30 seconds.')
      }, 30_000)

      this.pendingToolCalls.set(callId, { resolve, timer })

      try {
        this.mainWindow.webContents.send('mcp:tool-call', callId, name, args)
      } catch {
        clearTimeout(timer)
        this.pendingToolCalls.delete(callId)
        resolve('Error: Failed to send tool call to renderer.')
      }
    })
  }

  /**
   * Handle a tool call — permission check, execute via renderer, redact, audit.
   */
  async handleToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: unknown[]; isError?: boolean }> {
    try {
      // Permission check
      const actionDesc = name === 'act' ? (args as any)?.action || name : name
      const targetDesc = (args as any)?.text || (args as any)?.url || (args as any)?.what || name
      const allowed = await this.permissionGate.check(actionDesc, `${name}: ${targetDesc}`)
      if (!allowed) {
        return {
          content: [{ type: 'text', text: `Action "${actionDesc}" was denied by permission gate.` }]
        }
      }

      // Handle media tool directly in main process (no webview needed)
      if (name === 'media') {
        const mediaResult = await this.mediaGenerator.generate(args as unknown as MediaRequest)
        let result = mediaResult.success
          ? `${mediaResult.type === 'video' ? 'Video' : 'Image'} generated (${mediaResult.provider}): ${mediaResult.filePath}`
          : `Error: ${mediaResult.error}`
        result = this.redactor.redact(result)
        result = this.antiInjection.sanitize(result)
        result = this.antiInjection.wrapContent(result)
        this.auditLog.log('generate', args.prompt as string || 'media', mediaResult.success ? 'success' : 'failed', result.substring(0, 200), name)
        return { content: [{ type: 'text', text: result }], isError: !mediaResult.success }
      }

      // Execute tool via renderer IPC
      let result = await this.executeToolViaRenderer(name, args)

      // Redact sensitive data
      result = this.redactor.redact(result)

      // Anti-injection
      result = this.antiInjection.sanitize(result)
      result = this.antiInjection.wrapContent(result)

      // Audit log
      this.auditLog.log(actionDesc, targetDesc, 'success', result.substring(0, 200), name)

      return { content: [{ type: 'text', text: result }] }
    } catch (err) {
      const errMsg = (err as Error).message
      this.auditLog.log(name, JSON.stringify(args).substring(0, 200), 'failed', errMsg, name)
      return {
        content: [{ type: 'text', text: `Error: ${errMsg}` }],
        isError: true
      }
    }
  }

  private listenOnPort(server: http.Server, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => resolve(true))
    })
  }

  async start(): Promise<void> {
    this.httpServer = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }))
        return
      }

      if (req.method === 'POST' && req.url === '/mcp') {
        const authHeader = req.headers['authorization'] || ''
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
        if (token !== this.authToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', async () => {
          try {
            const request = JSON.parse(body)
            const { method, params } = request
            let response: unknown

            if (method === 'tools/list') {
              response = { tools: this.tools }
            } else if (method === 'tools/call') {
              const { name, arguments: args } = params || {}
              if (!name) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: 'Missing tool name' }))
                return
              }
              response = await this.handleToolCall(name, args || {})
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: `Unknown method: ${method}` }))
              return
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(response))
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: (err as Error).message }))
          }
        })
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    })

    let bound = false
    for (let port = BASE_PORT; port <= MAX_PORT; port++) {
      bound = await this.listenOnPort(this.httpServer, port)
      if (bound) { this.actualPort = port; break }
    }

    if (!bound) {
      console.error(`Oculo MCP server: could not bind to any port in range ${BASE_PORT}-${MAX_PORT}`)
      return
    }

    try {
      fs.writeFileSync(PORT_FILE, `${this.actualPort}:${this.authToken}`, { encoding: 'utf-8', mode: 0o600 })
    } catch (err) {
      console.error('Oculo MCP server: failed to write port file:', err)
    }

    console.log(`Oculo MCP server listening on http://127.0.0.1:${this.actualPort}`)
  }

  /** Update provider configs for media generation API key lookup */
  setProviderConfigs(configs: Map<string, AIProviderConfig>): void {
    this.providerConfigs = configs
  }

  stop(): void {
    if (this.httpServer) { this.httpServer.close(); this.httpServer = null }
    try { if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE) } catch { /* best-effort */ }
    this.actualPort = null
    // Clean up pending calls
    for (const [, pending] of this.pendingToolCalls) {
      clearTimeout(pending.timer)
      pending.resolve('Error: Server stopped.')
    }
    this.pendingToolCalls.clear()
  }
}
