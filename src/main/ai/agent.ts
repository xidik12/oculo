import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import http from 'http'
import https from 'https'
import path from 'path'
import os from 'os'
import { BrowserWindow } from 'electron'
import { ChatMessage, ChatToolCall, ChatStreamEvent } from '../../shared/types'
import { AIProviderId, AIProviderStatus, AIProviderConfig } from '../../shared/ai-types'
import { OAuthManager } from './oauth-manager'
import { LessonStore } from './lessons'

const PORT_FILE = path.join(os.homedir(), '.oculo-port')

/** Safely truncate a string without splitting emoji/surrogate pairs */
function safeTruncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  // Use Array.from to split by code points (not code units), then rejoin
  const chars = Array.from(str)
  if (chars.length <= maxLen) return str
  return chars.slice(0, maxLen).join('')
}

/**
 * System prompt for Oculo's AI.
 * IMPORTANT: Must start with the Claude Code identification string
 * for OAuth subscription authentication to work.
 */
const SYSTEM_PROMPT = `You are Oculo, an AI browser assistant. You control the browser through tools to complete tasks.

TOOLS:
- page: See what's on screen. Default: compact (~30-80 tokens). Use detail="a11y" for accessibility tree — better for complex React forms.
- act: Browser actions — click, type, navigate, scroll, press, screenshot, upload, download, autoLogin, extractPDF, monitorNetwork, monitorWebSocket, checkDialogs, printToPDF
- fill: Fill form fields by visible label text. Pass {fields: {"Label": "value"}}
- read: Extract text/lists/tables from the page
- run: Execute multiple steps in sequence
- media: Generate images or videos from text prompts. Returns saved file path.
  - Images: Nano Banana 2 (default), Nano Banana Pro (best quality), Nano Banana (fastest), DALL-E 3, Stability AI
  - Videos: Veo 3.1 (async, 4-8 sec, 720p) — polls until ready, saves MP4
  - All use the Gemini API key from Settings. OpenAI/Stability need their own keys.

MEDIA WORKFLOW (generate → upload → post):
- Generate image: media({type:"image", prompt:"..."}) → returns file path
- Generate video: media({type:"video", prompt:"...", duration:6}) → returns file path (takes 11s-6min)
- Screenshot: act({action:"screenshot"}) → returns file path
- Upload any of them: act({action:"upload", selector:"input[type=file]", value:"/path/from/above"})
- Example: "Post about Oculo on X with an image" → media to generate → navigate to X → compose tweet → upload image → click Post

CRITICAL RULES:
- NEVER regenerate media if you already have a file path from a previous media/screenshot call. Reuse the path.
- After uploading an image/file to a compose box, your NEXT step is to click the Post/Submit/Send button. Do NOT loop.
- When a task has a clear final action (Post, Submit, Send, Publish), execute it immediately — don't restart the workflow.
- For knowledge/research questions, use what you already know FIRST. Only browse if you genuinely need live data.
- Minimize tool calls. Each call should make concrete progress. If you're repeating an action, STOP and try a different approach.
- NEVER click the same button or perform the same action more than twice in a row.

HOW TO WORK:
1. Call page to see the current state — it shows numbered clickable elements (#1, #2, etc.)
2. Click by ref number: act({action:"click", text:"#3"}) — fastest and most reliable
3. Use fill with ALL fields at once for forms
4. Every action auto-returns the current page state — you rarely need to call page again
5. If fill fails on a complex form, call page({detail:"a11y"}) to get the accessibility tree, then use CSS selectors

ERROR RECOVERY:
- If an action fails, NEVER retry the exact same action. Try a different approach:
  1. Use page({detail:"a11y"}) to see the full accessibility tree
  2. Try a CSS selector instead of text: act({action:"click", selector:"button.submit"})
  3. Try act type with selector instead of fill for React controlled inputs
- If fill can't find fields, the page might use React/generated IDs. Use page({detail:"a11y"}) to see field names, then use CSS selectors as fill keys: fill({fields:{"#field-id":"value"}})

ASK THE USER when you encounter:
- Questions with choices (Yes/No, Yep/Nope, options) — read the question text nearby and ask the user what to choose
- Decisions that affect their account (privacy settings, billing, open-source licensing)
- Irreversible actions (delete, submit payment, publish publicly)
- Anything ambiguous where you're unsure what they want
Do NOT blindly click Yes/Yep/OK/Confirm without understanding the question.

TIPS:
- Clickable elements are numbered (#1, #2...). Click by number: act({action:"click", text:"#5"})
- Each element shows context: '#3 button: Yep — "Is this open source?"' tells you what the button does
- Fill ALL form fields at once: fill({fields:{"Ship Name":"Oculo","URL":"https://oculo.app"}})
- For file uploads: act({action:"upload", selector:"input[type=file]", value:"/path/to/file"})
- Rich text editors: act({action:"type", selector:"[contenteditable]", text:"..."})
- Don't use devtools unless the user asks to inspect/debug something
- After each action you get the current page state automatically — don't call page unless the state is unclear
- NEVER reload or navigate to the same URL while filling a form — you'll lose all entered data
- If a button isn't visible, just click it — the browser will auto-scroll to it
- The user may interact with the page while you work — adapt and continue
- When the user answers a question (like "no" to open source), remember it — don't ask again
- Keep responses to 1-2 sentences
- Auto-login: act({action:"autoLogin"}) detects login forms and fills from vault (supports TOTP 2FA)
- PDF extraction: act({action:"extractPDF"}) extracts text from PDF pages
- Network monitoring: act({action:"monitorNetwork"}) intercepts fetch/XHR requests
- WebSocket monitoring: act({action:"monitorWebSocket"}) captures WS/SSE messages

LEARNING:
When the user corrects you or you discover something important about how a website works, call the learn tool to remember it.
Examples of when to learn:
- User says "don't click that" → learn("On shipordie.club, 'Yep/Nope' buttons are for the open source question, not for submitting")
- You discover a form needs a specific flow → learn("shipordie.club: must click My Fleet → + NEW SHIP before form appears")
- A fill approach fails → learn("React apps need act type with selector instead of fill for controlled inputs")
Your lessons persist across sessions — you get smarter over time.`

/**
 * Anthropic tool format for the 5 MCP browser tools
 */
