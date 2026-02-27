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
        'Describe the current page. Default: compact format (~30-80 tokens). Use detail="a11y" for full accessibility tree with interactive elements numbered [1],[2]... — better for complex React forms.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          scope: { type: 'string', description: 'CSS selector to scope description to a section of the page' },
          detail: { type: 'string', enum: ['compact', 'a11y'], description: 'compact (default ~30-80 tokens) or a11y (full accessibility tree ~200-500 tokens, better for complex forms)' },
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
          action: { type: 'string', enum: ['click', 'navigate', 'back', 'forward', 'scroll', 'press', 'hover', 'select', 'login', 'reload', 'screenshot', 'screenshotSoM', 'upload', 'type', 'focus', 'clear', 'newTab', 'switchTab', 'closeTab', 'download', 'listDownloads', 'readFile', 'clipboardImage', 'smartScroll', 'waitForText', 'waitForNetworkIdle', 'screenshotElement', 'listTabs', 'autoLogin', 'monitorNetwork', 'visualDiff', 'detectAPIs', 'iframeNavigate', 'recordStart', 'recordStop', 'dragAndDrop', 'extractPDF', 'monitorWebSocket', 'checkDialogs', 'printToPDF', 'getCookies', 'setCookie', 'deleteCookie', 'getStorage', 'setStorage', 'clearStorage', 'interceptNetwork'], description: 'Action to perform' },
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
      description: 'Fill multiple form fields at once by label text. Use the human-readable label shown on the page (e.g. "Company Name", "Email"), NOT internal field IDs or hex values. Handles text, select, checkbox, textarea, and contenteditable fields.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          fields: { type: 'object', description: 'Object mapping field label → value. Keys should be the visible label text from the page (e.g. {"Company Name": "Oculo", "Email": "hi@oculo.com"}). Use CSS selectors as keys for unlabeled fields (e.g. {"#field-id": "value"}). Values: string for text/select, boolean for checkboxes.' },
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
      description: 'Execute a multi-step pipeline in one call. Each step can page/act/fill/read/wait. Successful runs are cached for instant replay. Use workflow ID to replay.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          steps: {
            type: 'array',
            description: 'Array of steps. Each step is an object with exactly ONE key: page, act, fill, read, wait, or if.',
            items: {
              type: 'object',
              properties: {
                page: {
                  type: 'object',
                  description: 'Describe the page.',
                  properties: {
                    scope: { type: 'string', description: 'CSS selector scope' },
                    include: { type: 'array', items: { type: 'string' }, description: 'Categories: forms, buttons, links, headings, text, images' }
                  }
                },
                act: {
                  type: 'object',
                  description: 'Perform an action (click, navigate, scroll, etc.).',
                  properties: {
                    action: { type: 'string', description: 'click, navigate, scroll, press, type, hover, etc.' },
                    text: { type: 'string' },
                    url: { type: 'string' },
                    selector: { type: 'string' },
                    key: { type: 'string' },
                    direction: { type: 'string' },
                    value: { type: 'string' }
                  },
                  required: ['action']
                },
                fill: {
                  type: 'object',
                  description: 'Fill form fields by label.',
                  properties: {
                    fields: { type: 'object', description: 'Map of label → value' },
                    submit: { description: 'true or button text' }
                  },
                  required: ['fields']
                },
                read: {
                  type: 'object',
                  description: 'Extract structured data.',
                  properties: {
                    what: { type: 'string', description: 'What to extract' },
                    scope: { type: 'string' },
                    fields: { type: 'array', items: { type: 'string' } },
                    limit: { type: 'number' },
                    format: { type: 'string', enum: ['text', 'json'] }
                  },
                  required: ['what']
                },
                wait: {
                  type: 'object',
                  description: 'Wait for a condition (throws on timeout).',
                  properties: {
                    text: { type: 'string', description: 'Wait for text to appear' },
                    url: { type: 'string', description: 'Wait for URL to contain string' },
                    selector: { type: 'string', description: 'Wait for CSS selector to match' },
                    timeout: { type: 'number', description: 'Timeout in ms (default: 5000)' }
                  }
                },
                if: {
                  type: 'object',
                  description: 'Conditional branch.',
                  properties: {
                    text: { type: 'string', description: 'Condition: page contains text' },
                    url: { type: 'string', description: 'Condition: URL contains string' },
                    then: { type: 'object', description: 'Step to execute if true' },
                    else: { type: 'object', description: 'Step to execute if false' }
                  }
                }
              }
            }
          },
          workflow: { type: 'string', description: 'Replay a cached workflow by ID (shown in page output). Overrides steps.' },
          description: { type: 'string', description: 'Short description of what this pipeline does (for caching)' },
          returnAll: { type: 'boolean', description: 'Return results from all steps (default: false, returns last only)' }
        }
      }
    },
    {
      name: 'media',
      description: 'Generate images (Nano Banana 2 / DALL-E 3) or videos (Veo 3.1). Returns saved file path. Uses Gemini API key for both image and video.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          type: { type: 'string', enum: ['image', 'video'], description: 'Generate an image or video' },
          prompt: { type: 'string', description: 'What to create' },
          model: { type: 'string', description: 'Image model: nano-banana-2 (default, best balance), nano-banana-pro (highest quality), nano-banana (fastest)' },
          size: { type: 'string', description: 'Image: 1024x1024, 2K, 4K. Video aspect: 16:9, 9:16' },
          style: { type: 'string', description: 'natural, vivid, cinematic, anime' },
          provider: { type: 'string', description: 'Override: gemini, openai, stability' },
          duration: { type: 'number', description: 'Video duration: 4, 6, or 8 seconds' }
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
        'veo': 'gemini'  // Veo 3.1 uses the Gemini API key
      }
      const aiProviderId = providerMap[provider]
      if (!aiProviderId) return null
      const cfg = this.providerConfigs.get(aiProviderId)
      const key = cfg?.apiKey || null
      console.log(`[MCP Media] getApiKey(${provider}) → aiProviderId=${aiProviderId} hasConfig=${!!cfg} hasKey=${!!key} mapSize=${this.providerConfigs.size} mapKeys=[${[...this.providerConfigs.keys()]}]`)
      return key
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

      // 120 second timeout (generous for screenshot capture, CDP uploads, etc.)
      const timer = setTimeout(() => {
        this.pendingToolCalls.delete(callId)
        resolve('Error: Tool call timed out after 120 seconds.')
      }, 120_000)

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
          ? `${(args as any).type === 'video' ? 'Video' : 'Image'} generated (${mediaResult.provider}): ${mediaResult.filePath}`
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
    console.log(`[MCP] setProviderConfigs called — size=${configs.size} keys=[${[...configs.keys()]}] hasGeminiKey=${!!(configs.get('gemini')?.apiKey)}`)
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
