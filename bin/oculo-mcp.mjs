#!/usr/bin/env node

/**
 * Oculo MCP Bridge — stdio-to-HTTP proxy
 *
 * Claude Code launches this script via stdio. It speaks the MCP protocol over
 * stdin/stdout (using the MCP SDK), and forwards every `tools/list` and
 * `tools/call` request to the Oculo Electron app's embedded HTTP server.
 *
 * The Electron app writes its port to ~/.oculo-port on startup. This script
 * reads that file to discover which port to connect to.
 *
 * Usage (in Claude Code's MCP config):
 *   {
 *     "command": "node",
 *     "args": ["/absolute/path/to/oculo/bin/oculo-mcp.mjs"]
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, existsSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import http from 'http'

const PORT_FILE = join(homedir(), '.oculo-port')

/** Cached connection to avoid re-reading port file */
let cachedConn = null
let cachedAt = 0
const CACHE_TTL = 30_000 // 30 seconds

function getCachedConnection() {
  if (cachedConn && Date.now() - cachedAt < CACHE_TTL) return cachedConn
  cachedConn = getConnection()
  cachedAt = Date.now()
  return cachedConn
}

function invalidateCache() {
  cachedConn = null
  cachedAt = 0
}

/** Unique agent ID for multi-agent tab isolation */
const agentId = 'agent-' + process.pid + '-' + Date.now()

/**
 * Static tool definitions — always returned by tools/list so Claude Code
 * registers them even when Oculo is not yet running. Errors surface at
 * tools/call time instead of silently returning zero tools.
 */
