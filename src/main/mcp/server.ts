import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { BrowserWindow, ipcMain } from 'electron'
import { isHeadless, headlessLog } from '../headless'
import { SecurityManager } from '../security/vault'
import { AuditLog } from '../security/audit'
import { Redactor } from '../security/redactor'
import { AntiInjection } from '../security/anti-injection'
import { PermissionGate } from '../security/permissions'
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '../../shared/constants'
import { MediaGenerator, MediaRequest } from '../engine/media-generator'
import { AIProviderConfig } from '../../shared/ai-types'
import { PtyManager } from '../terminal/pty-manager'
import { Previewer } from '../engine/previewer'
import { PatternDetector } from '../data/pattern-detector'
import { ProxyManager, ProxyConfig } from '../network/proxy'
import { SessionRecorder } from '../data/session-recorder'
import { SelectorCache, SelectorBundle } from '../engine/selector-cache'
import { takeSnapshot, compare, StructuralSnapshot } from '../engine/dom-differ'

const PORT_FILE = path.join(os.homedir(), '.oculo-port')
const BASE_PORT = 19516
const MAX_PORT = 19520

const debugLog = process.env.OCULO_MCP_DEBUG === '1' || process.env.NODE_ENV !== 'production'
  ? (...args: unknown[]) => console.log('[MCP]', ...args)
  : () => {}

/** Sliding window rate limiter */
class RateLimiter {
  private windows = new Map<string, number[]>()
  private maxRequests: number
  private windowMs: number

