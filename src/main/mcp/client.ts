/**
 * MCP Client Manager — connects to external MCP servers (Gmail, Calendar, Notion, etc.)
 *
 * Architecture:
 *   Oculo Settings → McpClientManager → StdioClientTransport / SSEClientTransport
 *   → External MCP Server → Tools available to built-in AI chat
 *
 * Tool namespacing: tools are prefixed with `{serverId}__` to avoid collisions
 * between servers that might have tools with the same name.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpClientConfig } from '../../shared/types'

export interface ConnectedTool {
  /** Namespaced name: serverId__toolName */
  name: string
  /** Original tool name from the server */
  originalName: string
  /** Server ID this tool belongs to */
  serverId: string
  /** Server display name */
  serverName: string
  description: string
  inputSchema: Record<string, unknown>
}

interface ServerConnection {
  config: McpClientConfig
  client: Client
  transport: StdioClientTransport | SSEClientTransport
  tools: ConnectedTool[]
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
}

export class McpClientManager {
  private connections = new Map<string, ServerConnection>()

  /** Load configs and connect enabled servers */
  async loadConfigs(configs: McpClientConfig[]): Promise<void> {
    // Disconnect any removed servers
    for (const [id] of this.connections) {
      if (!configs.find(c => c.id === id)) {
        await this.disconnect(id)
      }
    }

    // Connect enabled servers
    for (const config of configs) {
      if (config.enabled && !this.connections.has(config.id)) {
        await this.connect(config)
      } else if (!config.enabled && this.connections.has(config.id)) {
        await this.disconnect(config.id)
      }
    }
  }

  /** Connect to a single MCP server */
  async connect(config: McpClientConfig): Promise<boolean> {
    // Disconnect existing if reconnecting
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id)
    }

    const client = new Client(
      { name: 'oculo-browser', version: '0.3.0' },
      { capabilities: {} }
    )

    let transport: StdioClientTransport | SSEClientTransport

    try {
      if (config.transport === 'stdio') {
        if (!config.command) {
          throw new Error('stdio transport requires a command')
        }
        const [cmd, ...defaultArgs] = config.command.split(' ')
        transport = new StdioClientTransport({
          command: cmd,
          args: [...defaultArgs, ...(config.args || [])],
          env: { ...process.env, ...(config.env || {}) } as Record<string, string>
        })
      } else if (config.transport === 'sse') {
        if (!config.url) {
          throw new Error('SSE transport requires a URL')
        }
        transport = new SSEClientTransport(new URL(config.url))
      } else {
        throw new Error(`Unknown transport: ${config.transport}`)
      }

      const conn: ServerConnection = {
        config,
        client,
        transport,
        tools: [],
        status: 'connecting'
      }
      this.connections.set(config.id, conn)

      await client.connect(transport)
      conn.status = 'connected'

      // Discover tools
      try {
        const result = await client.listTools()
        conn.tools = (result.tools || []).map(tool => ({
          name: `${config.id}__${tool.name}`,
          originalName: tool.name,
          serverId: config.id,
          serverName: config.name,
          description: `[${config.name}] ${tool.description || ''}`,
          inputSchema: (tool.inputSchema || {}) as Record<string, unknown>
        }))
      } catch (err) {
        console.warn(`[MCP Client] Failed to list tools for ${config.name}:`, err)
        conn.tools = []
      }

      console.log(`[MCP Client] Connected to ${config.name} (${conn.tools.length} tools)`)
      return true
    } catch (err) {
      const errMsg = (err as Error).message
      console.error(`[MCP Client] Failed to connect to ${config.name}:`, errMsg)
      const conn = this.connections.get(config.id)
      if (conn) {
        conn.status = 'error'
        conn.error = errMsg
      } else {
        this.connections.set(config.id, {
          config,
          client,
          transport: transport!,
          tools: [],
          status: 'error',
          error: errMsg
        })
      }
      return false
    }
  }

  /** Disconnect from a server */
  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId)
    if (!conn) return

    try {
      await conn.client.close()
    } catch { /* best effort */ }

    try {
      await conn.transport.close()
    } catch { /* best effort */ }

    this.connections.delete(serverId)
    console.log(`[MCP Client] Disconnected from ${conn.config.name}`)
  }

  /** List all available tools from all connected servers */
  listAllTools(): ConnectedTool[] {
    const tools: ConnectedTool[] = []
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected') {
        tools.push(...conn.tools)
      }
    }
    return tools
  }

  /** Call a namespaced tool (serverId__toolName) */
  async callTool(namespacedName: string, args: Record<string, unknown>): Promise<string> {
    const sepIdx = namespacedName.indexOf('__')
    if (sepIdx === -1) {
      return `Error: Invalid tool name "${namespacedName}". Expected format: serverId__toolName`
    }

    const serverId = namespacedName.substring(0, sepIdx)
    const toolName = namespacedName.substring(sepIdx + 2)

    const conn = this.connections.get(serverId)
    if (!conn) {
      return `Error: Server "${serverId}" is not connected`
    }
    if (conn.status !== 'connected') {
      return `Error: Server "${serverId}" status is ${conn.status}`
    }

    try {
      const result = await conn.client.callTool({ name: toolName, arguments: args })
      // Extract text from result content
      const textParts = ((result.content || []) as any[])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
      return textParts.join('\n') || JSON.stringify(result)
    } catch (err) {
      return `Error calling ${namespacedName}: ${(err as Error).message}`
    }
  }

  /** Get connection status for all configured servers */
  getStatus(): Array<{
    id: string
    name: string
    status: string
    toolCount: number
    error?: string
  }> {
    return Array.from(this.connections.values()).map(conn => ({
      id: conn.config.id,
      name: conn.config.name,
      status: conn.status,
      toolCount: conn.tools.length,
      error: conn.error
    }))
  }

  /** Get status for a single server */
  getServerStatus(serverId: string): { connected: boolean; toolCount: number; error?: string } {
    const conn = this.connections.get(serverId)
    if (!conn) return { connected: false, toolCount: 0 }
    return {
      connected: conn.status === 'connected',
      toolCount: conn.tools.length,
      error: conn.error
    }
  }

  /** Disconnect all servers (cleanup) */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys())
    for (const id of ids) {
      await this.disconnect(id)
    }
  }
}