const STATIC_TOOLS = [
  {
    name: 'page',
    description:
      'Describe the current page in Oculo browser. Default: compact (~30-80 tokens). Use detail="a11y" for ref-tagged accessibility tree — interactive elements get [ref=e1],[ref=e2]... refs usable in act tool. Use detail="markdown" for full article content as clean markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'CSS selector to scope description to a section of the page' },
        detail: { type: 'string', enum: ['compact', 'a11y', 'markdown'], description: 'compact (default ~30-80 tokens), a11y (ref-tagged accessibility tree ~200-500 tokens), or markdown (article extraction via Readability)' },
        include: { type: 'array', items: { type: 'string' }, description: 'What to include: "forms", "buttons", "links", "headings", "text", "images"' },
        screenshot: { type: 'boolean', description: 'Attach a screenshot (default: false)' },
        tabId: { type: 'string', description: 'Target a specific tab by ID (for parallel execution). Omit for active tab.' }
      }
    }
  },
  {
    name: 'act',
    description:
      'Perform an action in Oculo browser: click, navigate, scroll, press key, hover, type, login. Elements found by ref (from a11y snapshot), text, role, label, placeholder, or CSS selector. After click/navigate/back/forward/reload, returns fresh ref-tagged snapshot. Use newTab with background=true to open tabs without switching, then use tabId to run actions in parallel.',
    inputSchema: {
      type: 'object',
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
        tabId: { type: 'string', description: 'Target a specific tab by ID (for parallel execution). Omit for active tab.' },
        background: { type: 'boolean', description: 'For newTab: open in background without switching (default: false). Returns tab ID for parallel execution.' },
        proxy: { type: 'object', description: 'Proxy config for setProxy action: {type, host, port, username?, password?, bypass?}', properties: { type: { type: 'string', enum: ['http', 'https', 'socks4', 'socks5', 'direct'] }, host: { type: 'string' }, port: { type: 'number' }, username: { type: 'string' }, password: { type: 'string' }, bypass: { type: 'array', items: { type: 'string' } } } }
      },
      required: ['action']
    }
  },
  {
    name: 'fill',
    description: 'Fill form fields in Oculo browser by label, placeholder, or data-placeholder text. Handles text, select, checkbox, textarea, and contenteditable (DraftJS, ProseMirror). Use visible labels as keys.',
    inputSchema: {
      type: 'object',
      properties: {
        fields: { type: 'object', description: 'Object mapping field label → value (e.g. {"Email": "hi@oculo.com"})' },
        submit: { description: 'Submit form. true = first submit button, string = button text' },
        screenshot: { type: 'boolean', description: 'Attach screenshot after filling' },
        tabId: { type: 'string', description: 'Target a specific tab by ID (for parallel execution). Omit for active tab.' }
      },
      required: ['fields']
    }
  },
  {
    name: 'read',
    description: 'Extract structured data from the page in Oculo browser (search results, tables, lists, articles).',
    inputSchema: {
      type: 'object',
      properties: {
        what: { type: 'string', description: 'What to extract: "search results", "products", "table data", etc.' },
        scope: { type: 'string', description: 'CSS selector to narrow extraction scope' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Specific fields to extract' },
        limit: { type: 'number', description: 'Max items to return (default: 10)' },
        format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' },
        tabId: { type: 'string', description: 'Target a specific tab by ID (for parallel execution). Omit for active tab.' }
      },
      required: ['what']
    }
  },
  {
    name: 'run',
    description: 'PREFERRED for any task with 2+ actions. Executes a multi-step pipeline in a SINGLE call — use this instead of multiple act/fill calls. Example — post on X: run({steps:[{act:{action:"navigate",url:"https://x.com/compose/post"}},{wait:{timeout:2000}},{act:{action:"type",text:"Hello world",role:"textbox"}},{act:{action:"click",text:"Post",role:"button"}}]}). Each step is an object with exactly ONE key: page, act, fill, read, wait, or if. Cached for replay.',
    inputSchema: {
      type: 'object',
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
        workflow: { type: 'string', description: 'Replay a cached workflow by ID' },
        description: { type: 'string', description: 'Short description for caching' },
        returnAll: { type: 'boolean', description: 'Return results from all steps (default: false)' },
        tabId: { type: 'string', description: 'Target a specific tab by ID (for parallel execution). Omit for active tab.' }
      }
    }
  },
  {
    name: 'media',
    description: 'Generate images (Nano Banana 2 / DALL-E 3) or videos (Veo 3.1) via Oculo. Returns saved file path. Supports image-to-image editing with reference image.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['image', 'video'], description: 'Generate an image or video' },
        prompt: { type: 'string', description: 'What to create' },
        image: { type: 'string', description: 'Path to reference image for image-to-image editing/transformation (Gemini only)' },
        model: { type: 'string', description: 'Image model: nano-banana-2 (default), nano-banana-pro, nano-banana' },
        size: { type: 'string', description: 'Image: 1024x1024, 2K, 4K. Video: 16:9, 9:16' },
        style: { type: 'string', description: 'natural, vivid, cinematic, anime' },
        provider: { type: 'string', description: 'Override: gemini, openai, stability' },
        duration: { type: 'number', description: 'Video duration: 4, 6, or 8 seconds' }
      },
      required: ['type', 'prompt']
    }
  },
  {
    name: 'shell',
    description: 'Execute a shell command (ls, npm, git, node, python, etc.) via Oculo and return stdout+stderr. Non-interactive only.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000, max: 120000)' }
      },
      required: ['command']
    }
  },
  {
    name: 'webmcp_list',
    description: 'Discover WebMCP tools registered by the current page via navigator.modelContext.registerTool() or <form toolname="..."> elements. Returns list of available page-declared tools.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'webmcp_call',
    description: 'Call a WebMCP tool registered by the current page. Use webmcp_list first to discover available tools.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name to call (from webmcp_list)' },
        args: { type: 'object', description: 'Arguments to pass to the tool' }
      },
      required: ['name']
    }
  },
  {
    name: 'research',
    description: 'Deep web research on a topic. Opens multiple tabs, reads pages, synthesizes findings.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Research topic or question' },
        depth: { type: 'number', description: 'Research depth (1-3). Default: 2' },
        tabId: { type: 'string', description: 'Target tab ID' }
      },
      required: ['topic']
    }
  },
  {
    name: 'tabs',
    description: 'List all open browser tabs with their URLs and titles.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'string', description: 'Target tab ID' }
      }
    }
  },
  {
    name: 'preview',
    description: 'Pre-fetch a URL without navigating. Returns page description without leaving current page.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to preview' },
        tabId: { type: 'string', description: 'Target tab ID' }
      },
      required: ['url']
    }
  },
  {
    name: 'translate',
    description: 'Translate page content or specific text to another language.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to translate (omit for full page)' },
        to: { type: 'string', description: 'Target language code (e.g., "en", "es", "zh")' },
        tabId: { type: 'string', description: 'Target tab ID' }
      },
      required: ['to']
    }
  },
  {
    name: 'lens',
    description: 'Visual analysis of the current page via screenshot. Describe what you see or answer questions about the page visually.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'What to analyze or look for in the page' },
        tabId: { type: 'string', description: 'Target tab ID' }
      },
      required: ['question']
    }
  },
  {
    name: 'abort',
    description: 'Cancel a pending tool call by callId, or pass callId="all" to cancel everything.',
    inputSchema: {
      type: 'object',
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
      type: 'object',
      properties: {}
    }
  }
]

/**
 * Read port and auth token from ~/.oculo-port (format: "port:token").
 * Returns { port, token } or null if unreadable / file doesn't exist.
 */
function getConnection() {
  try {
    if (!existsSync(PORT_FILE)) return null
    const raw = readFileSync(PORT_FILE, 'utf-8').trim()
    const colonIdx = raw.indexOf(':')
    if (colonIdx === -1) {
      const port = parseInt(raw, 10)
      return Number.isFinite(port) ? { port, token: '' } : null
    }
    const port = parseInt(raw.substring(0, colonIdx), 10)
    const token = raw.substring(colonIdx + 1)
    return Number.isFinite(port) ? { port, token } : null
  } catch {
    return null
  }
}

/**
 * Verify Oculo is actually reachable. If the port file exists but the
 * server isn't responding, clean up the stale file.
 */