const ANTHROPIC_TOOLS = [
  {
    name: 'page',
    description: 'Get current page info. Default: compact (URL, headings, fields, buttons, links ~30-80 tokens). Use detail="a11y" for full accessibility tree — better for complex forms.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scope: { type: 'string', description: 'CSS selector to scope to a section' },
        detail: { type: 'string', enum: ['compact', 'a11y'], description: 'compact (default) or a11y (accessibility tree ~200-500 tokens)' }
      }
    }
  },
  {
    name: 'act',
    description: 'Perform browser action. type=insert text (rich editors). clickAtPoint=cross-origin iframes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: [
            'click', 'doubleClick', 'tripleClick', 'rightClick', 'clickAtPoint',
            'type', 'focus', 'clear', 'selectAll', 'copy', 'paste',
            'navigate', 'back', 'forward', 'reload', 'newTab',
            'scroll', 'scrollIntoView', 'smartScroll', 'press', 'hover', 'select',
            'wait', 'waitForElement', 'waitForText', 'waitForNetworkIdle', 'dragAndDrop',
            'evaluate', 'getAttribute', 'upload', 'login', 'autoLogin',
            'screenshot', 'screenshotSoM', 'screenshotElement', 'switchTab', 'closeTab', 'listTabs',
            'download', 'listDownloads', 'readFile', 'clipboardImage',
            'monitorNetwork', 'visualDiff', 'detectAPIs', 'iframeNavigate',
            'recordStart', 'recordStop',
            'extractPDF', 'monitorWebSocket',
            'checkDialogs', 'printToPDF',
            'getCookies', 'setCookie', 'deleteCookie', 'getStorage', 'setStorage', 'clearStorage', 'interceptNetwork'
          ]
        },
        text: { type: 'string', description: 'Element text or text to type/evaluate' },
        selector: { type: 'string', description: 'CSS selector' },
        url: { type: 'string' },
        x: { type: 'number' }, y: { type: 'number' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number' },
        key: { type: 'string' },
        modifiers: { type: 'array', items: { type: 'string' } },
        value: { type: 'string', description: 'Value for select, file path(s) for upload, URL for download, file path for readFile' },
        nth: { type: 'number' }
      },
      required: ['action']
    }
  },
  {
    name: 'fill',
    description: 'Fill form fields by visible label text. For rich text editors use act type instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fields: { type: 'object', description: 'Object: visible label text → value. Use labels shown on page, NOT internal IDs. E.g. {"Company Name":"Oculo","Email":"hi@oculo.com"}. Use "#id" or "[name=x]" CSS selectors for unlabeled fields.' },
        submit: { description: 'true or button text' }
      },
      required: ['fields']
    }
  },
  {
    name: 'read',
    description: 'Extract structured data from page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        what: { type: 'string', description: 'What to extract' },
        scope: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['what']
    }
  },
  {
    name: 'run',
    description: 'Multi-step pipeline. Successful runs are cached — use workflow ID to replay instantly. Each step: {page:{}}, {act:{}}, {fill:{}}, {read:{}}, {wait:{}}.',
    input_schema: {
      type: 'object' as const,
      properties: {
        steps: { type: 'array', items: { type: 'object' } },
        workflow: { type: 'string', description: 'Replay cached workflow by ID' },
        description: { type: 'string', description: 'What this pipeline does (for caching)' },
        returnAll: { type: 'boolean' }
      },
      required: ['steps']
    }
  },
  {
    name: 'devtools',
    description: 'DevTools: console, inspect, evaluate, errors, performance, network, dom.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['open', 'close', 'toggle', 'console', 'inspect', 'evaluate', 'errors', 'performance', 'network', 'dom'] },
        selector: { type: 'string' },
        expression: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['action']
    }
  },
  {
    name: 'media',
    description: 'Generate images (Nano Banana 2 / DALL-E 3) or videos (Veo 3.1). Returns saved file path. Uses Gemini API key.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['image', 'video'], description: 'Generate image or video' },
        prompt: { type: 'string', description: 'What to create' },
        model: { type: 'string', description: 'Image model: nano-banana-2 (default), nano-banana-pro (best quality), nano-banana (fastest)' },
        size: { type: 'string', description: 'Image: 1024x1024, 2K, 4K. Video: 16:9, 9:16' },
        style: { type: 'string', description: 'natural, vivid, cinematic, anime' },
        provider: { type: 'string', description: 'Override: gemini, openai, stability' },
        duration: { type: 'number', description: 'Video duration: 4, 6, or 8 seconds' }
      },
      required: ['type', 'prompt']
    }
  },
  {
    name: 'learn',
    description: 'Save a lesson for future sessions. Call when the user corrects you or you discover how a website works.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lesson: { type: 'string', description: 'What you learned (be specific — include the website name and what to do/not do)' }
      },
      required: ['lesson']
    }
  }
]

/**
 * Multi-provider AI Agent Controller with MCP browser tool support.
 *
 * Claude supports TWO auth modes (tried in order):
 *   1. OAuth subscription (instant — reads token from macOS keychain, uses user's Claude Max/Pro)
 *   2. API key (instant — direct HTTPS, user provides key in Settings)
 *
 * OpenAI supports TWO auth modes (tried in order):
 *   1. Codex CLI subscription (reads token from ~/.codex/auth.json, uses user's ChatGPT Plus/Pro)
 *   2. API key (user-provided)
 *
 * Other providers: Direct HTTPS API calls with API keys.
 */
