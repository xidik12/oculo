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
const SYSTEM_PROMPT = `You are an AI browser assistant in Oculo. You control web pages via tools.

Tools: page (see page), act (actions), fill (forms), read (extract), run (pipeline), devtools (inspect), media (generate images/videos).

Key capabilities:
- act screenshot → capture page, returns file path
- act upload → inject file into file input (no dialog), provide path in value
- act clipboardImage → copy page screenshot to clipboard
- media image → generate image from prompt, returns file path
- media video → generate video from prompt, returns file path
- act download → save URL to disk
- act readFile → read text content of file (value = path)
- act listDownloads → list recent downloads with paths

FORM FILLING STRATEGY:
1. First try fill tool with field labels from page output
2. If fill reports "Not found" fields, use act type with the CSS selector shown in page output
3. For React/SPA sites: act type with selector is more reliable than fill
4. Always verify: after filling, call page to confirm field values
5. Rich text editors (X, Facebook, LinkedIn): use act type, NOT fill

WORKFLOW:
1. PLAN: Short numbered plan (3-7 steps)
2. EXECUTE: Batch with run tool when possible
3. VERIFY: Check results with page before reporting done
4. ANSWER: Summarize what you did

Rules:
- File paths from screenshot/media can be used in upload actions
- Cross-origin iframes: use act clickAtPoint
- Minimize tool calls, batch with run
- If a tool fails, try a different approach — don't retry the same call`

/**
 * Anthropic tool format for the 5 MCP browser tools
 */
const ANTHROPIC_TOOLS = [
  {
    name: 'page',
    description: 'Get current page info: URL, title, headings, fields, buttons, links, editable areas, iframes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scope: { type: 'string', description: 'CSS selector to scope to a section' }
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
            'scroll', 'scrollIntoView', 'press', 'hover', 'select',
            'wait', 'waitForElement', 'dragAndDrop',
            'evaluate', 'getAttribute', 'upload', 'login',
            'screenshot', 'switchTab', 'closeTab',
            'download', 'listDownloads', 'readFile', 'clipboardImage'
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
    description: 'Fill form fields by label. For rich text editors use act type instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fields: { type: 'object', description: 'Label→value map' },
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
    description: 'Multi-step pipeline. Each step: {page:{}}, {act:{}}, {fill:{}}, {read:{}}, {wait:{}}.',
    input_schema: {
      type: 'object' as const,
      properties: {
        steps: { type: 'array', items: { type: 'object' } },
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
    description: 'Generate images or videos. Returns saved file path. Reuses Gemini/OpenAI keys.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['image', 'video'], description: 'Generate image or video' },
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
  private messageCount = 0
  private activeProvider: AIProviderId = 'claude'
  private activeModel: string = 'claude-sonnet-4-6'
  private providerConfigs: Map<AIProviderId, AIProviderConfig> = new Map()
  private currentAbort: AbortController | null = null
  private conversationHistory: Array<{ role: string; content: any }> = []

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
    this.oauth.setMainWindow(mainWindow)
    this.initShellEnv()
    this.oauth.loadOAuthToken()
    this.oauth.loadCodexToken(this.providerConfigs)
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
      req.setTimeout(30_000, () => { req.destroy(); resolve('Tool call timed out after 30s') })
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
  }

  /** Get all provider configs (for media generation API key lookup) */
  getProviderConfigs(): Map<AIProviderId, AIProviderConfig> {
    return this.providerConfigs
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
    const MAX_TOOL_ROUNDS = 25

    try {
      let fullAssistantText = ''
      let totalInputTokens = 0
      let totalOutputTokens = 0

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

        // Execute tool calls
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []

        for (const tool of toolUses) {
          this.emit({ type: 'tool_use_start', toolCall: { id: tool.id, name: tool.name, input: tool.input || {}, status: 'running' } })

          const result = await this.callMcpTool(tool.name, tool.input || {})

          this.emit({ type: 'tool_use_result', toolCallId: tool.id, result, isError: result.startsWith('Error') })
          this.emit({ type: 'text_delta', text: `\n> ${tool.name} ${this.summarizeToolArgs(tool.name, tool.input)}\n` })

          // Cap tool result stored in history — info tools need more, action tools less
          const infoTool = tool.name === 'page' || tool.name === 'read' || tool.name === 'devtools'
          const maxLen = infoTool ? 1200 : 500
          const cappedResult = result.length > maxLen ? safeTruncate(result, maxLen - 20) + '...[truncated]' : result
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: cappedResult })
        }

        this.conversationHistory.push({ role: 'user', content: toolResults })
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
    // Always keep history[0] (original user task), drop pairs starting at index 1
    while (history.length > MAX_HISTORY && history.length >= 3) {
      // Verify indices 1 and 2 form a valid pair (assistant + user_tool_result)
      if (history[1]?.role === 'assistant' && history[2]?.role === 'user') {
        history.splice(1, 2) // Drop the pair atomically
      } else {
        break // Unexpected structure, don't corrupt
      }
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

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        this.pruneHistory()
        // Build messages in OpenAI format
        const messages: any[] = [
          { role: 'system', content: SYSTEM_PROMPT }
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

        // Execute tool calls
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []

        for (const tool of response.toolCalls) {
          this.emit({ type: 'tool_use_start', toolCall: { id: tool.id, name: tool.name, input: tool.args || {}, status: 'running' } })

          const result = await this.callMcpTool(tool.name, tool.args || {})

          this.emit({ type: 'tool_use_result', toolCallId: tool.id, result, isError: result.startsWith('Error') })
          this.emit({ type: 'text_delta', text: `\n> ${tool.name} ${this.summarizeToolArgs(tool.name, tool.args)}\n` })

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
      system: SYSTEM_PROMPT,
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
        { role: 'system', content: SYSTEM_PROMPT },
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
      { role: 'system', content: SYSTEM_PROMPT },
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
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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