  constructor(maxRequests = 200, windowMs = 60000) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
  }

  isAllowed(key: string): boolean {
    const now = Date.now()
    const timestamps = this.windows.get(key) || []
    // Remove expired entries
    const valid = timestamps.filter(t => now - t < this.windowMs)
    if (valid.length >= this.maxRequests) {
      this.windows.set(key, valid)
      return false
    }
    valid.push(now)
    this.windows.set(key, valid)
    return true
  }

  // Cleanup old entries periodically
  cleanup(): void {
    const now = Date.now()
    for (const [key, timestamps] of this.windows) {
      const valid = timestamps.filter(t => now - t < this.windowMs)
      if (valid.length === 0) this.windows.delete(key)
      else this.windows.set(key, valid)
    }
  }
}

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
  private rateLimiter = new RateLimiter(200, 60000)
  private rateLimiterCleanup: NodeJS.Timeout | null = null
  private mainWindow: BrowserWindow
  private security: SecurityManager
  private auditLog: AuditLog
  private redactor: Redactor
  private antiInjection: AntiInjection
  private permissionGate: PermissionGate

  /** Pending tool call promises — resolved by IPC from renderer */
  private pendingToolCalls = new Map<string, { resolve: (result: string) => void; timer: NodeJS.Timeout; startedAt: number; toolName: string }>()

  /** Agent ID → tab ID mapping for multi-agent tab isolation */
  private agentTabMap = new Map<string, string>()

  /** Media generator for image/video generation (runs in main process) */
  private mediaGenerator: MediaGenerator

  /** Provider configs for API key lookup */
  private providerConfigs: Map<string, AIProviderConfig> = new Map()

  /** PTY manager for shell tool execution */
  private ptyManager: PtyManager | null = null

  /** URL previewer for preview tool */
  private previewer = new Previewer()

  /** Pattern detector for learning action sequences */
  private patternDetector: PatternDetector | null = null

  /** Proxy manager for configuring HTTP/SOCKS proxies */
  private proxyManager: ProxyManager

  /** Session recorder for recording MCP actions */
  private sessionRecorder: SessionRecorder

  /** Selector cache — self-healing selector stability engine */
  private selectorCache: SelectorCache

  /** DOM snapshots per domain for structural comparison */
  private domSnapshots: Map<string, StructuralSnapshot> = new Map()

  /** Active SSE connections for streaming tool results */
  private sseConnections = new Map<string, import('http').ServerResponse>()

  /** Tool definitions served on `tools/list` */
  private readonly tools = [
    {
      name: 'page',
      description:
        'Describe the current page. Default: compact format (~30-80 tokens). Use detail="a11y" for ref-tagged accessibility tree — interactive elements get [ref=e1],[ref=e2]... refs usable in act tool. Use detail="markdown" for full article content as clean markdown.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          scope: { type: 'string', description: 'CSS selector to scope description to a section of the page' },
          detail: { type: 'string', enum: ['compact', 'a11y', 'markdown'], description: 'compact (default ~30-80 tokens), a11y (ref-tagged accessibility tree ~200-500 tokens), or markdown (article extraction via Readability)' },
          include: { type: 'array', items: { type: 'string' }, description: 'What to include: "forms", "buttons", "links", "headings", "text", "images". Default: ["forms","buttons","links","headings"]' },
          screenshot: { type: 'boolean', description: 'Attach a screenshot (default: false)' },
          tabId: { type: 'string', description: 'Target a specific tab by ID (for background execution). Omit for active tab.' }
        }
      }
    },
    {
      name: 'act',
      description:
        'Perform an action on the page: click, navigate, scroll, press key, hover, type, or login. Elements found by ref (from a11y snapshot), text, role, label, placeholder, or CSS selector. After click/navigate/back/forward/reload, returns fresh ref-tagged snapshot.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: { type: 'string', enum: ['click', 'navigate', 'back', 'forward', 'scroll', 'press', 'hover', 'select', 'login', 'reload', 'screenshot', 'screenshotSoM', 'upload', 'type', 'focus', 'clear', 'newTab', 'switchTab', 'closeTab', 'download', 'listDownloads', 'readFile', 'writeFile', 'clipboardImage', 'smartScroll', 'waitForText', 'waitForNetworkIdle', 'screenshotElement', 'listTabs', 'autoLogin', 'monitorNetwork', 'visualDiff', 'detectAPIs', 'iframeNavigate', 'recordStart', 'recordStop', 'dragAndDrop', 'extractPDF', 'monitorWebSocket', 'checkDialogs', 'printToPDF', 'getCookies', 'setCookie', 'deleteCookie', 'getStorage', 'setStorage', 'clearStorage', 'interceptNetwork', 'drag', 'clickAtPoint', 'doubleClick', 'rightClick', 'tripleClick', 'selectAll', 'scrollIntoView', 'waitForElement', 'wait', 'copy', 'paste', 'evaluate', 'getAttribute', 'solveCaptcha', 'exportCookies', 'importCookies', 'setProxy', 'clearProxy', 'startRecording', 'stopRecording'], description: 'Action to perform' },
          ref: { type: 'string', description: 'Element ref from a11y snapshot (e.g. "e5"). Preferred over text/selector — use page({detail:"a11y"}) first.' },
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
          value: { type: 'string', description: 'Value for select action, file path for readFile/writeFile' },
          content: { type: 'string', description: 'File content for writeFile action' },
          site: { type: 'string', description: 'Site domain for login action (uses credential vault)' },
          clear: { type: 'boolean', description: 'Clear existing content before typing (for type action). Works with both regular inputs and contenteditable fields.' },
          screenshot: { type: 'boolean', description: 'Attach screenshot after action' },
          from: { type: 'object', description: 'Drag source: {x, y} or {text, selector}' },
          to: { type: 'object', description: 'Drag target: {x, y} or {text, selector}' },
          x: { type: 'number', description: 'X coordinate for clickAtPoint/drag' },
          y: { type: 'number', description: 'Y coordinate for clickAtPoint/drag' },
          expression: { type: 'string', description: 'JavaScript expression for evaluate action' },
          attribute: { type: 'string', description: 'Attribute name for getAttribute action' },
          cookies: { type: 'array', description: 'Cookies array for importCookies action' },
          autoSubmit: { type: 'boolean', description: 'Auto-submit after login (default: true)' },
          tabId: { type: 'string', description: 'Target a specific tab by ID (for background execution). Omit for active tab.' },
          background: { type: 'boolean', description: 'For newTab: open in background without switching to it (default: false). Returns tab ID for parallel execution.' },
          proxy: { type: 'object', description: 'Proxy config for setProxy action: {type, host, port, username?, password?, bypass?}', properties: { type: { type: 'string', enum: ['http', 'https', 'socks4', 'socks5', 'direct'] }, host: { type: 'string' }, port: { type: 'number' }, username: { type: 'string' }, password: { type: 'string' }, bypass: { type: 'array', items: { type: 'string' } } } }
        },
        required: ['action']
      }
    },
    {
      name: 'fill',
      description: 'Fill multiple form fields at once by label, placeholder, or data-placeholder text. Use the human-readable label shown on the page (e.g. "Company Name", "Email", "What\'s happening?"). Handles text, select, checkbox, textarea, and contenteditable fields (DraftJS, ProseMirror).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          fields: { type: 'object', description: 'Object mapping field label → value. Keys should be the visible label text from the page (e.g. {"Company Name": "Oculo", "Email": "hi@oculo.com"}). Use CSS selectors as keys for unlabeled fields (e.g. {"#field-id": "value"}). Values: string for text/select, boolean for checkboxes.' },
          submit: { description: 'Submit the form. true = first submit button, string = button text' },
          screenshot: { type: 'boolean', description: 'Attach screenshot after filling' },
          tabId: { type: 'string', description: 'Target a specific tab by ID (for background execution). Omit for active tab.' }
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
          format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
          tabId: { type: 'string', description: 'Target a specific tab by ID (for background execution). Omit for active tab.' }
        },
        required: ['what']
      }
    },
    {
      name: 'run',
      description: 'PREFERRED for any task with 2+ actions. Executes a multi-step pipeline in a SINGLE call — use this instead of multiple act/fill calls. Example — post on X: run({steps:[{act:{action:"navigate",url:"https://x.com/compose/post"}},{wait:{timeout:2000}},{act:{action:"type",text:"Hello world",role:"textbox"}},{act:{action:"click",text:"Post",role:"button"}}]}). Each step is an object with exactly ONE key: page, act, fill, read, wait, or if. Cached for replay.',
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
          returnAll: { type: 'boolean', description: 'Return results from all steps (default: false, returns last only)' },
          tabId: { type: 'string', description: 'Target a specific tab by ID (for background execution). Omit for active tab.' }
        }
      }
    },
    {
      name: 'media',
      description: 'Generate images (Nano Banana 2 / DALL-E 3) or videos (Veo 3.1). Returns saved file path. Uses Gemini API key for both image and video. Supports image-to-image editing with reference image.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          type: { type: 'string', enum: ['image', 'video'], description: 'Generate an image or video' },
          prompt: { type: 'string', description: 'What to create' },
          image: { type: 'string', description: 'Path to reference image for image-to-image editing/transformation (Gemini only)' },
          model: { type: 'string', description: 'Image model: nano-banana-2 (default, best balance), nano-banana-pro (highest quality), nano-banana (fastest)' },
          size: { type: 'string', description: 'Image: 1024x1024, 2K, 4K. Video aspect: 16:9, 9:16' },
          style: { type: 'string', description: 'natural, vivid, cinematic, anime' },
          provider: { type: 'string', description: 'Override: gemini, openai, stability' },
          duration: { type: 'number', description: 'Video duration: 4, 6, or 8 seconds' }
        },
        required: ['type', 'prompt']
      }
    },
    {
      name: 'research',
      description: 'Deep research on a topic. Searches the web, opens top results, reads content from each, and synthesizes a markdown report with sources. Use for in-depth research tasks.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          topic: { type: 'string', description: 'The research topic or question' },
          depth: { type: 'number', description: 'Research depth: 1=quick (3 pages), 2=standard (5 pages), 3=deep (8 pages). Default: 2' },
          maxPages: { type: 'number', description: 'Maximum pages to read (overrides depth). Default: 5' }
        },
        required: ['topic']
      }
    },
    {
      name: 'shell',
      description: 'Execute a shell command (ls, npm, git, node, python, etc.) and return stdout+stderr. Non-interactive only — no vim, no interactive prompts. Use for file operations, package management, build tools, and system commands.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000, max: 120000)' }
        },
        required: ['command']
      }
    },
    {
      name: 'webmcp_list',
      description: 'Discover WebMCP tools registered by the current page via navigator.modelContext.registerTool() or <form toolname="..."> elements. Returns list of available page-declared tools with their schemas.',
      inputSchema: {
        type: 'object' as const,
        properties: {}
      }
    },
    {
      name: 'webmcp_call',
      description: 'Call a WebMCP tool registered by the current page. Use webmcp_list first to discover available tools.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Tool name to call (from webmcp_list)' },
          args: { type: 'object', description: 'Arguments to pass to the tool' }
        },
        required: ['name']
      }
    },
    {
      name: 'tabs',
      description: 'List all open tabs or describe a specific tab. No args → list all tabs with URLs/titles. describe=N → get full page description of tab N.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          describe: { type: 'number', description: 'Tab index to describe (0-indexed). Returns full page description of that tab.' },
          detail: { type: 'string', enum: ['compact', 'a11y'], description: 'Detail level when describing a tab (default: compact)' }
        }
      }
    },
    {
      name: 'preview',
      description: 'Pre-fetch and summarize a URL without navigating. Returns title, description, and text snippet. 5s timeout, cached for 5 minutes.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'URL to preview' }
        },
        required: ['url']
      }
    },
    {
      name: 'translate',
      description: 'Translate text or page content. Extracts visible text and returns it with a translation instruction for the AI to translate.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          to: { type: 'string', description: 'Target language (e.g. "English", "Spanish", "Japanese")' },
          text: { type: 'string', description: 'Specific text to translate. If omitted, extracts from current page.' },
          scope: { type: 'string', description: 'CSS selector to scope extraction (optional)' }
        },
        required: ['to']
      }
    },
    {
      name: 'lens',
      description: 'Visual analysis of page screenshots or specific elements. Captures image and returns it for AI vision analysis.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          target: { type: 'string', enum: ['page', 'element'], description: 'What to capture: full page or specific element' },
          selector: { type: 'string', description: 'CSS selector for element target' },
          question: { type: 'string', description: 'What to analyze in the image' }
        }
      }
    },
    {
      name: 'abort',
      description: 'Cancel a pending tool call by callId, or pass callId="all" to cancel everything.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          callId: { type: 'string', description: 'The call ID to cancel, or "all" to cancel all pending calls' }
        },
        required: ['callId']
      }
    },
    {
      name: 'status',
      description: 'List all pending tool calls with their callId, toolName, and elapsed time.',
      inputSchema: {
        type: 'object' as const,
        properties: {}
      }
    }
  ]

  constructor(
    mainWindow: BrowserWindow,
    security: SecurityManager,
    auditLog: AuditLog,
    redactor: Redactor,
    patternDetector?: PatternDetector
  ) {
    this.mainWindow = mainWindow
    this.security = security
    this.auditLog = auditLog
    this.redactor = redactor
    this.patternDetector = patternDetector || null
    this.antiInjection = new AntiInjection()
    this.permissionGate = new PermissionGate(mainWindow, auditLog, () => this.security.getSettings())
    this.authToken = crypto.randomBytes(32).toString('hex')
    this.proxyManager = new ProxyManager()
    this.sessionRecorder = new SessionRecorder()
    this.selectorCache = new SelectorCache()

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

      this.pendingToolCalls.set(callId, { resolve, timer, startedAt: Date.now(), toolName: name })

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
   * Create a new tab for an agent via IPC to the renderer.
   * Returns the new tab ID, or null if creation failed.
   */
  private createAgentTab(): Promise<string | null> {
    return new Promise((resolve) => {
      const responseChannel = `mcp:agent-tab-created-${crypto.randomUUID()}`
      const timeout = setTimeout(() => {
        ipcMain.removeAllListeners(responseChannel)
        resolve(null)
      }, 5000)

      ipcMain.once(responseChannel, (_event, tabId: string) => {
        clearTimeout(timeout)
        resolve(tabId || null)
      })

      try {
        this.mainWindow.webContents.send('mcp:agent-tab-create', responseChannel)
      } catch {
        clearTimeout(timeout)
        ipcMain.removeAllListeners(responseChannel)
        resolve(null)
      }
    })
  }

  /**
   * Handle a tool call — permission check, execute via renderer, redact, audit.
   */
  async handleToolCall(
    name: string,
    args: Record<string, unknown>,
    agentId?: string
  ): Promise<{ content: unknown[]; isError?: boolean }> {
    try {
      // --- Agent cancellation tools (handled before permission check) ---
      if (name === 'abort') {
        const callId = String(args.callId || '')
        if (!callId) {
          return { content: [{ type: 'text', text: 'Error: callId is required. Use "all" to cancel everything.' }], isError: true }
        }
        if (callId === 'all') {
          const count = this.pendingToolCalls.size
          for (const [id, pending] of this.pendingToolCalls) {
            clearTimeout(pending.timer)
            pending.resolve('Cancelled by agent')
          }
          this.pendingToolCalls.clear()
          return { content: [{ type: 'text', text: `Cancelled ${count} pending call(s).` }] }
        }
        const pending = this.pendingToolCalls.get(callId)
        if (!pending) {
          return { content: [{ type: 'text', text: `No pending call with id "${callId}".` }], isError: true }
        }
        clearTimeout(pending.timer)
        pending.resolve('Cancelled by agent')
        this.pendingToolCalls.delete(callId)
        return { content: [{ type: 'text', text: `Cancelled call "${callId}" (${pending.toolName}).` }] }
      }

      if (name === 'status') {
        const entries = Array.from(this.pendingToolCalls.entries()).map(([id, p]) => ({
          callId: id,
          toolName: p.toolName,
          elapsedMs: Date.now() - p.startedAt
        }))
        return { content: [{ type: 'text', text: entries.length === 0 ? 'No pending calls.' : JSON.stringify(entries, null, 2) }] }
      }

      // --- Multi-agent tab isolation ---
      if (agentId && !args.tabId) {
        // Tools that need a tab context
        const needsTab = ['page', 'act', 'fill', 'read', 'run', 'tabs', 'translate', 'lens'].includes(name)
        if (needsTab) {
          const existingTabId = this.agentTabMap.get(agentId)
          if (existingTabId) {
            args.tabId = existingTabId
          } else {
            // Create a new tab for this agent via IPC to renderer
            try {
              const tabId = await this.createAgentTab()
              if (tabId) {
                this.agentTabMap.set(agentId, tabId)
                args.tabId = tabId
              }
            } catch {
              // Fall through to use active tab
            }
          }
        }
      }

      // Permission check
      const actionDesc = name === 'act' ? (args as any)?.action || name : name
      const targetDesc = (args as any)?.text || (args as any)?.url || (args as any)?.what || name
      const allowed = await this.permissionGate.check(actionDesc, `${name}: ${targetDesc}`)
      if (!allowed) {
        return {
          content: [{ type: 'text', text: `Action "${actionDesc}" was denied by permission gate.` }]
        }
      }

      // Handle proxy and recording actions directly in main process
      if (name === 'act') {
        const actAction = (args as any)?.action
        if (actAction === 'setProxy') {
          const pc = (args as any)?.proxy as ProxyConfig | undefined
          if (!pc || !pc.host || !pc.port || !pc.type) {
            return { content: [{ type: 'text', text: 'Error: proxy requires type, host, port. Pass proxy: {type, host, port, username?, password?, bypass?}' }], isError: true }
          }
          const proxyAllowed = await this.permissionGate.check('setProxy', `Route traffic through ${pc.host}:${pc.port}?`)
          if (!proxyAllowed) {
            return { content: [{ type: 'text', text: 'Action "setProxy" was denied by permission gate.' }] }
          }
          await this.proxyManager.setProxy(pc)
          const tr = await this.proxyManager.testProxy()
          const msg = tr.success
            ? `Proxy set: ${pc.type}://${pc.host}:${pc.port} — visible IP: ${tr.ip}`
            : `Proxy set: ${pc.type}://${pc.host}:${pc.port} — test failed: ${tr.error}`
          this.auditLog.log('setProxy', `${pc.host}:${pc.port}`, 'success', msg, 'act')
          return { content: [{ type: 'text', text: msg }] }
        }
        if (actAction === 'clearProxy') {
          const clearAllowed = await this.permissionGate.check('clearProxy', 'Stop using proxy?')
          if (!clearAllowed) {
            return { content: [{ type: 'text', text: 'Action "clearProxy" was denied by permission gate.' }] }
          }
          await this.proxyManager.clearProxy()
          this.auditLog.log('clearProxy', 'direct', 'success', 'Proxy cleared', 'act')
          return { content: [{ type: 'text', text: 'Proxy cleared — direct connection.' }] }
        }
        if (actAction === 'startRecording') {
          const recAllowed = await this.permissionGate.check('startRecording', 'Start recording all actions and screenshots?')
          if (!recAllowed) {
            return { content: [{ type: 'text', text: 'Action "startRecording" was denied by permission gate.' }] }
          }
          const sid = this.sessionRecorder.start()
          this.auditLog.log('startRecording', sid, 'success', 'Recording started', 'act')
          return { content: [{ type: 'text', text: `Recording started. Session ID: ${sid}` }] }
        }
        if (actAction === 'stopRecording') {
          const sess = this.sessionRecorder.stop()
          if (!sess) return { content: [{ type: 'text', text: 'No active recording to stop.' }] }
          this.auditLog.log('stopRecording', sess.id, 'success', `${sess.entries.length} entries`, 'act')
          return { content: [{ type: 'text', text: `Recording stopped. Session: ${sess.id} (${sess.entries.length} entries).` }] }
        }
      }

      // Auto-record tool calls when session recording is active
      if (this.sessionRecorder.isRecording()) {
        this.sessionRecorder.recordToolCall(name, args)
      }

      // Handle shell tool directly in main process
      if (name === 'shell') {
        if (!this.ptyManager) {
          return { content: [{ type: 'text', text: 'Error: Terminal not available.' }], isError: true }
        }
        const command = String(args.command || '')
        if (!command) {
          return { content: [{ type: 'text', text: 'Error: command is required.' }], isError: true }
        }
        const timeout = Math.min(Number(args.timeout) || 30_000, 120_000)
        const { output, exitCode } = await this.ptyManager.exec(command, timeout)

        // Strip ANSI escape codes for clean text output
        let cleaned = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
        // Cap at 10KB
        if (cleaned.length > 10240) cleaned = cleaned.substring(0, 10240) + '\n...[output truncated]'

        let result = `$ ${command}\n${cleaned}\n[exit code: ${exitCode}]`
        result = this.redactor.redact(result)
        result = this.antiInjection.sanitize(result)
        result = this.antiInjection.wrapContent(result)
        this.auditLog.log('shell', command, exitCode === 0 ? 'success' : 'failed', result.substring(0, 200), 'shell')
        return { content: [{ type: 'text', text: result }], isError: exitCode !== 0 }
      }

      // Handle preview tool directly in main process (no webview needed)
      if (name === 'preview') {
        const url = String(args.url || '')
        if (!url) {
          return { content: [{ type: 'text', text: 'Error: url is required.' }], isError: true }
        }
        try {
          const preview = await this.previewer.preview(url)
          let result = `Title: ${preview.title}\nDescription: ${preview.description}\nSnippet: ${preview.snippet.substring(0, 300)}`
          if (preview.ogImage) result += `\nImage: ${preview.ogImage}`
          result = this.redactor.redact(result)
          result = this.antiInjection.sanitize(result)
          result = this.antiInjection.wrapContent(result)
          this.auditLog.log('preview', url, 'success', result.substring(0, 200), 'preview')
          return { content: [{ type: 'text', text: result }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `Error previewing ${url}: ${(err as Error).message}` }], isError: true }
        }
      }

      // Handle research tool — composite (v0.3.0)
      if (name === 'research') {
        const topic = String(args.topic || '')
        if (!topic) return { content: [{ type: 'text', text: 'Error: topic is required.' }], isError: true }
        const maxPages = Number(args.maxPages) || (args.depth === 3 ? 8 : args.depth === 1 ? 3 : 5)

        try {
          // Step 1: Navigate to search
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(topic)}`
          await this.executeToolViaRenderer('act', { action: 'navigate', url: searchUrl })
          await new Promise(r => setTimeout(r, 2000))

          // Step 2: Read search results
          const searchResults = await this.executeToolViaRenderer('read', { what: 'search results', limit: maxPages, format: 'json' })

          // Step 3: Extract URLs from results
          let urls: string[] = []
          try {
            const parsed = JSON.parse(searchResults)
            if (Array.isArray(parsed)) {
              urls = parsed.slice(0, maxPages).map((r: any) => r.url || r.link || '').filter((u: string) => u.startsWith('http'))
            }
          } catch {
            // Parse the text format for URLs
            const urlMatches = searchResults.match(/https?:\/\/[^\s"'<>]+/g) || []
            urls = urlMatches.slice(0, maxPages)
          }

          if (urls.length === 0) {
            return { content: [{ type: 'text', text: `No search results found for "${topic}". Search page content:\n${searchResults.substring(0, 500)}` }] }
          }

          // Step 4: Read content from each URL
          const sources: { url: string; title: string; content: string }[] = []
          for (const url of urls.slice(0, maxPages)) {
            try {
              await this.executeToolViaRenderer('act', { action: 'navigate', url })
              await new Promise(r => setTimeout(r, 1500))
              const content = await this.executeToolViaRenderer('read', { what: 'article content' })
              const titleResult = await this.executeToolViaRenderer('page', {})
              const title = titleResult.split('\n')[0] || url
              sources.push({ url, title: title.substring(0, 100), content: content.substring(0, 1500) })
            } catch { /* skip failed pages */ }
          }

          // Step 5: Compile report
          let report = `# Research: ${topic}\n\n`
          report += `*${sources.length} sources analyzed*\n\n`
          for (let i = 0; i < sources.length; i++) {
            report += `## ${i + 1}. ${sources[i].title}\n`
            report += `Source: ${sources[i].url}\n\n`
            report += sources[i].content + '\n\n---\n\n'
          }

          let result = this.redactor.redact(report)
          result = this.antiInjection.sanitize(result)
          result = this.antiInjection.wrapContent(result)
          this.auditLog.log('research', topic, 'success', `${sources.length} sources`, 'research')
          return { content: [{ type: 'text', text: result }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `Research error: ${(err as Error).message}` }], isError: true }
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

      // --- Selector Cache: try cached selectors before executing ---
      let cacheUsed = false
      let cacheKey: string | null = null
      const isCacheable = (name === 'act' || name === 'fill') &&
        (name !== 'act' || !['navigate', 'back', 'forward', 'reload', 'scroll', 'press', 'screenshot', 'newTab', 'switchTab', 'closeTab', 'listTabs', 'evaluate', 'wait'].includes(String(args.action)))

      if (isCacheable) {
        try {
          const cacheResult = await this.trySelectorCache(name, args)
          if (cacheResult) {
            cacheUsed = true
            cacheKey = cacheResult.cacheKey
            // Use the cached selector — modify args to use the resolved CSS selector directly
            if (cacheResult.selector && name === 'act') {
              args = { ...args, selector: cacheResult.selector, _originalArgs: args }
            }
            debugLog(`[SelectorCache] HIT: ${cacheResult.cacheKey} → ${cacheResult.selector}`)
          } else {
            debugLog(`[SelectorCache] MISS: ${name} ${targetDesc}`)
          }
        } catch (err) {
          debugLog(`[SelectorCache] Error during cache lookup: ${(err as Error).message}`)
        }
      }

      // Execute tool via renderer IPC
      let result = await this.executeToolViaRenderer(name, args)

      // --- Selector Cache: record successful actions ---
      const isError = result.startsWith('Error:') || result.includes('not found') || result.includes('Element disappeared')
      if (isCacheable && !isError) {
        try {
          if (cacheUsed && cacheKey) {
            // Cache hit succeeded — reinforce
            this.selectorCache.markSuccess(cacheKey)
          }
          // Record selectors for this successful action
          await this.recordToSelectorCache(name, args, result)
        } catch (err) {
          debugLog(`[SelectorCache] Error recording: ${(err as Error).message}`)
        }
      } else if (isCacheable && isError && cacheUsed && cacheKey) {
        // Cache hit failed — mark failure
        this.selectorCache.markFailed(cacheKey)
        debugLog(`[SelectorCache] Cache selector failed, marked: ${cacheKey}`)
      }

      // Redact sensitive data
      result = this.redactor.redact(result)

      // Anti-injection
      result = this.antiInjection.sanitize(result)
      result = this.antiInjection.wrapContent(result)

      // Append cache metadata if cache was used
      if (cacheUsed) {
        result += '\n_cached: true'
      }

      // Audit log
      this.auditLog.log(actionDesc, targetDesc, 'success', result.substring(0, 200), name)

      // Record for pattern detection (pass full args for accurate step reconstruction)
      this.patternDetector?.recordToolCall(name, args, String(targetDesc))

      // Auto-record tool result when session recording is active
      if (this.sessionRecorder.isRecording()) {
        this.sessionRecorder.recordToolResult(name, result)
        // Record navigation events
        if (name === 'act' && (args as any)?.action === 'navigate' && (args as any)?.url) {
          this.sessionRecorder.recordNavigation(String((args as any).url))
        }
      }

      if (isHeadless) {
        headlessLog(`${name}: ${result.substring(0, 200)}`)
      }

      return { content: [{ type: 'text', text: result }] }
    } catch (err) {
      const errMsg = (err as Error).message
      this.auditLog.log(name, JSON.stringify(args).substring(0, 200), 'failed', errMsg, name)
      if (isHeadless) {
        headlessLog(`${name}: ERROR — ${errMsg}`)
      }
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
      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': 'null',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        })
        res.end()
        return
      }

      // Health check endpoint (no auth required — localhost-only liveness probe)
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', version: '0.4.1' }))
        return
      }

      // SSE streaming endpoint for long-running tool results
      if (req.url?.startsWith('/mcp/stream') && req.method === 'GET') {
        // Validate auth token from query string
        const url = new URL(req.url, `http://localhost:${this.actualPort}`)
        const token = url.searchParams.get('token') || req.headers.authorization?.replace('Bearer ', '')
        if (token !== this.authToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }

        // Set up SSE
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': 'null'
        })

        // Send heartbeat every 30s to keep connection alive
        const heartbeat = setInterval(() => {
          try { res.write('event: heartbeat\ndata: {}\n\n') } catch { clearInterval(heartbeat) }
        }, 30000)

        // Store this SSE connection for sending events
        const sseId = crypto.randomUUID()
        this.sseConnections.set(sseId, res)

        // Send initial connection event
        res.write(`event: connected\ndata: ${JSON.stringify({ id: sseId })}\n\n`)

        req.on('close', () => {
          clearInterval(heartbeat)
          this.sseConnections.delete(sseId)
        })
        return
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      // CORS: reject requests with non-localhost Origin
      const origin = req.headers.origin
      if (origin) {
        try {
          const originUrl = new URL(origin)
          if (!['localhost', '127.0.0.1', '::1'].includes(originUrl.hostname) && origin !== 'null') {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Forbidden: non-localhost origin' }))
            return
          }
        } catch {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Forbidden: invalid origin' }))
          return
        }
      }

      if (req.url === '/mcp') {
        const authHeader = req.headers['authorization'] || ''
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
        if (token !== this.authToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }

        // Rate limiting
        if (!this.rateLimiter.isAllowed(token)) {
          res.writeHead(429, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Rate limit exceeded. Max 200 requests per minute.' }))
          return
        }

        let body = ''
        let bodySize = 0
        const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10MB
        let destroyed = false

        req.on('data', (chunk: Buffer) => {
          bodySize += chunk.length
          if (bodySize > MAX_BODY_SIZE) {
            if (!destroyed) {
              destroyed = true
              res.writeHead(413, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Request body too large' }))
              req.destroy()
            }
            return
          }
          body += chunk.toString()
        })
        req.on('end', async () => {
          if (destroyed) return
          try {
            const request = JSON.parse(body)

            // Validate JSON-RPC structure
            if (!request.method || typeof request.method !== 'string') {
              res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'null' })
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32600, message: 'Invalid request: missing method' },
                id: request.id || null
              }))
              return
            }

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
              // Extract agent ID for multi-agent tab isolation
              const agentId = (req.headers['x-agent-id'] as string) || `anon-${req.socket.remotePort}`
              response = await this.handleToolCall(name, args || {}, agentId)
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

    this.httpServer.setTimeout(120000)

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
      fs.chmodSync(PORT_FILE, 0o600)
    } catch (err) {
      console.error('Oculo MCP server: failed to write port file:', err)
    }

    console.log(`Oculo MCP server listening on http://127.0.0.1:${this.actualPort}`)

    // Rate limiter cleanup
    this.rateLimiterCleanup = setInterval(() => this.rateLimiter.cleanup(), 300000)
  }

  /** Update provider configs for media generation API key lookup */
  setPtyManager(pty: PtyManager): void {
    this.ptyManager = pty
  }

  setProviderConfigs(configs: Map<string, AIProviderConfig>): void {
    this.providerConfigs = configs
    console.log(`[MCP] setProviderConfigs called — size=${configs.size} keys=[${[...configs.keys()]}] hasGeminiKey=${!!(configs.get('gemini')?.apiKey)}`)
  }

  /** Get proxy manager for IPC handler wiring */
  getProxyManager(): ProxyManager {
    return this.proxyManager
  }

  /** Get session recorder for IPC handler wiring */
  getSessionRecorder(): SessionRecorder {
    return this.sessionRecorder
  }

  // --- Selector Cache helpers ---

  /** Extract domain from a URL */
  private getDomainFromUrl(url: string): string {
    try { return new URL(url).hostname } catch { return 'unknown' }
  }

  /**
   * Try to resolve an element using cached selectors.
   * Returns the resolved CSS selector if found, or null if no cache hit.
   */
  private async trySelectorCache(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ selector: string; cacheKey: string } | null> {
    // Get the current page URL to determine domain
    let currentUrl: string
    try {
      currentUrl = await this.executeToolViaRenderer('_getUrl', {})
      if (!currentUrl || currentUrl.startsWith('Error:')) return null
    } catch { return null }

    const domain = this.getDomainFromUrl(currentUrl)
    const action = toolName === 'act' ? String(args.action || 'click') : 'fill'

    // Build hints from the tool args
    const hints = {
      text: args.text as string | undefined,
      role: args.role as string | undefined,
      name: args.name as string | undefined,
      label: args.label as string | undefined,
      placeholder: args.placeholder as string | undefined,
      selector: args.selector as string | undefined,
      ariaLabel: args.label as string | undefined
    }

    // Check if we have any hint to search by
    const hasHints = Object.values(hints).some(v => !!v)
    if (!hasHints) return null

    // Find cached entries
    const entries = this.selectorCache.resolve(domain, action, hints)
    if (!entries.length) return null

    // Take a DOM snapshot to check if page structure is similar enough
    try {
      const currentSnapshot = await this.takeDomSnapshot()
      if (currentSnapshot) {
        const cachedSnapshot = this.domSnapshots.get(domain)
        if (cachedSnapshot) {
          const diff = compare(cachedSnapshot, currentSnapshot)
          if (diff.strategy === 'recompute') {
            debugLog(`[SelectorCache] DOM changed significantly (${diff.similarity}%), skipping cache`)
            return null
          }
        }
        // Update stored snapshot (evict oldest if map is too large)
        if (this.domSnapshots.size > 100) {
          const oldest = this.domSnapshots.keys().next().value
          if (oldest) this.domSnapshots.delete(oldest)
        }
        this.domSnapshots.set(domain, currentSnapshot)
      }
    } catch { /* snapshot failed, still try cache */ }

    // Try each cached entry's resolution script
    for (const entry of entries.slice(0, 3)) { // Try top 3 matches
      try {
        const script = this.selectorCache.buildResolutionScript(entry)
        const resolution = await this.executeToolViaRenderer('_evalScript', { script })

        if (resolution && !resolution.startsWith('Error:')) {
          try {
            const parsed = JSON.parse(resolution)
            if (parsed.found && parsed.selector) {
              return { selector: parsed.selector, cacheKey: entry.key }
            }
          } catch { /* parse failed */ }
        }
      } catch { /* resolution failed, try next */ }
    }

    return null
  }

  /**
   * Record selectors from a successful action into the cache.
   * Extracts all possible selectors for the element that was just interacted with.
   */
  private async recordToSelectorCache(
    toolName: string,
    args: Record<string, unknown>,
    _result: string
  ): Promise<void> {
    let currentUrl: string
    try {
      currentUrl = await this.executeToolViaRenderer('_getUrl', {})
      if (!currentUrl || currentUrl.startsWith('Error:')) return
    } catch { return }

    const domain = this.getDomainFromUrl(currentUrl)
    const urlPattern = currentUrl.replace(/[?#].*$/, '*')
    const action = toolName === 'act' ? String(args.action || 'click') : 'fill'
    const actionDesc = `${action} ${args.text || args.label || args.placeholder || args.selector || ''}`

    // Build the selector bundle from what we know in args
    const bundle: SelectorBundle = {}
    if (args.text) bundle.textContent = String(args.text)
    if (args.role) bundle.role = String(args.role)
    if (args.name) bundle.name = String(args.name)
    if (args.label) bundle.ariaLabel = String(args.label)
    if (args.placeholder) bundle.placeholder = String(args.placeholder)
    if (args.selector) bundle.cssSelector = String(args.selector)
    if (args.ref) bundle.ref = String(args.ref)

    // Try to extract additional selectors from the page for the element we just acted on
    const originalArgs = (args._originalArgs || args) as Record<string, unknown>
    try {
      const enrichScript = this.buildEnrichScript(originalArgs)
      if (enrichScript) {
        const enrichResult = await this.executeToolViaRenderer('_evalScript', { script: enrichScript })
        if (enrichResult && !enrichResult.startsWith('Error:')) {
          try {
            const enriched = JSON.parse(enrichResult)
            if (enriched.id) bundle.id = enriched.id
            if (enriched.testId) bundle.testId = enriched.testId
            if (enriched.ariaLabel) bundle.ariaLabel = enriched.ariaLabel
            if (enriched.cssSelector) bundle.cssSelector = enriched.cssSelector
            if (enriched.tagName) bundle.tagName = enriched.tagName
            if (enriched.textContent) bundle.textContent = enriched.textContent
            if (enriched.placeholder) bundle.placeholder = enriched.placeholder
            if (enriched.role) bundle.role = enriched.role
            if (enriched.name) bundle.name = enriched.name
          } catch { /* parse failed */ }
        }
      }
    } catch { /* enrichment failed, record what we have */ }

    // Record it
    this.selectorCache.record(domain, urlPattern, action, actionDesc.trim(), bundle)

    // Update DOM snapshot for this domain
    try {
      const snapshot = await this.takeDomSnapshot()
      if (snapshot) {
        if (this.domSnapshots.size > 100) {
          const oldest = this.domSnapshots.keys().next().value
          if (oldest) this.domSnapshots.delete(oldest)
        }
        this.domSnapshots.set(domain, snapshot)
      }
    } catch { /* snapshot failed */ }
  }

  /**
   * Build a JS snippet that extracts all possible selectors for the last interacted element.
   * Returns null if no useful args to locate the element.
   */
  private buildEnrichScript(args: Record<string, unknown>): string | null {
    let locatorExpr: string | null = null

    if (args.selector) {
      locatorExpr = `document.querySelector(${JSON.stringify(String(args.selector))})`
    } else if (args.text) {
      const text = String(args.text).toLowerCase()
      locatorExpr = `(function(){var els=document.querySelectorAll('button,a,[role="button"],[role="link"],label,input[type="submit"],span,div,h1,h2,h3,h4,h5,h6,li,p');for(var i=0;i<els.length;i++){var t=(els[i].textContent||'').trim().toLowerCase();if(t===${JSON.stringify(text)}||t.includes(${JSON.stringify(text)}))return els[i]}return null})()`
    } else if (args.label) {
      const label = String(args.label).toLowerCase()
      locatorExpr = `document.querySelector('[aria-label=${JSON.stringify(label)}]')`
    } else if (args.placeholder) {
      locatorExpr = `document.querySelector('[placeholder*=${JSON.stringify(String(args.placeholder))}]')`
    } else {
      return null
    }

    return `(function(){
      var el = ${locatorExpr};
      if (!el) return JSON.stringify({});
      function getUniqueSelector(el){
        if(el.id)return'#'+CSS.escape(el.id);
        var path=[];var c=el;
        while(c&&c!==document.body){
          var s=c.tagName.toLowerCase();
          if(c.id){path.unshift('#'+CSS.escape(c.id));break}
          var p=c.parentElement;
          if(p){var sibs=Array.from(p.children).filter(function(x){return x.tagName===c.tagName});
          if(sibs.length>1)s+=':nth-of-type('+(sibs.indexOf(c)+1)+')'}
          path.unshift(s);c=c.parentElement
        }
        return path.join(' > ')
      }
      return JSON.stringify({
        id: el.id || null,
        testId: el.getAttribute('data-testid') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        cssSelector: getUniqueSelector(el),
        tagName: el.tagName.toLowerCase(),
        textContent: (el.textContent||'').trim().substring(0,60) || null,
        placeholder: el.getAttribute('placeholder') || null,
        role: el.getAttribute('role') || null,
        name: el.getAttribute('name') || null
      })
    })()`
  }

  /** Take a structural DOM snapshot via the renderer */
  private async takeDomSnapshot(): Promise<StructuralSnapshot | null> {
    try {
      const script = `(function(){
        function vis(el){if(!el)return false;var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&parseFloat(s.opacity)>0}
        function txt(el){return(el.textContent||'').trim().substring(0,40)}
        var headings=[];document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]').forEach(function(el){if(vis(el)){var t=txt(el);if(t)headings.push(t)}});
        var formLabels=[];document.querySelectorAll('label,[aria-label]').forEach(function(el){if(!vis(el))return;var t=el.getAttribute('aria-label')||txt(el);if(t&&t.length>1)formLabels.push(t.substring(0,30))});
        document.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(function(el){if(vis(el)){var p=el.getAttribute('placeholder');if(p)formLabels.push(p.substring(0,30))}});
        var buttonTexts=[];document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]').forEach(function(el){if(!vis(el))return;var t=txt(el)||el.getAttribute('value')||el.getAttribute('aria-label')||'';t=t.substring(0,30);if(t&&t.length>1)buttonTexts.push(t)});
        var linkTexts=[];document.querySelectorAll('a,[role="link"]').forEach(function(el){if(!vis(el))return;var t=txt(el);if(t&&t.length>1)linkTexts.push(t.substring(0,25))});linkTexts=linkTexts.slice(0,20);
        var interactiveCount=document.querySelectorAll('button,a,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]').length;
        return JSON.stringify({url:location.href,headings:headings.slice(0,10),formLabels:formLabels.slice(0,15),buttonTexts:buttonTexts.slice(0,15),linkTexts:linkTexts,interactiveCount:interactiveCount,timestamp:Date.now()})
      })()`
      const resultStr = await this.executeToolViaRenderer('_evalScript', { script })
      if (resultStr && !resultStr.startsWith('Error:')) {
        return JSON.parse(resultStr) as StructuralSnapshot
      }
    } catch { /* snapshot failed */ }
    return null
  }

  /** Get selector cache statistics */
  getSelectorCacheStats(): { total: number; active: number; invalidated: number; hitRate: string } {
    return this.selectorCache.stats()
  }

  /** Rotate auth token — regenerates and updates port file */
  rotateToken(): void {
    this.authToken = crypto.randomBytes(32).toString('hex')
    if (this.actualPort) {
      try {
        fs.writeFileSync(PORT_FILE, `${this.actualPort}:${this.authToken}`)
        fs.chmodSync(PORT_FILE, 0o600)
        debugLog('Auth token rotated')
      } catch (err) {
        console.error('Failed to write rotated token:', err)
      }
    }
  }

  /** Send an event to all connected SSE clients */
  private broadcastSSE(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const [id, res] of this.sseConnections) {
      try {
        res.write(payload)
      } catch {
        this.sseConnections.delete(id)
      }
    }
  }

  stop(): void {
    // Close SSE connections
    for (const [, res] of this.sseConnections) {
      try { res.end() } catch { /* best-effort */ }
    }
    this.sseConnections.clear()
    // Flush selector cache on shutdown
    this.selectorCache.flush()
    if (this.rateLimiterCleanup) { clearInterval(this.rateLimiterCleanup); this.rateLimiterCleanup = null }
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