export class AgentController {
  private mainWindow: BrowserWindow
  private claudePath: string | null = null
  private shellEnv: Record<string, string> | null = null
  private oauth = new OAuthManager()
  private lessons = new LessonStore()
  private messageCount = 0
  private activeProvider: AIProviderId = 'claude'
  private activeModel: string = 'claude-sonnet-4-6'
  private providerConfigs: Map<AIProviderId, AIProviderConfig> = new Map()
  private currentAbort: AbortController | null = null
  private conversationHistory: Array<{ role: string; content: any }> = []
  private persistFn: ((configs: Record<string, any>) => void) | null = null

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
    this.oauth.setMainWindow(mainWindow)
    this.initShellEnv()
    this.oauth.loadOAuthToken()
    this.oauth.loadCodexToken(this.providerConfigs)
  }

  /** Wire up persistence — called from index.ts after SecurityManager is ready */
  setPersistence(
    save: (configs: Record<string, any>) => void,
    initial?: Record<string, { apiKey?: string; enabled?: boolean; modelId?: string }>
  ): void {
    this.persistFn = save
    // Restore saved configs
    if (initial) {
      for (const [id, cfg] of Object.entries(initial)) {
        this.providerConfigs.set(id as AIProviderId, {
          providerId: id as AIProviderId,
          apiKey: cfg.apiKey || '',
          enabled: cfg.enabled ?? true,
          modelId: cfg.modelId
        } as AIProviderConfig)
      }
    }
  }

  /** Get the dynamic system prompt with learned lessons appended */
  private getSystemPrompt(): string {
    return SYSTEM_PROMPT + this.lessons.toPromptSection()
  }

  // === Shell env for CLI mode ===

  private initShellEnv(): void {
    const isWin = process.platform === 'win32'
    const home = process.env['HOME'] || process.env['USERPROFILE'] || ''
    const sep = isWin ? ';' : ':'

    const extraPaths = isWin
      ? [
          `${home}\\AppData\\Roaming\\npm`,
          `${home}\\.claude\\bin`,
          `${home}\\AppData\\Local\\Programs\\claude`,
        ]
      : [
          `${home}/.local/bin`,
          `${home}/.claude/bin`,
          `${home}/.npm-global/bin`,
          '/usr/local/bin',
        ]
    const currentPath = process.env['PATH'] || (isWin ? '' : '/usr/bin:/bin')

    let shellPath = ''
    if (!isWin) {
      try {
        const shell = process.env['SHELL'] || '/bin/zsh'
        shellPath = execFileSync(shell, ['-lc', 'echo $PATH'], {
          encoding: 'utf-8', timeout: 5000
        }).trim()
      } catch { /* ignore */ }
    }

    const allPaths = [...extraPaths, ...shellPath.split(sep), ...currentPath.split(sep)]
    const seen = new Set<string>()
    const dedupedPath = allPaths.filter(p => { if (!p || seen.has(p)) return false; seen.add(p); return true }).join(sep)

    this.shellEnv = { ...process.env, PATH: dedupedPath, FORCE_COLOR: '0' }
    delete this.shellEnv['CLAUDECODE']
    delete this.shellEnv['CLAUDE_CODE_ENTRY_POINT']

    this.claudePath = this.findClaude(dedupedPath)
    if (this.claudePath) this.oauth.checkClaudeAuth(this.claudePath, this.getEnv())
  }

  private getEnv(): Record<string, string> {
    if (!this.shellEnv) this.initShellEnv()
    return this.shellEnv!
  }

  private findClaude(pathVar: string): string | null {
    const isWin = process.platform === 'win32'
    const home = process.env['HOME'] || process.env['USERPROFILE'] || ''
    const ext = isWin ? '.exe' : ''
    const knownLocations = isWin
      ? [
          `${home}\\AppData\\Roaming\\npm\\claude${ext}`,
          `${home}\\.claude\\bin\\claude${ext}`,
          `${home}\\AppData\\Local\\Programs\\claude\\claude${ext}`,
        ]
      : [
          `${home}/.local/bin/claude`,
          `${home}/.claude/bin/claude`,
          '/usr/local/bin/claude',
          `${home}/.npm-global/bin/claude`,
        ]
    for (const loc of knownLocations) {
      if (existsSync(loc)) return loc
    }
    const sep = isWin ? ';' : ':'
    const pathDirs = pathVar.split(sep).filter(Boolean)
    for (const dir of pathDirs) {
      const candidate = path.join(dir, `claude${ext}`)
      try { if (existsSync(candidate)) return candidate } catch { /* skip */ }
    }
    return null
  }

  async startClaudeAuth(): Promise<{ success: boolean; error?: string }> {
    return this.oauth.startClaudeAuth()
  }

  async startCodexAuth(): Promise<{ success: boolean; error?: string }> {
    return this.oauth.startCodexAuth()
  }

  // === MCP Tool Execution (calls local Oculo HTTP server) ===

  private getMcpConnection(): { port: number; token: string } | null {
    try {
      const raw = readFileSync(PORT_FILE, 'utf-8').trim()
      const colonIdx = raw.indexOf(':')
      if (colonIdx === -1) return null
      const port = parseInt(raw.substring(0, colonIdx), 10)
      const token = raw.substring(colonIdx + 1)
      return Number.isFinite(port) ? { port, token } : null
    } catch {
      return null
    }
  }

  private async callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
    // Handle learn tool locally — no MCP needed
    if (name === 'learn') {
      const lesson = String(args.lesson || '')
      if (!lesson) return 'Error: lesson text is required'
      return this.lessons.add(lesson)
    }

    const conn = this.getMcpConnection()
    if (!conn) return 'Error: Oculo MCP server not running. Cannot interact with browser.'

    return new Promise((resolve) => {
      const body = JSON.stringify({ method: 'tools/call', params: { name, arguments: args } })
      const req = http.request({
        hostname: '127.0.0.1',
        port: conn.port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${conn.token}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          try {
            const result = JSON.parse(data)
            if (result.content) {
              const texts = result.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
              resolve(texts.join('\n') || 'Done.')
            } else {
              resolve(data)
            }
          } catch {
            resolve(data || 'Tool call completed.')
          }
        })
      })
      req.on('error', (err) => resolve(`Error calling tool: ${err.message}`))
      // Media generation can take 10-60s+ (Veo 3.1 up to 6min), screenshots/uploads need time too
      const timeout = (name === 'media') ? 600_000 : 120_000
      req.setTimeout(timeout, () => { req.destroy(); resolve(`Tool call timed out after ${timeout / 1000}s`) })
      req.write(body)
      req.end()
    })
  }

  // === Provider Management ===

  setActiveProvider(providerId: AIProviderId, modelId?: string): void {
    this.activeProvider = providerId
    if (modelId) this.activeModel = modelId
    this.conversationHistory = []
    this.messageCount = 0
  }

  setProviderConfig(config: AIProviderConfig): void {
    this.providerConfigs.set(config.providerId, config)
    // Persist to disk
    if (this.persistFn) {
      const serialized: Record<string, any> = {}
      for (const [id, cfg] of this.providerConfigs) {
        serialized[id] = { apiKey: cfg.apiKey, enabled: cfg.enabled, modelId: (cfg as any).modelId }
      }
      this.persistFn(serialized)
    }
  }

  /** Get all provider configs (for media generation API key lookup) */
  getProviderConfigs(): Map<AIProviderId, AIProviderConfig> {
    return this.providerConfigs
  }

  getLessons(): Array<{ id: string; text: string; timestamp: number }> {
    return this.lessons.getAll()
  }

  removeLesson(id: string): boolean {
    return this.lessons.remove(id)
  }

  getProviderStatus(providerId: AIProviderId): AIProviderStatus {
    if (providerId === 'claude') {
      const config = this.providerConfigs.get('claude')
      const hasApiKey = !!(config?.apiKey)

      if (hasApiKey) {
        return { providerId: 'claude', connected: true, ready: true, authMode: 'api-key' }
      }

      // Check OAuth subscription token
      const oauthToken = this.oauth.getOAuthToken()
      if (oauthToken) {
        return { providerId: 'claude', connected: true, ready: true, authMode: 'subscription' }
      }

      // Check CLI
      if (!this.claudePath) {
        return {
          providerId: 'claude', connected: false, ready: false,
          error: 'Add an API key in Settings.',
          authMode: 'api-key'
        }
      }
      if (this.oauth.claudeAuthChecked && !this.oauth.claudeLoggedIn) {
        return {
          providerId: 'claude', connected: true, ready: false,
          error: 'Add an API key in Settings.',
          authMode: 'api-key'
        }
      }
      return { providerId: 'claude', connected: true, ready: this.oauth.claudeLoggedIn, authMode: 'subscription' }
    }

    // OpenAI: check API key first, then Codex subscription
    if (providerId === 'openai') {
      const config = this.providerConfigs.get('openai')
      const hasApiKey = !!(config?.apiKey)

      if (hasApiKey) {
        return { providerId: 'openai', connected: true, ready: true, authMode: 'api-key' }
      }

      if (this.oauth.codexToken) {
        return { providerId: 'openai', connected: true, ready: true, authMode: 'subscription',
          error: undefined }
      }

      return {
        providerId: 'openai', connected: false, ready: false,
        error: 'Add an API key in Settings.',
        authMode: 'api-key'
      }
    }

    if (providerId === 'ollama') {
      // Ollama is always "ready" — it runs locally, no API key needed
      return { providerId: 'ollama', connected: true, ready: true, authMode: 'api-key' }
    }

    const config = this.providerConfigs.get(providerId)
    const hasKey = !!(config?.apiKey)
    return {
      providerId,
      connected: hasKey,
      ready: hasKey && (config?.enabled ?? false),
      error: hasKey ? undefined : `API key not configured. Add it in Settings.`
    }
  }

  getActiveProvider(): { providerId: AIProviderId; modelId: string } {
    return { providerId: this.activeProvider, modelId: this.activeModel }
  }

  // === Message Handling ===

  async handleMessage(userText: string): Promise<void> {
    this.messageCount++
    this.conversationHistory.push({ role: 'user', content: userText })

    if (this.activeProvider === 'claude') {
      // Priority 1: OAuth subscription token
      const oauthToken = this.oauth.getOAuthToken()
      if (oauthToken) {
        return this.handleAnthropicWithTools(oauthToken, 'oauth')
      }

      // Priority 2: API key
      const config = this.providerConfigs.get('claude')
      if (config?.apiKey) {
        return this.handleAnthropicWithTools(config.apiKey, 'api-key')
      }

      // Priority 3: No auth available
      this.emit({
        type: 'error',
        error: 'Not authenticated with Claude.\n\nAdd an API key in Settings > AI Providers.'
      })
      return
    }

    if (this.activeProvider === 'openai') {
      // Priority 1: API key
      const config = this.providerConfigs.get('openai')
      if (config?.apiKey) {
        return this.handleOpenAIWithTools(config.apiKey, 'api-key')
      }

      // Priority 2: Codex CLI subscription token
      const codexToken = await this.oauth.getCodexToken()
      if (codexToken) {
        return this.handleOpenAIWithTools(codexToken, 'oauth')
      }

      // Priority 3: No auth available
      this.emit({
        type: 'error',
        error: 'Not authenticated with OpenAI.\n\nAdd an API key in Settings > AI Providers.'
      })
      return
    }

    if (this.activeProvider === 'ollama') {
      return this.handleOllamaMessage(userText)
    }

    return this.handleAPIMessage(userText)
  }

  // === Anthropic API with tool-use loop (works for both API key and OAuth) ===

  private async handleAnthropicWithTools(token: string, authMode: 'api-key' | 'oauth'): Promise<void> {
    this.currentAbort = new AbortController()
    const MAX_TOOL_ROUNDS = 15

    try {
      let fullAssistantText = ''
      let totalInputTokens = 0
      let totalOutputTokens = 0
      let lastToolSignature = '' // Track duplicate calls
      let consecutiveDupes = 0
      const toolCallCounts: Record<string, number> = {} // Track how many times each tool is called
      const mediaFilePaths: string[] = [] // Track generated media file paths

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        this.pruneHistory()
        console.log(`[Oculo] round=${round + 1} history=${this.conversationHistory.length}msgs`)

        const response = await this.callAnthropicRaw(token, authMode)
        totalInputTokens += response.inputTokens
        totalOutputTokens += response.outputTokens

        let roundText = ''
        const toolUses: Array<{ id: string; name: string; input: any }> = []

        for (const block of response.content) {
          if (block.type === 'text') {
            roundText += block.text
          } else if (block.type === 'tool_use') {
            toolUses.push({ id: block.id, name: block.name, input: block.input })
          }
        }

        console.log(`[Oculo] round=${round + 1} stop=${response.stop_reason} text=${roundText.length}chars tools=${toolUses.length} tokens=${response.inputTokens}+${response.outputTokens}`)

        fullAssistantText += roundText
        this.conversationHistory.push({ role: 'assistant', content: response.content })

        if (toolUses.length === 0) {
          console.log(`[Oculo] No tools, finishing. fullText=${fullAssistantText.length}chars`)
          break
        }

        // Detect duplicate tool calls (same name + same args = stuck in a loop)
        const currentSig = toolUses.map(t => `${t.name}:${JSON.stringify(t.input)}`).join('|')
        if (currentSig === lastToolSignature) {
          consecutiveDupes++
          if (consecutiveDupes >= 1) {
            console.log(`[Oculo] Detected stuck loop — same tools called ${consecutiveDupes + 1} times in a row. Breaking.`)
            const stuckMsg = "\n\nI notice I'm repeating the same actions. Let me stop here — what would you like me to do next?"
            fullAssistantText += stuckMsg
            this.emit({ type: 'text_delta', text: stuckMsg })
            break
          }
        } else {
          consecutiveDupes = 0
        }
        lastToolSignature = currentSig

        // Track tool call counts and intercept redundant media calls
        for (const tool of toolUses) {
          toolCallCounts[tool.name] = (toolCallCounts[tool.name] || 0) + 1
        }

        // Block redundant media calls — if we already generated media this session, inject the existing path
        const filteredToolUses = toolUses.map(tool => {
          if (tool.name === 'media' && mediaFilePaths.length > 0 && toolCallCounts['media']! > 1) {
            console.log(`[Oculo] Blocking redundant media call — already generated ${mediaFilePaths.length} file(s). Returning existing path.`)
            return { ...tool, _intercepted: true, _result: `Image already generated this session: ${mediaFilePaths[mediaFilePaths.length - 1]}. Use this path for upload — do NOT regenerate.` }
          }
          return { ...tool, _intercepted: false, _result: '' }
        })

        // Execute tool calls
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []

        for (const tool of filteredToolUses) {
          this.emit({ type: 'tool_use_start', toolCall: { id: tool.id, name: tool.name, input: tool.input || {}, status: 'running' } })

          let result: string
          if (tool._intercepted) {
            result = tool._result
          } else {
            result = await this.callMcpTool(tool.name, tool.input || {})
          }

          // Track media file paths from successful generation
          if (tool.name === 'media' && !tool._intercepted && !result.startsWith('Error')) {
            const pathMatch = result.match(/:\s*(\/[^\s]+\.(png|jpg|jpeg|webp|mp4|gif))/)
            if (pathMatch) mediaFilePaths.push(pathMatch[1])
          }

          this.emit({ type: 'tool_use_result', toolCallId: tool.id, result, isError: result.startsWith('Error') })

          // Cap tool result stored in history — info tools need more, action tools less
          const infoTool = tool.name === 'page' || tool.name === 'read' || tool.name === 'devtools'
          const maxLen = infoTool ? 1200 : 500
          const cappedResult = result.length > maxLen ? safeTruncate(result, maxLen - 20) + '...[truncated]' : result
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: cappedResult })
        }

        this.conversationHistory.push({ role: 'user', content: toolResults })
      }

      // If we hit the round limit, tell the user
      if (fullAssistantText && !fullAssistantText.includes('reached the limit')) {
        // Check if last iteration was cut off by max rounds (toolUses existed)
        const lastMsg = this.conversationHistory[this.conversationHistory.length - 1]
        const hadTools = lastMsg && Array.isArray(lastMsg.content) && lastMsg.content.some((c: any) => c.type === 'tool_result')
        if (hadTools) {
          const limitMsg = '\n\nI reached my tool call limit. Let me know if you want me to continue.'
          fullAssistantText += limitMsg
          this.emit({ type: 'text_delta', text: limitMsg })
        }
      }

      // Emit token usage before done
      if (totalInputTokens > 0 || totalOutputTokens > 0) {
        this.emit({ type: 'usage', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } })
      }

      this.emit({
        type: 'done',
        message: { id: crypto.randomUUID(), role: 'assistant', content: fullAssistantText, timestamp: Date.now() }
      })
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        // If OAuth fails, clear the token so we don't keep trying
        if (authMode === 'oauth' && err.message?.includes('401')) {
          this.oauth.oauthToken = null
        }
        this.emit({ type: 'error', error: err.message || 'Request failed' })
      }
    } finally {
      this.currentAbort = null
    }
  }

  private summarizeToolArgs(name: string, input: any): string {
    if (!input) return ''
    if (name === 'act') return `→ ${input.action || ''}${input.text ? ` "${input.text}"` : ''}${input.url ? ` ${input.url}` : ''}`
    if (name === 'fill') return `→ ${Object.keys(input.fields || {}).join(', ')}`
    if (name === 'read') return `→ "${input.what || ''}"`
    if (name === 'run') return `→ ${(input.steps || []).length} steps`
    if (name === 'devtools') return `→ ${input.action || ''}${input.selector ? ` "${input.selector}"` : ''}${input.expression ? ` "${input.expression.substring(0, 40)}"` : ''}`
    return ''
  }

  /**
   * Prune conversation history to limit token growth.
   * Keeps the first user message and the last 4 messages in full.
   * Older tool results are truncated to 100 chars.
   * Older assistant content blocks are kept (they contain tool_use IDs that must match tool_results).
   */
  private pruneHistory(): void {
    const history = this.conversationHistory
    if (history.length <= 6) return

    const MAX_HISTORY = 14 // Max messages before dropping old pairs

    // Phase 1: Drop oldest [assistant, user_tool_result] pairs if history is too long
    // Always keep history[0] (original user task)
    // NEVER drop user text messages (short answers like "no", "yes", corrections) — only drop tool_result pairs
    while (history.length > MAX_HISTORY && history.length >= 3) {
      // Find the first droppable pair — assistant + user_tool_result (not a user text message)
      let dropped = false
      for (let i = 1; i < history.length - 4 && i + 1 < history.length; i++) {
        const isAssistant = history[i]?.role === 'assistant'
        const nextIsToolResult = history[i + 1]?.role === 'user' && Array.isArray(history[i + 1]?.content)
        if (isAssistant && nextIsToolResult) {
          history.splice(i, 2)
          dropped = true
          break
        }
      }
      if (!dropped) break // No more droppable pairs
    }

    // Phase 2: Truncate content in older messages (keep last 2 messages full)
    const keepFullFromEnd = 4
    const cutoff = Math.max(1, history.length - keepFullFromEnd)

    for (let i = 1; i < cutoff; i++) {
      const msg = history[i]
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        msg.content = msg.content.map((item: any) => {
          if (item.type === 'tool_result' && typeof item.content === 'string' && item.content.length > 200) {
            return { ...item, content: safeTruncate(item.content, 150) + '...[t]' }
          }
          return item
        })
      } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        msg.content = msg.content.map((item: any) => {
          if (item.type === 'text' && typeof item.text === 'string' && item.text.length > 150) {
            return { ...item, text: safeTruncate(item.text, 120) + '...' }
          }
          return item
        })
      } else if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.length > 50) {
        msg.content = safeTruncate(msg.content, 40) + '...'
      }
    }
  }

  // === OpenAI API with tool-use loop (works for both API key and Codex subscription) ===

  private async handleOpenAIWithTools(token: string, authMode: 'api-key' | 'oauth'): Promise<void> {
    this.currentAbort = new AbortController()
    const MAX_TOOL_ROUNDS = 25

    // Convert our 5 MCP tools to OpenAI function calling format
    const openaiTools = ANTHROPIC_TOOLS.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema
      }
    }))

    try {
      let fullAssistantText = ''
      let lastToolSignature = ''
      let consecutiveDupes = 0

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        this.pruneHistory()
        // Build messages in OpenAI format
        const messages: any[] = [
          { role: 'system', content: this.getSystemPrompt() }
        ]

        for (const m of this.conversationHistory) {
          if (m.role === 'user' && Array.isArray(m.content)) {
            // Tool results from previous round
            for (const tr of m.content) {
              if (tr.type === 'tool_result') {
                messages.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content })
              }
            }
          } else if (m.role === 'assistant' && Array.isArray(m.content)) {
            // Assistant message with tool calls (Anthropic format → OpenAI format)
            let textParts = ''
            const toolCalls: any[] = []
            for (const block of m.content) {
              if (block.type === 'text') textParts += block.text
              else if (block.type === 'tool_use') {
                toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input || {}) } })
              }
            }
            const msg: any = { role: 'assistant', content: textParts || null }
            if (toolCalls.length > 0) msg.tool_calls = toolCalls
            messages.push(msg)
          } else {
            messages.push({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })
          }
        }

        // Call OpenAI streaming API
        const response = await this.callOpenAIRaw(token, authMode, messages, openaiTools)

        let roundText = response.text || ''
        fullAssistantText += roundText

        // Store in conversation history in Anthropic-compatible format (our internal format)
        const contentBlocks: any[] = []
        if (roundText) contentBlocks.push({ type: 'text', text: roundText })
        for (const tc of response.toolCalls) {
          contentBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args })
        }
        this.conversationHistory.push({ role: 'assistant', content: contentBlocks })

        if (response.toolCalls.length === 0) break

        // Detect duplicate tool calls (stuck loop)
        const currentSig = response.toolCalls.map((t: any) => `${t.name}:${JSON.stringify(t.args)}`).join('|')
        if (currentSig === lastToolSignature) {
          consecutiveDupes++
          if (consecutiveDupes >= 1) {
            console.log(`[Oculo] Detected stuck loop — same tools called ${consecutiveDupes + 1} times in a row. Breaking.`)
            const stuckMsg = "\n\nI notice I'm repeating the same actions. Let me stop here — what would you like me to do next?"
            fullAssistantText += stuckMsg
            this.emit({ type: 'text_delta', text: stuckMsg })
            break
          }
        } else {
          consecutiveDupes = 0
        }
        lastToolSignature = currentSig

        // Execute tool calls
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []

        for (const tool of response.toolCalls) {
          this.emit({ type: 'tool_use_start', toolCall: { id: tool.id, name: tool.name, input: tool.args || {}, status: 'running' } })

          const result = await this.callMcpTool(tool.name, tool.args || {})

          this.emit({ type: 'tool_use_result', toolCallId: tool.id, result, isError: result.startsWith('Error') })

          // Cap tool result — info tools need more room
          const infoTool = tool.name === 'page' || tool.name === 'read' || tool.name === 'devtools'
          const maxLen = infoTool ? 1200 : 500
          const cappedResult = result.length > maxLen ? safeTruncate(result, maxLen - 20) + '...[truncated]' : result
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: cappedResult })
        }

        this.conversationHistory.push({ role: 'user', content: toolResults })
      }

      this.emit({
        type: 'done',
        message: { id: crypto.randomUUID(), role: 'assistant', content: fullAssistantText, timestamp: Date.now() }
      })
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        if (authMode === 'oauth' && err.message?.includes('401')) {
          this.oauth.codexToken = null
        }
        this.emit({ type: 'error', error: err.message || 'Request failed' })
      }
    } finally {
      this.currentAbort = null
    }
  }

  /**
   * Call OpenAI Chat Completions API with streaming and tool support.
   */
  private callOpenAIRaw(token: string, authMode: 'api-key' | 'oauth', messages: any[], tools: any[]): Promise<{ text: string; toolCalls: Array<{ id: string; name: string; args: any }> }> {
    const body = JSON.stringify({
      model: this.activeModel,
      messages,
      tools,
      stream: true
    })

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Length': String(Buffer.byteLength(body))
        }
      }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = ''
          res.on('data', (c) => { errBody += c })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(errBody)
              const msg = parsed.error?.message || `OpenAI API error ${res.statusCode}`
              if (res.statusCode === 401) {
                reject(new Error(
                  authMode === 'oauth'
                    ? 'Codex subscription auth failed. Run "codex auth" in terminal to refresh.'
                    : 'Invalid API key. Check Settings > AI Providers.'
                ))
              } else {
                reject(new Error(msg))
              }
            } catch { reject(new Error(`OpenAI API error ${res.statusCode}`)) }
          })
          return
        }

        let fullText = ''
        const toolCallsMap = new Map<number, { id: string; name: string; args: string }>()
        let buf = ''

        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString()
          const lines = buf.split('\n')
          buf = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (!data || data === '[DONE]') continue

            try {
              const ev = JSON.parse(data)
              const delta = ev.choices?.[0]?.delta

              // Text content
              if (delta?.content) {
                fullText += delta.content
                this.emit({ type: 'text_delta', text: delta.content })
              }

              // Tool calls (streamed incrementally)
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0
                  if (!toolCallsMap.has(idx)) {
                    toolCallsMap.set(idx, { id: tc.id || '', name: tc.function?.name || '', args: '' })
                  }
                  const existing = toolCallsMap.get(idx)!
                  if (tc.id) existing.id = tc.id
                  if (tc.function?.name) existing.name = tc.function.name
                  if (tc.function?.arguments) existing.args += tc.function.arguments
                }
              }
            } catch { /* skip */ }
          }
        })

        res.on('end', () => {
          const toolCalls = Array.from(toolCallsMap.values()).map(tc => {
            let args: any = {}
            try { args = JSON.parse(tc.args || '{}') } catch { /* ignore */ }
            return { id: tc.id, name: tc.name, args }
          })
          resolve({ text: fullText, toolCalls })
        })
        res.on('error', reject)
      })

      req.on('error', reject)
      if (this.currentAbort) {
        this.currentAbort.signal.addEventListener('abort', () => {
          req.destroy()
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
        })
      }
      req.write(body)
      req.end()
    })
  }

  /**
   * Call Anthropic Messages API with streaming.
   * Supports both API key auth (x-api-key header) and OAuth auth (Bearer + beta header).
   */
  private callAnthropicRaw(token: string, authMode: 'api-key' | 'oauth'): Promise<{ content: any[]; stop_reason: string; inputTokens: number; outputTokens: number }> {
    const messages = this.conversationHistory.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))

    const body = JSON.stringify({
      model: this.activeModel,
      max_tokens: 4096,
      stream: true,
      system: [
        { type: 'text', text: this.getSystemPrompt(), cache_control: { type: 'ephemeral' } }
      ],
      tools: ANTHROPIC_TOOLS,
      messages
    })

    // Build auth headers based on mode
    const betaFlags: string[] = []
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'Content-Length': String(Buffer.byteLength(body))
    }

    if (authMode === 'oauth') {
      headers['Authorization'] = `Bearer ${token}`
      betaFlags.push('oauth-2025-04-20')
    } else {
      headers['x-api-key'] = token
    }
    if (betaFlags.length > 0) {
      headers['anthropic-beta'] = betaFlags.join(',')
    }

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com', port: 443,
        path: '/v1/messages', method: 'POST',
        headers
      }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = ''
          res.on('data', (c) => { errBody += c })
          res.on('end', () => {
            try {
              const parsed = JSON.parse(errBody)
              const msg = parsed.error?.message || `Anthropic API error ${res.statusCode}`
              if (res.statusCode === 401) {
                reject(new Error(
                  authMode === 'oauth'
                    ? 'Subscription auth failed. Try running "claude login" in terminal to refresh.'
                    : 'Invalid API key. Check Settings > AI Providers.'
                ))
              } else {
                reject(new Error(msg))
              }
            } catch { reject(new Error(`Anthropic API error ${res.statusCode}`)) }
          })
          return
        }

        const contentBlocks: any[] = []
        let currentBlock: any = null
        let stopReason = 'end_turn'
        let inputTokens = 0
        let outputTokens = 0
        let buf = ''

        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString()
          const lines = buf.split('\n')
          buf = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (!data || data === '[DONE]') continue

            try {
              const ev = JSON.parse(data)

              if (ev.type === 'content_block_start') {
                currentBlock = ev.content_block
                if (currentBlock.type === 'tool_use') {
                  currentBlock.input = ''
                }
              } else if (ev.type === 'content_block_delta') {
                if (ev.delta?.type === 'text_delta' && currentBlock) {
                  currentBlock.text = (currentBlock.text || '') + ev.delta.text
                  this.emit({ type: 'text_delta', text: ev.delta.text })
                } else if (ev.delta?.type === 'input_json_delta' && currentBlock) {
                  currentBlock.input += ev.delta.partial_json || ''
                }
              } else if (ev.type === 'content_block_stop') {
                if (currentBlock) {
                  if (currentBlock.type === 'tool_use' && typeof currentBlock.input === 'string') {
                    try { currentBlock.input = JSON.parse(currentBlock.input || '{}') }
                    catch { currentBlock.input = {} }
                  }
                  contentBlocks.push(currentBlock)
                  currentBlock = null
                }
              } else if (ev.type === 'message_start') {
                if (ev.message?.usage?.input_tokens) {
                  inputTokens = ev.message.usage.input_tokens
                }
              } else if (ev.type === 'message_delta') {
                if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason
                if (ev.usage?.output_tokens) outputTokens = ev.usage.output_tokens
              }
            } catch { /* skip */ }
          }
        })

        res.on('end', () => {
          if (currentBlock) {
            if (currentBlock.type === 'tool_use' && typeof currentBlock.input === 'string') {
              try { currentBlock.input = JSON.parse(currentBlock.input || '{}') } catch { currentBlock.input = {} }
            }
            contentBlocks.push(currentBlock)
          }
          resolve({ content: contentBlocks, stop_reason: stopReason, inputTokens, outputTokens })
        })
        res.on('error', reject)
      })

      req.on('error', reject)
      if (this.currentAbort) {
        this.currentAbort.signal.addEventListener('abort', () => {
          req.destroy()
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
        })
      }
      req.write(body)
      req.end()
    })
  }

  // === Ollama (local, OpenAI-compatible) ===

  private async handleOllamaMessage(userText: string): Promise<void> {
    this.currentAbort = new AbortController()

    try {
      const messages = [
        { role: 'system', content: this.getSystemPrompt() },
        ...this.conversationHistory.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }))
      ]
      const body = JSON.stringify({ model: this.activeModel, messages, stream: true })

      const resultText = await new Promise<string>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1', port: 11434, path: '/v1/chat/completions', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let errBody = ''
            res.on('data', (c) => { errBody += c })
            res.on('end', () => {
              if (res.statusCode === 404 || errBody.includes('not found')) {
                reject(new Error(`Model "${this.activeModel}" not found. Run: ollama pull ${this.activeModel}`))
              } else {
                reject(new Error(`Ollama error ${res.statusCode}. Is Ollama running? (ollama serve)`))
              }
            })
            return
          }
          let fullText = '', buf = ''
          res.on('data', (chunk: Buffer) => {
            buf += chunk.toString()
            const lines = buf.split('\n'); buf = lines.pop() || ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const d = line.slice(6).trim()
              if (d === '[DONE]') continue
              try {
                const p = JSON.parse(d)
                const delta = p.choices?.[0]?.delta?.content
                if (delta) { fullText += delta; this.emit({ type: 'text_delta', text: delta }) }
              } catch { /* skip */ }
            }
          })
          res.on('end', () => resolve(fullText))
          res.on('error', reject)
        })
        req.on('error', (err) => {
          if ((err as any).code === 'ECONNREFUSED') {
            reject(new Error('Cannot connect to Ollama. Make sure Ollama is running:\n  1. Install: https://ollama.com\n  2. Run: ollama serve\n  3. Pull a model: ollama pull llama3.1:8b'))
          } else {
            reject(err)
          }
        })
        if (this.currentAbort) {
          this.currentAbort.signal.addEventListener('abort', () => {
            req.destroy()
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
          })
        }
        req.write(body); req.end()
      })

      this.conversationHistory.push({ role: 'assistant', content: resultText })
      this.emit({ type: 'done', message: { id: crypto.randomUUID(), role: 'assistant', content: resultText, timestamp: Date.now() } })
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        this.emit({ type: 'error', error: err.message || 'Ollama request failed' })
      }
    } finally {
      this.currentAbort = null
    }
  }

  // === Direct API mode (non-Claude providers) ===

  private async handleAPIMessage(userText: string): Promise<void> {
    const config = this.providerConfigs.get(this.activeProvider)
    if (!config?.apiKey) {
      this.emit({ type: 'error', error: `No API key configured for ${this.activeProvider}.\n\nGo to Settings > AI Providers to add your API key.` })
      return
    }

    const apiKey = config.apiKey
    this.currentAbort = new AbortController()

    try {
      let resultText = ''
      switch (this.activeProvider) {
        case 'gemini': resultText = await this.callGemini(apiKey); break
        case 'grok': resultText = await this.streamOpenAICompat('api.x.ai', '/v1/chat/completions', apiKey); break
        case 'openclaw': resultText = await this.streamOpenAICompat('api.openclaw.ai', '/v1/chat/completions', apiKey); break
        default: this.emit({ type: 'error', error: `Unknown provider: ${this.activeProvider}` }); return
      }
      this.conversationHistory.push({ role: 'assistant', content: resultText })
      this.emit({ type: 'done', message: { id: crypto.randomUUID(), role: 'assistant', content: resultText, timestamp: Date.now() } })
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        this.emit({ type: 'error', error: err.message || 'Request failed' })
      }
    } finally {
      this.currentAbort = null
    }
  }

  // === OpenAI-compatible SSE (OpenAI, Grok, OpenClaw) ===

  private streamOpenAICompat(hostname: string, apiPath: string, apiKey: string): Promise<string> {
    const messages = [
      { role: 'system', content: this.getSystemPrompt() },
      ...this.conversationHistory.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }))
    ]
    const body = JSON.stringify({ model: this.activeModel, messages, stream: true })

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname, port: 443, path: apiPath, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = ''
          res.on('data', (c) => { errBody += c })
          res.on('end', () => {
            try { reject(new Error(JSON.parse(errBody).error?.message || `API error ${res.statusCode}`)) }
            catch { reject(new Error(`API error ${res.statusCode}: ${errBody.slice(0, 200)}`)) }
          })
          return
        }
        let fullText = '', buf = ''
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString()
          const lines = buf.split('\n'); buf = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const d = line.slice(6).trim()
            if (d === '[DONE]') continue
            try {
              const p = JSON.parse(d)
              const delta = p.choices?.[0]?.delta?.content
              if (delta) { fullText += delta; this.emit({ type: 'text_delta', text: delta }) }
            } catch { /* skip */ }
          }
        })
        res.on('end', () => resolve(fullText))
        res.on('error', reject)
      })
      req.on('error', reject)
      if (this.currentAbort) {
        this.currentAbort.signal.addEventListener('abort', () => {
          req.destroy()
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
        })
      }
      req.write(body); req.end()
    })
  }

  // === Gemini (non-streaming) ===

  private async callGemini(apiKey: string): Promise<string> {
    const contents = this.conversationHistory.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
    }))
    const body = JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: this.getSystemPrompt() }] },
      generationConfig: { temperature: 0.7 }
    })

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com', port: 443,
        path: `/v1beta/models/${this.activeModel}:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            try { reject(new Error(JSON.parse(data).error?.message || `Gemini error ${res.statusCode}`)) }
            catch { reject(new Error(`Gemini error ${res.statusCode}`)) }
            return
          }
          try {
            const result = JSON.parse(data)?.candidates?.[0]?.content?.parts?.[0]?.text || ''
            if (result) this.emit({ type: 'text_delta', text: result })
            resolve(result)
          } catch { reject(new Error('Failed to parse Gemini response')) }
        })
        res.on('error', reject)
      })
      req.on('error', reject)
      req.write(body); req.end()
    })
  }

  // === Lifecycle ===

  abort(): void {
    if (this.currentAbort) { this.currentAbort.abort(); this.currentAbort = null }
  }

  clear(): void {
    this.conversationHistory = []
    this.messageCount = 0
  }

  getStatus(): { hasClaudeCode: boolean; messageCount: number; activeProvider: AIProviderId; activeModel: string; loggedIn: boolean; email?: string; authMode?: string } {
    if (this.activeProvider === 'openai') {
      const openaiConfig = this.providerConfigs.get('openai')
      const hasApiKey = !!(openaiConfig?.apiKey)
      const hasCodex = !!this.oauth.codexToken
      const authMode = hasApiKey ? 'api-key' : hasCodex ? 'subscription' : 'none'
      return {
        hasClaudeCode: true,
        messageCount: this.messageCount,
        activeProvider: this.activeProvider,
        activeModel: this.activeModel,
        loggedIn: hasApiKey || hasCodex,
        email: this.oauth.codexEmail || (hasCodex ? `${this.oauth.codexPlan || 'ChatGPT'} subscription` : undefined),
        authMode
      }
    }

    const claudeConfig = this.providerConfigs.get('claude')
    const hasApiKey = !!(claudeConfig?.apiKey)
    const hasOAuth = !!this.oauth.getOAuthToken()
    const authMode = hasOAuth ? 'subscription' : hasApiKey ? 'api-key' : this.oauth.claudeLoggedIn ? 'cli' : 'none'
    return {
      hasClaudeCode: hasApiKey || hasOAuth || this.claudePath !== null,
      messageCount: this.messageCount,
      activeProvider: this.activeProvider,
      activeModel: this.activeModel,
      loggedIn: hasApiKey || hasOAuth || this.oauth.claudeLoggedIn,
      email: this.oauth.claudeAuthEmail,
      authMode
    }
  }

  private emit(event: ChatStreamEvent): void {
    try { if (!this.mainWindow.isDestroyed()) this.mainWindow.webContents.send('chat:stream', event) } catch {}
  }
}
