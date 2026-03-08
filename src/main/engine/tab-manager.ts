/**
 * TabManager — Centralized tab management for multi-tab parallel execution.
 *
 * Provides a clean API for MCP tools to create, close, switch, list, and
 * execute commands on specific tabs by ID. This enables parallel workflows
 * where an AI agent opens multiple tabs and runs actions on all of them
 * simultaneously without switching the active tab.
 *
 * The actual webview access still goes through the renderer process via IPC.
 * This manager coordinates the tab state and provides the routing layer.
 */

export interface TabInfo {
  id: string          // Unique tab ID (e.g. "tab-1709912345-1")
  url: string
  title: string
  active: boolean
  index: number       // Position in tab bar (0-indexed)
  isLoading: boolean
}

export interface TabCreateResult {
  id: string
  url: string
  title: string
}

/**
 * Tab manager is primarily a type/interface definition layer.
 * Actual tab state lives in the renderer (React state) since webviews
 * are renderer-process objects. The MCP server routes tool calls to
 * specific tabs via the tabId parameter, and the renderer's
 * findWebviewByTabId() handles the actual webview lookup.
 *
 * This file exports the interfaces and utility functions used by
 * the MCP server and oculo-mcp bridge for tab-targeted execution.
 */

/**
 * Format tab list output for MCP responses.
 * Includes tab IDs for programmatic access.
 */
export function formatTabList(tabs: TabInfo[]): string {
  if (!tabs.length) return 'No tabs open'

  const lines = tabs.map((t) => {
    const marker = t.active ? '→ ' : '  '
    const loading = t.isLoading ? ' [loading]' : ''
    return `${marker}[${t.index}] id="${t.id}" ${t.title || 'Untitled'} — ${t.url.substring(0, 80)}${loading}`
  })

  return `Tabs (${tabs.length}):\n${lines.join('\n')}\n\nUse tabId parameter to target a specific tab for parallel execution.`
}

/**
 * Format newTab result for MCP responses.
 * Returns the tab ID so the AI can reference it in subsequent calls.
 */
export function formatNewTabResult(tab: TabCreateResult): string {
  return `New tab opened | id="${tab.id}" | ${tab.url}\n\nUse tabId="${tab.id}" in page/act/fill/read/run tools to execute on this tab without switching.`
}

/**
 * Parse a tab target — can be a tab ID string or a numeric index.
 * Returns { type: 'id', value } or { type: 'index', value }.
 */
export function parseTabTarget(target: string): { type: 'id' | 'index'; value: string | number } {
  // Check if it's a tab ID (starts with "tab-")
  if (target.startsWith('tab-')) {
    return { type: 'id', value: target }
  }

  // Check if it's a numeric index
  const num = parseInt(target, 10)
  if (!isNaN(num) && num >= 0) {
    return { type: 'index', value: num }
  }

  // Treat as text search (title/URL)
  return { type: 'id', value: target }
}
