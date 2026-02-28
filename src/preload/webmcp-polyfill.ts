/**
 * WebMCP Polyfill — implements navigator.modelContext (W3C draft, Chrome 146)
 *
 * Injected into every webview via webview-preload.ts. Pages can register tools
 * for AI agents to discover and call. This enables the "Connected Web" vision
 * where websites declare capabilities for AI browsers.
 *
 * API:
 *   navigator.modelContext.registerTool(descriptor)
 *   navigator.modelContext.unregisterTool(name)
 *   navigator.modelContext.provideContext(key, value)
 *   navigator.modelContext.clearContext()
 *
 * Internal (for Oculo MCP bridge):
 *   window.__oc_webmcp_list()   — returns tool descriptors (no execute fn)
 *   window.__oc_webmcp_call(name, args) — calls tool's execute handler
 *   window.__oc_webmcp_scan_declarative() — scans <form toolname="..."> elements
 *   window.__oc_webmcp_version  — monotonic version counter for change detection
 */

;(function setupWebMCPPolyfill() {
  // Guard: don't double-inject
  if ((window as any).__oc_webmcp_version !== undefined) return

  // Internal tool registry
  interface WebMCPTool {
    name: string
    description: string
    inputSchema?: Record<string, unknown>
    readOnlyHint?: boolean
    execute: (args: Record<string, unknown>) => unknown | Promise<unknown>
  }

  const toolRegistry = new Map<string, WebMCPTool>()
  const contextStore = new Map<string, unknown>()
  let version = 0

  // === Public API: navigator.modelContext ===
  const modelContext = {
    registerTool(descriptor: {
      name: string
      description: string
      inputSchema?: Record<string, unknown>
      readOnlyHint?: boolean
      execute: (args: Record<string, unknown>) => unknown | Promise<unknown>
    }): void {
      if (!descriptor?.name || typeof descriptor.name !== 'string') {
        throw new TypeError('registerTool requires a name string')
      }
      if (typeof descriptor.execute !== 'function') {
        throw new TypeError('registerTool requires an execute function')
      }
      toolRegistry.set(descriptor.name, {
        name: descriptor.name,
        description: descriptor.description || '',
        inputSchema: descriptor.inputSchema,
        readOnlyHint: descriptor.readOnlyHint,
        execute: descriptor.execute
      })
      version++
    },

    unregisterTool(name: string): boolean {
      const deleted = toolRegistry.delete(name)
      if (deleted) version++
      return deleted
    },

    provideContext(key: string, value: unknown): void {
      contextStore.set(key, value)
      version++
    },

    clearContext(): void {
      contextStore.clear()
      version++
    },

    get tools(): { name: string; description: string; inputSchema?: Record<string, unknown>; readOnlyHint?: boolean }[] {
      return Array.from(toolRegistry.values()).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        readOnlyHint: t.readOnlyHint
      }))
    },

    get context(): Record<string, unknown> {
      return Object.fromEntries(contextStore)
    }
  }

  // Install on navigator
  try {
    Object.defineProperty(navigator, 'modelContext', {
      get: () => modelContext,
      configurable: true,
      enumerable: true
    })
  } catch { /* CSP may block */ }

  // === Internal API: window.__oc_webmcp_* (used by Oculo MCP bridge) ===

  // List tools — returns descriptors without execute function
  ;(window as any).__oc_webmcp_list = function(): Array<{
    name: string; description: string; inputSchema?: Record<string, unknown>; readOnlyHint?: boolean
  }> {
    return Array.from(toolRegistry.values()).map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      readOnlyHint: t.readOnlyHint
    }))
  }

  // Call a tool by name
  ;(window as any).__oc_webmcp_call = async function(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = toolRegistry.get(name)
    if (!tool) throw new Error(`WebMCP tool "${name}" not found`)
    return tool.execute(args || {})
  }

  // Scan <form toolname="..."> elements and auto-register them as tools
  ;(window as any).__oc_webmcp_scan_declarative = function(): number {
    let count = 0
    const forms = document.querySelectorAll('form[toolname]')
    for (const form of forms) {
      const name = form.getAttribute('toolname')
      if (!name || toolRegistry.has(name)) continue

      const description = form.getAttribute('tooldescription') || form.getAttribute('aria-label') || `Form tool: ${name}`
      const readOnly = form.getAttribute('toolreadonly') === 'true'

      // Build inputSchema from form fields
      const fields: Record<string, unknown> = {}
      const inputs = form.querySelectorAll('input[name],textarea[name],select[name]')
      for (const input of inputs) {
        const fieldName = input.getAttribute('name')!
        const type = input.getAttribute('type') || 'text'
        const required = input.hasAttribute('required')
        const placeholder = input.getAttribute('placeholder') || ''

        let fieldType = 'string'
        if (type === 'number' || type === 'range') fieldType = 'number'
        if (type === 'checkbox') fieldType = 'boolean'

        fields[fieldName] = {
          type: fieldType,
          description: placeholder || `${fieldName} field`,
          ...(required ? {} : {})
        }
      }

      const inputSchema = {
        type: 'object',
        properties: fields,
        required: Array.from(inputs)
          .filter(i => i.hasAttribute('required'))
          .map(i => i.getAttribute('name')!)
          .filter(Boolean)
      }

      // Create execute function that fills and submits the form
      const formRef = form as HTMLFormElement
      const execute = async (args: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(args)) {
          const el = formRef.querySelector(`[name="${key}"]`) as HTMLInputElement | null
          if (!el) continue
          if (el.type === 'checkbox') {
            el.checked = !!value
          } else {
            el.value = String(value)
          }
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        // Submit the form
        formRef.dispatchEvent(new Event('submit', { bubbles: true }))
        return { submitted: true, formName: name }
      }

      toolRegistry.set(name, { name, description, inputSchema, readOnlyHint: readOnly, execute })
      count++
    }
    if (count > 0) version++
    return count
  }

  // Version counter for change detection
  Object.defineProperty(window, '__oc_webmcp_version', {
    get: () => version,
    configurable: true,
    enumerable: false
  })

  // Auto-scan declarative tools when DOM is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    try { (window as any).__oc_webmcp_scan_declarative() } catch { /* ignore */ }
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      try { (window as any).__oc_webmcp_scan_declarative() } catch { /* ignore */ }
    })
  }
})()
