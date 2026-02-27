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
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import http from 'http'

const PORT_FILE = join(homedir(), '.oculo-port')

/**
 * Read port and auth token from ~/.oculo-port (format: "port:token").
 * Returns { port, token } or null if unreadable.
 */
function getConnection() {
  try {
    const raw = readFileSync(PORT_FILE, 'utf-8').trim()
    const colonIdx = raw.indexOf(':')
    if (colonIdx === -1) {
      // Legacy format: just port number
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
 * tools/list — forward to Oculo and relay the tool definitions back.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const conn = getConnection()
  if (!conn) {
    // Return empty tools so Claude Code doesn't error out — just has nothing to call.
    return { tools: [] }
  }

  try {
    const result = await httpPost(conn.port, { method: 'tools/list' }, conn.token)
    return result
  } catch (err) {
    // If Oculo just went down, return empty gracefully
    process.stderr.write(`[oculo-mcp] tools/list error: ${err.message}\n`)
    return { tools: [] }
  }
})

/**
 * tools/call — forward the call to Oculo and relay the response.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const conn = getConnection()
  if (!conn) {
    return {
      content: [
        {
          type: 'text',
          text: 'Oculo is not running. Launch the Oculo browser first, then try again.'
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
