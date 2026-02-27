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

/**
 * Static tool definitions — always returned by tools/list so Claude Code
 * registers them even when Oculo is not yet running. Errors surface at
 * tools/call time instead of silently returning zero tools.
 */
const STATIC_TOOLS = [
  {
    name: 'page',
    description:
      'Describe the current page in Oculo browser. Default: compact (~30-80 tokens). Use detail="a11y" for full accessibility tree with interactive elements numbered [1],[2]... — better for complex React forms.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'CSS selector to scope description to a section of the page' },
        detail: { type: 'string', enum: ['compact', 'a11y'], description: 'compact (default ~30-80 tokens) or a11y (full accessibility tree ~200-500 tokens)' },
        include: { type: 'array', items: { type: 'string' }, description: 'What to include: "forms", "buttons", "links", "headings", "text", "images"' },
        screenshot: { type: 'boolean', description: 'Attach a screenshot (default: false)' }
      }
    }
  },
  {
    name: 'act',
    description:
      'Perform an action in Oculo browser: click, navigate, scroll, press key, hover, type, login. Elements found by text, role, label, or placeholder.',
    inputSchema: {
      type: 'object',
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
    description: 'Fill form fields in Oculo browser by label text. Handles text, select, checkbox, textarea. Use visible labels as keys.',
    inputSchema: {
      type: 'object',
      properties: {
        fields: { type: 'object', description: 'Object mapping field label → value (e.g. {"Email": "hi@oculo.com"})' },
        submit: { description: 'Submit form. true = first submit button, string = button text' },
        screenshot: { type: 'boolean', description: 'Attach screenshot after filling' }
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
        format: { type: 'string', enum: ['text', 'json'], description: 'Output format (default: text)' }
      },
      required: ['what']
    }
  },
  {
    name: 'run',
    description: 'Execute a multi-step pipeline in Oculo browser. Each step can page/act/fill/read/wait. Cached for replay.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: { type: 'array', items: { type: 'object' }, description: 'Array of steps to execute sequentially' },
        workflow: { type: 'string', description: 'Replay a cached workflow by ID' },
        description: { type: 'string', description: 'Short description for caching' },
        returnAll: { type: 'boolean', description: 'Return results from all steps (default: false)' }
      }
    }
  },
  {
    name: 'media',
    description: 'Generate images (Nano Banana 2 / DALL-E 3) or videos (Veo 3.1) via Oculo. Returns saved file path.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['image', 'video'], description: 'Generate an image or video' },
        prompt: { type: 'string', description: 'What to create' },
        model: { type: 'string', description: 'Image model: nano-banana-2 (default), nano-banana-pro, nano-banana' },
        size: { type: 'string', description: 'Image: 1024x1024, 2K, 4K. Video: 16:9, 9:16' },
        style: { type: 'string', description: 'natural, vivid, cinematic, anime' },
        provider: { type: 'string', description: 'Override: gemini, openai, stability' },
        duration: { type: 'number', description: 'Video duration: 4, 6, or 8 seconds' }
      },
      required: ['type', 'prompt']
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
      'Content-Length': Buffer.byteLength(data)
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
  { name: 'oculo', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

/**
 * tools/list — always return static tool definitions so Claude Code registers
 * oculo tools even before the browser is launched. When Oculo is running, we
 * forward to get the live (possibly updated) definitions instead.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const conn = getConnection()
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
  const conn = getConnection()
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

  // Quick liveness check before attempting the (potentially slow) tool call
  const alive = await verifyConnection(conn)
  if (!alive) {
    return {
      content: [
        {
          type: 'text',
          text: 'Oculo browser is not reachable (stale port file cleaned). Launch Oculo and try again.'
        }
      ],
      isError: true
    }
  }

  try {
    const result = await httpPost(conn.port, {
      method: 'tools/call',
      params: {
        name: request.params.name,
        arguments: request.params.arguments
      }
    }, conn.token)
    return result
  } catch (err) {
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

// ── Connect stdio transport ───────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