async function verifyConnection(conn) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: conn.port, path: '/health', method: 'GET', timeout: 2000 },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(res.statusCode === 200))
      }
    )
    req.on('error', () => {
      // Stale port file — clean it up
      try { unlinkSync(PORT_FILE) } catch { /* ignore */ }
      process.stderr.write('[oculo-mcp] Cleaned stale port file (Oculo not running)\n')
      resolve(false)
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

/**
 * Send a JSON POST request to the Oculo HTTP MCP server.
 */
function httpPost(port, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'X-Agent-Id': agentId
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers
      },
      (res) => {
        let chunks = ''
        res.on('data', (c) => (chunks += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(chunks))
          } catch {
            reject(new Error(`Invalid JSON from Oculo: ${chunks}`))
          }
        })
      }
    )
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(
          new Error(
            'Oculo is not running (connection refused). Launch the Oculo browser first.'
          )
        )
      } else {
        reject(err)
      }
    })
    req.setTimeout(600_000, () => {
      req.destroy(new Error('Request to Oculo timed out after 10 minutes'))
    })
    req.write(data)
    req.end()
  })
}

// ── MCP Server (stdio side) ───────────────────────────────────────────────

const server = new Server(
  { name: 'oculo', version: '0.4.4' },
  {
    capabilities: { tools: {} },
    instructions: `You are connected to Oculo, an AI-powered native browser. Your oculo tools (page, act, fill, read, run, media, shell) control the LIVE browser the user is currently looking at — not a headless browser or separate session.

IMPORTANT: Always use oculo tools for ANY browser interaction. Do NOT use webpilot, playwright, puppeteer, or any other browser automation tools — they would open a separate browser instead of controlling the one the user sees.

Quick reference:
- page({detail:"a11y"}) → get ref-tagged accessibility tree, then use refs in act()
- act({action:"click", ref:"e5"}) → click element by ref from accessibility tree
- act({action:"navigate", url:"..."}) → go to a URL in the current tab
- fill({fields:{"Label":"value"}}) → fill form fields by their visible labels
- read({what:"..."}) → extract structured data from the page
- run({steps:[...]}) → execute multi-step pipelines
- media({type:"image", prompt:"..."}) → generate images or videos`
  }
)

/**
 * tools/list — always return static tool definitions so Claude Code registers
 * oculo tools even before the browser is launched. When Oculo is running, we
 * forward to get the live (possibly updated) definitions instead.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const conn = getCachedConnection()
  if (!conn) {
    return { tools: STATIC_TOOLS }
  }

  // Try live tools from Oculo, fall back to static
  try {
    const alive = await verifyConnection(conn)
    if (!alive) return { tools: STATIC_TOOLS }
    const result = await httpPost(conn.port, { method: 'tools/list' }, conn.token)
    return result
  } catch (err) {
    process.stderr.write(`[oculo-mcp] tools/list error: ${err.message}\n`)
    return { tools: STATIC_TOOLS }
  }
})

/**
 * tools/call — forward the call to Oculo and relay the response.
 * If Oculo isn't running, return a clear error with instructions.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  let conn = getCachedConnection()
  if (!conn) {
    return {
      content: [
        {
          type: 'text',
          text: 'Oculo browser is not running. Launch Oculo first — it writes ~/.oculo-port on startup, which this bridge reads to connect.'
        }
      ],
      isError: true
    }
  }

  // Skip liveness check — httpPost will fail with ECONNREFUSED if dead, and we auto-retry
  async function attempt(connection) {
    return await httpPost(connection.port, {
      method: 'tools/call',
      params: {
        name: request.params.name,
        arguments: request.params.arguments
      }
    }, connection.token)
  }

  try {
    return await attempt(conn)
  } catch (err) {
    if (err.message?.includes('connection refused') || err.code === 'ECONNREFUSED') {
      // Auto-retry: invalidate cache, re-read port file, wait 1s, retry once
      invalidateCache()
      await new Promise(r => setTimeout(r, 1000))
      conn = getCachedConnection()
      if (!conn) {
        return {
          content: [{ type: 'text', text: 'Oculo browser is not running after retry. Launch Oculo and try again.' }],
          isError: true
        }
      }
      try {
        return await attempt(conn)
      } catch (retryErr) {
        return {
          content: [{ type: 'text', text: `Failed to reach Oculo after retry: ${retryErr.message}` }],
          isError: true
        }
      }
    }
    return {
      content: [
        {
          type: 'text',
          text: `Failed to reach Oculo: ${err.message}`
        }
      ],
      isError: true
    }
  }
})

// ── Exit watchdog ─────────────────────────────────────────────────────────
// When the parent process (Claude Code) closes stdin, gracefully exit after 15s.
// This prevents orphaned oculo-mcp processes from lingering indefinitely.
process.stdin.on('end', () => {
  process.stderr.write('[oculo-mcp] stdin closed, shutting down in 15s...\n')
  setTimeout(() => {
    process.stderr.write('[oculo-mcp] exit watchdog fired, shutting down\n')
    process.exit(0)
  }, 15_000).unref()
})

process.stdin.on('error', () => {
  // stdin error (e.g. EPIPE) — schedule exit
  setTimeout(() => process.exit(0), 15_000).unref()
})

// ── Connect stdio transport ───────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
