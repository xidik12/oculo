import { BrowserWindow, ipcMain, shell, app, nativeImage, clipboard, webContents, dialog } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { IPC } from '../shared/ipc-channels'
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '../shared/constants'
import { AIProviderConfig } from '../shared/ai-types'
import { SecurityManager } from './security/vault'
import { AuditLog } from './security/audit'
import { Redactor } from './security/redactor'
import { AgentController } from './ai/agent'
import { BookmarkStore } from './data/bookmarks'
import { HistoryStore } from './data/history'
import { DownloadManager } from './data/downloads'
import { ZoomStore } from './data/zoom'
import { RunCache } from './data/run-cache'
import { PtyManager } from './terminal/pty-manager'
import { McpClientManager } from './mcp/client'
import { SessionMemoryStore } from './data/session-memory'
import { ContainerStore } from './data/containers'
import { CardStore } from './data/cards'
import { WorkspaceStore } from './data/workspaces'
import { MacroStore } from './data/macros'
import { PinnedAppStore } from './data/pinned-apps'
import { PatternDetector } from './data/pattern-detector'
import { WatcherStore } from './data/watchers'

export function setupIPC(
  mainWindow: BrowserWindow,
  security: SecurityManager,
  audit: AuditLog,
  redactor: Redactor,
  agent?: AgentController,
  bookmarkStore?: BookmarkStore,
  historyStore?: HistoryStore,
  downloadManager?: DownloadManager,
  zoomStore?: ZoomStore,
  runCache?: RunCache,
  ptyManager?: PtyManager,
  mcpClientManager?: McpClientManager,
  sessionMemoryStore?: SessionMemoryStore,
  containerStore?: ContainerStore,
  cardStore?: CardStore,
  workspaceStore?: WorkspaceStore,
  macroStore?: MacroStore,
  pinnedAppStore?: PinnedAppStore,
  patternDetector?: PatternDetector,
  watcherStore?: WatcherStore
): void {
  // Tab management - forwarded to renderer
  ipcMain.handle(IPC.TAB_CREATE, async (_, url?: string) => {
    mainWindow.webContents.send(IPC.TAB_CREATE, url)
    return true
  })

  ipcMain.handle(IPC.TAB_CLOSE, async (_, tabId: string) => {
    mainWindow.webContents.send(IPC.TAB_CLOSE, tabId)
    return true
  })

  ipcMain.handle(IPC.TAB_SWITCH, async (_, tabId: string) => {
    mainWindow.webContents.send(IPC.TAB_SWITCH, tabId)
    return true
  })

  // Navigation
  ipcMain.handle(IPC.NAV_GO, async (_, tabId: string, url: string) => {
    mainWindow.webContents.send(IPC.NAV_GO, tabId, url)
    return true
  })

  ipcMain.handle(IPC.NAV_BACK, async (_, tabId: string) => {
    mainWindow.webContents.send(IPC.NAV_BACK, tabId)
    return true
  })

  ipcMain.handle(IPC.NAV_FORWARD, async (_, tabId: string) => {
    mainWindow.webContents.send(IPC.NAV_FORWARD, tabId)
    return true
  })

  ipcMain.handle(IPC.NAV_RELOAD, async (_, tabId: string) => {
    mainWindow.webContents.send(IPC.NAV_RELOAD, tabId)
    return true
  })

  // Vault
  ipcMain.handle(IPC.VAULT_LIST, async () => {
    return security.listCredentials()
  })

  ipcMain.handle(IPC.VAULT_ADD, async (_, domain: string, username: string, password: string) => {
    return security.addCredential(domain, username, password)
  })

  ipcMain.handle(IPC.VAULT_DELETE, async (_, id: string) => {
    return security.deleteCredential(id)
  })

  ipcMain.handle(IPC.VAULT_GET, async (_, domain: string) => {
    return security.getCredential(domain)
  })

  // TOTP generation
  ipcMain.handle(IPC.VAULT_TOTP, async (_, domain: string) => {
    return security.generateTOTP(domain)
  })

  // Set TOTP secret
  ipcMain.handle(IPC.VAULT_SET_TOTP, async (_, domain: string, secret: string) => {
    return security.setTotpSecret(domain, secret)
  })

  // Audit
  ipcMain.handle(IPC.AUDIT_QUERY, async (_, limit?: number) => {
    return audit.query(limit || 100)
  })

  // Settings
  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    return security.getSettings()
  })

  ipcMain.handle(IPC.SETTINGS_SET, async (_, settings: Partial<import('../shared/types').AppSettings>) => {
    return security.saveSettings(settings)
  })

  // Permission request from MCP server (uses requestId to handle concurrent requests)
  let permReqCounter = 0
  ipcMain.handle(IPC.PERMISSION_REQUEST, async (_, action: string, details: string) => {
    const requestId = `perm-${++permReqCounter}`
    return new Promise((resolve) => {
      mainWindow.webContents.send(IPC.PERMISSION_REQUEST, { action, details, requestId })
      const handler = (_: any, approved: boolean, respId?: string) => {
        if (!respId || respId === requestId) {
          ipcMain.removeListener(IPC.PERMISSION_RESPONSE, handler)
          resolve(approved)
        }
      }
      ipcMain.on(IPC.PERMISSION_RESPONSE, handler)
      // Timeout after 2 minutes to prevent permanent hangs
      setTimeout(() => {
        ipcMain.removeListener(IPC.PERMISSION_RESPONSE, handler)
        resolve(false)
      }, 120_000)
    })
  })

  // MCP status
  ipcMain.handle(IPC.MCP_STATUS, async () => {
    return { connected: true, serverName: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }
  })

  // Chat Panel
  ipcMain.handle(IPC.CHAT_SEND, async (_, message: string) => {
    if (!agent) return { error: 'Agent not initialized' }
    agent.handleMessage(message).catch((err) => {
      console.error('[Oculo] handleMessage error:', err)
      agent?.emit({ type: 'error', error: String(err?.message || err) })
    })
    return true
  })

  ipcMain.handle(IPC.CHAT_CLEAR, async () => {
    agent?.clear()
    return true
  })

  ipcMain.handle(IPC.CHAT_ABORT, async () => {
    agent?.abort()
    return true
  })

  ipcMain.handle(IPC.CHAT_GET_STATUS, async () => {
    return agent?.getStatus() || { hasClaudeCode: false, messageCount: 0, activeProvider: 'claude', activeModel: 'claude-sonnet-4-6' }
  })

  // AI Provider Management
  ipcMain.handle(IPC.AI_SET_PROVIDER, async (_, providerId: string, modelId?: string) => {
    agent?.setActiveProvider(providerId as any, modelId)
    return true
  })

  ipcMain.handle(IPC.AI_SET_CONFIG, async (_, config: { providerId: string; enabled?: boolean; apiKey?: string; modelId?: string }) => {
    agent?.setProviderConfig(config as AIProviderConfig)
    return true
  })

  ipcMain.handle(IPC.AI_GET_PROVIDER_STATUS, async (_, providerId: string) => {
    return agent?.getProviderStatus(providerId as any) || { providerId, connected: false, ready: false }
  })

  ipcMain.handle(IPC.AI_GET_ACTIVE, async () => {
    return agent?.getActiveProvider() || { providerId: 'claude', modelId: 'claude-sonnet-4-6' }
  })

  // === AI Quick Complete (v0.3.0) ===
  ipcMain.handle(IPC.AI_QUICK_COMPLETE, async (_, prompt: string, maxTokens?: number) => {
    return agent?.quickComplete(prompt, maxTokens || 100) || ''
  })

  // === Auth (in-app OAuth) ===
  ipcMain.handle(IPC.AUTH_LOGIN, async (_, providerId: string) => {
    if (!agent) return { success: false, error: 'Agent not initialized' }
    if (providerId === 'claude') return agent.startClaudeAuth()
    if (providerId === 'codex') return agent.startCodexAuth()
    return { success: false, error: `Unknown provider: ${providerId}` }
  })

  ipcMain.handle(IPC.AUTH_LOGOUT, async (_, providerId: string) => {
    if (!agent) return { success: false, error: 'Agent not initialized' }
    if (providerId === 'claude') {
      agent.signOut('claude')
      return { success: true }
    }
    if (providerId === 'codex') {
      agent.signOut('openai')
      return { success: true }
    }
    return { success: false, error: `Unknown provider: ${providerId}` }
  })

  ipcMain.handle(IPC.AUTH_STATUS, async () => {
    return agent?.getStatus() || { loggedIn: false }
  })

  // === Bookmarks ===
  ipcMain.handle(IPC.BOOKMARKS_LIST, async () => {
    return bookmarkStore?.list() || []
  })

  ipcMain.handle(IPC.BOOKMARKS_ADD, async (_, title: string, url: string, favicon?: string) => {
    return bookmarkStore?.add(title, url, favicon) || null
  })

  ipcMain.handle(IPC.BOOKMARKS_UPDATE, async (_, id: string, updates: Partial<import('../shared/types').Bookmark>) => {
    return bookmarkStore?.update(id, updates) || null
  })

  ipcMain.handle(IPC.BOOKMARKS_DELETE, async (_, id: string) => {
    return bookmarkStore?.delete(id) || false
  })

  ipcMain.handle(IPC.BOOKMARKS_FIND_URL, async (_, url: string) => {
    return bookmarkStore?.findByUrl(url) || null
  })

  // === History ===
  ipcMain.handle(IPC.HISTORY_ADD, async (_, url: string, title: string, favicon?: string) => {
    historyStore?.addVisit(url, title, favicon)
    return true
  })

  ipcMain.handle(IPC.HISTORY_LIST, async (_, query?: string, limit?: number) => {
    if (query) return historyStore?.search(query, limit) || []
    return historyStore?.getRecent(limit) || []
  })

  ipcMain.handle(IPC.HISTORY_CLEAR, async () => {
    historyStore?.clear()
    return true
  })

  ipcMain.handle(IPC.HISTORY_DELETE_URL, async (_, url: string) => {
    historyStore?.deleteUrl(url)
    return true
  })

  // === Downloads ===
  ipcMain.handle(IPC.DOWNLOADS_LIST, async () => {
    return downloadManager?.list() || []
  })

  ipcMain.handle(IPC.DOWNLOADS_CANCEL, async (_, id: string) => {
    downloadManager?.cancel(id)
    return true
  })

  ipcMain.handle(IPC.DOWNLOADS_OPEN, async (_, savePath: string) => {
    downloadManager?.openFile(savePath)
    return true
  })

  ipcMain.handle(IPC.DOWNLOADS_SHOW_IN_FOLDER, async (_, savePath: string) => {
    downloadManager?.showInFolder(savePath)
    return true
  })

  // === Zoom ===
  ipcMain.handle(IPC.ZOOM_GET, async (_, domain: string) => {
    return zoomStore?.getZoom(domain) ?? 1.0
  })

  ipcMain.handle(IPC.ZOOM_SET, async (_, domain: string, level: number) => {
    zoomStore?.setZoom(domain, level)
    return true
  })

  ipcMain.handle(IPC.ZOOM_RESET, async (_, domain: string) => {
    zoomStore?.resetZoom(domain)
    return true
  })

  // === Open external URL in default browser ===
  ipcMain.on(IPC.OPEN_EXTERNAL, (_, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:'))) {
      shell.openExternal(url)
    }
  })

  // === Open file with system default app ===
  ipcMain.handle(IPC.OPEN_FILE, async (_, filePath: string) => {
    if (!filePath || typeof filePath !== 'string') return 'Invalid file path'
    const resolved = path.resolve(filePath.replace(/^~\//, os.homedir() + '/'))
    if (!fs.existsSync(resolved)) return 'File not found'
    // Block executable file types
    const blockedExts = new Set(['.app', '.exe', '.bat', '.cmd', '.sh', '.bash', '.zsh', '.ps1', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.run', '.bin', '.command', '.jar', '.dll', '.so', '.dylib'])
    const ext = path.extname(resolved).toLowerCase()
    if (blockedExts.has(ext)) return 'Cannot open executable files'
    // Restrict to safe directories
    const safeDirs = [app.getPath('temp'), app.getPath('downloads'), app.getPath('desktop'), app.getPath('pictures'), app.getPath('documents')]
    let real: string
    try { real = fs.realpathSync(resolved) } catch { return 'Cannot resolve file path' }
    const inSafeDir = safeDirs.some(dir => real.startsWith(dir))
    if (!inSafeDir) return 'Cannot open files outside safe directories (downloads, desktop, pictures, documents)'
    return shell.openPath(real)
  })

  // === File dialog (pick files) ===
  ipcMain.handle(IPC.FILE_DIALOG_OPEN, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] },
        { name: 'Documents', extensions: ['pdf', 'txt', 'md', 'json', 'csv', 'xml', 'html'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  })

  // === Screenshot Save (Phase 1) ===
  ipcMain.handle(IPC.SCREENSHOT_SAVE, async (_, base64Png: string) => {
    const dir = path.join(app.getPath('pictures'), 'Oculo')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `screenshot-${Date.now()}.png`)
    const buffer = Buffer.from(base64Png, 'base64')
    fs.writeFileSync(filePath, buffer)
    return filePath
  })

  // === File Upload via CDP (Phase 2) ===
  ipcMain.handle(IPC.FILE_UPLOAD, async (_, wcId: number, selector: string, filePaths: string[]) => {
    // Validate file paths — only allow pictures, temp, downloads, desktop
    const allowedDirs = [
      app.getPath('pictures'),
      app.getPath('temp'),
      app.getPath('downloads'),
      app.getPath('desktop'),
    ]
    for (const fp of filePaths) {
      const resolved = path.resolve(fp)
      const allowed = allowedDirs.some(dir => resolved.startsWith(dir))
      if (!allowed) {
        return `Error: File path "${fp}" is outside allowed directories (pictures, temp, downloads, desktop)`
      }
      if (!fs.existsSync(resolved)) {
        return `Error: File not found: ${fp}`
      }
    }

    try {
      const wc = webContents.fromId(wcId)
      if (!wc || wc.isDestroyed()) return 'Error: WebContents not found'

      wc.debugger.attach('1.3')
      try {
        const { root } = await wc.debugger.sendCommand('DOM.getDocument', {})
        const { nodeId } = await wc.debugger.sendCommand('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: selector || 'input[type=file]'
        })
        if (!nodeId) {
          return 'Error: File input element not found with selector: ' + (selector || 'input[type=file]')
        }
        await wc.debugger.sendCommand('DOM.setFileInputFiles', {
          nodeId,
          files: filePaths.map(fp => path.resolve(fp))
        })
        return `Uploaded ${filePaths.length} file(s) to ${selector || 'input[type=file]'}`
      } finally {
        try { wc.debugger.detach() } catch { /* already detached */ }
      }
    } catch (err) {
      return `Error: CDP file upload failed — ${(err as Error).message}`
    }
  })

  // === Download Trigger (Phase 4) ===
  ipcMain.handle(IPC.DOWNLOAD_TRIGGER, async (_, url: string) => {
    if (!mainWindow || mainWindow.isDestroyed()) return 'Error: Window not available'
    if (!url || typeof url !== 'string') return 'Error: Invalid URL'
    try {
      mainWindow.webContents.downloadURL(url)
      return `Download started: ${url}`
    } catch (err) {
      return `Error: Failed to start download — ${(err as Error).message}`
    }
  })

  // === Sandboxed File Read (Phase 4) ===
  // Allows reading from temp/downloads/desktop, plus the directory tree of any file:// page URL
  ipcMain.handle(IPC.FILE_READ_SAFE, async (_, filePath: string, pageUrl?: string) => {
    const allowedDirs = [
      app.getPath('temp'),
      app.getPath('downloads'),
      app.getPath('desktop'),
    ]
    // If the current page is a file:// URL, allow reading in its directory tree
    if (pageUrl && pageUrl.startsWith('file://')) {
      try {
        const pageFilePath = decodeURIComponent(new URL(pageUrl).pathname)
        allowedDirs.push(path.dirname(pageFilePath))
      } catch { /* invalid URL, skip */ }
    }
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved)) {
      return `Error: File not found: ${filePath}`
    }
    // Resolve symlinks to prevent path traversal
    let real: string
    try { real = fs.realpathSync(resolved) } catch { return `Error: Cannot resolve file path: ${filePath}` }
    const allowed = allowedDirs.some(dir => real.startsWith(dir))
    if (!allowed) {
      return `Error: Cannot read file outside allowed directories (temp, downloads, desktop, or current file:// dir): ${filePath}`
    }
    try {
      const stat = fs.statSync(real)
      if (stat.size > 1024 * 1024) {
        return `Error: File too large (${Math.round(stat.size / 1024)}KB, max 1MB)`
      }
      return fs.readFileSync(real, 'utf-8')
    } catch (err) {
      return `Error: Failed to read file — ${(err as Error).message}`
    }
  })

  // === Sandboxed File Write (local file editing) ===
  // Allows writing to the directory tree of a file:// page URL, plus temp/downloads/desktop
  ipcMain.handle(IPC.FILE_WRITE_SAFE, async (_, filePath: string, content: string, pageUrl?: string) => {
    const allowedDirs = [
      app.getPath('temp'),
      app.getPath('downloads'),
      app.getPath('desktop'),
    ]
    if (pageUrl && pageUrl.startsWith('file://')) {
      try {
        const pageFilePath = decodeURIComponent(new URL(pageUrl).pathname)
        allowedDirs.push(path.dirname(pageFilePath))
      } catch { /* invalid URL, skip */ }
    }
    const resolved = path.resolve(filePath)
    // For writes, check parent dir exists and resolve symlinks
    const parentDir = path.dirname(resolved)
    let realParent: string
    try { realParent = fs.realpathSync(parentDir) } catch { return `Error: Cannot resolve directory: ${parentDir}` }
    const allowed = allowedDirs.some(dir => realParent.startsWith(dir))
    if (!allowed) {
      return `Error: Cannot write file outside allowed directories (temp, downloads, desktop, or current file:// dir): ${filePath}`
    }
    try {
      const realPath = path.join(realParent, path.basename(resolved))
      fs.writeFileSync(realPath, content, 'utf-8')
      return `Written ${content.length} bytes to ${filePath}`
    } catch (err) {
      return `Error: Failed to write file — ${(err as Error).message}`
    }
  })

  // === Accessibility Tree Snapshot via CDP ===
  ipcMain.handle(IPC.A11Y_SNAPSHOT, async (_, wcId: number) => {
    try {
      const wc = webContents.fromId(wcId)
      if (!wc || wc.isDestroyed()) return 'Error: WebContents not found'

      wc.debugger.attach('1.3')
      try {
        // Get the full accessibility tree from Chrome
        const { nodes } = await wc.debugger.sendCommand('Accessibility.getFullAXTree', {})

        // Process nodes into a compact format
        const lines: string[] = []
        let refIndex = 0

        // Ref map: ref ID → full ElementFingerprint for 3-tier resolution
        const refMap: Record<string, import('../shared/types').ElementFingerprint> = {}

        // Map nodeId -> node for parent lookup
        const nodeMap = new Map<string, any>()
        for (const node of nodes) {
          nodeMap.set(node.nodeId, node)
        }

        // Track ref → backendDOMNodeId for bulk CDP enrichment
        const refsToEnrich: { refId: string; backendDOMNodeId: number }[] = []

        for (const node of nodes) {
          const role = node.role?.value || ''
          const name = node.name?.value || ''
          const value = node.value?.value || ''
          const description = node.description?.value || ''

          // Skip generic/structural roles
          if (['none', 'generic', 'GenericContainer', 'InlineTextBox', 'StaticText', 'paragraph', 'Section', 'Div', 'group'].includes(role)) continue
          // Skip ignored nodes
          if (node.ignored) continue
          // Skip nodes with no useful info
          if (!name && !value && !description) continue

          // Determine if this is an interactive element
          const interactive = ['textbox', 'button', 'link', 'checkbox', 'radio', 'combobox',
            'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'menuitem',
            'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem'].includes(role)

          // Determine if this is a structural/info element worth showing
          const structural = ['heading', 'navigation', 'main', 'complementary', 'banner',
            'contentinfo', 'form', 'dialog', 'alertdialog', 'alert', 'status',
            'img', 'figure', 'table', 'list', 'listitem', 'article', 'region',
            'tablist', 'tabpanel', 'menu', 'menubar', 'toolbar', 'tree'].includes(role)

          if (!interactive && !structural) continue

          // Build the line
          let line = ''
          if (interactive) {
            refIndex++
            const refId = `e${refIndex}`
            line = `  [ref=${refId}] ${role}`

            // Extract a11y properties for fingerprint
            let checked: boolean | undefined
            let disabled: boolean | undefined
            let expanded: boolean | undefined
            let required: boolean | undefined
            if (node.properties) {
              for (const prop of node.properties) {
                if (prop.name === 'checked' && prop.value?.value) checked = true
                if (prop.name === 'disabled' && prop.value?.value) disabled = true
                if (prop.name === 'expanded' && prop.value?.value !== undefined) expanded = prop.value.value
                if (prop.name === 'required' && prop.value?.value) required = true
              }
            }

            // Find parent a11y node for parentRole/parentName (free — already in nodeMap)
            let parentRole: string | undefined
            let parentName: string | undefined
            if (node.parentId) {
              const parentNode = nodeMap.get(node.parentId)
              if (parentNode) {
                const pr = parentNode.role?.value || ''
                if (pr && !['none', 'generic', 'GenericContainer'].includes(pr)) {
                  parentRole = pr
                  parentName = (parentNode.name?.value || '').substring(0, 40) || undefined
                }
              }
            }

            // Store full fingerprint in refMap
            refMap[refId] = {
              name: name.substring(0, 80),
              role,
              backendDOMNodeId: node.backendDOMNodeId,
              parentRole,
              parentName,
              checked,
              disabled,
              expanded,
              required,
            }

            // Queue for CDP bulk enrichment
            if (node.backendDOMNodeId && refsToEnrich.length < 100) {
              refsToEnrich.push({ refId, backendDOMNodeId: node.backendDOMNodeId })
            }
          } else {
            line = `  ${role}`
          }

          if (name) line += ` "${name.substring(0, 80)}"`

          // Add properties
          const props: string[] = []
          if (value) props.push(`value="${value.substring(0, 40)}"`)
          if (node.properties) {
            for (const prop of node.properties) {
              if (prop.name === 'checked' && prop.value?.value) props.push('checked')
              if (prop.name === 'selected' && prop.value?.value) props.push('selected')
              if (prop.name === 'disabled' && prop.value?.value) props.push('disabled')
              if (prop.name === 'required' && prop.value?.value) props.push('required')
              if (prop.name === 'expanded' && prop.value?.value !== undefined) props.push(prop.value.value ? 'expanded' : 'collapsed')
              if (prop.name === 'focused' && prop.value?.value) props.push('focused')
              if (prop.name === 'level' && prop.value?.value) props.push(`level=${prop.value.value}`)
            }
          }
          if (props.length) line += ` (${props.join(', ')})`

          lines.push(line)
        }

        // Bulk-enrich fingerprints via CDP (tagName, classes, bbox, domDepth, etc.)
        // Cap at 100 elements, ~50ms overhead. Graceful degradation if CDP fails.
        if (refsToEnrich.length > 0) {
          try {
            await wc.debugger.sendCommand('DOM.getDocument', {})
            const enrichPromises = refsToEnrich.map(async ({ refId, backendDOMNodeId }) => {
              try {
                const { object } = await wc.debugger.sendCommand('DOM.resolveNode', { backendNodeId: backendDOMNodeId })
                if (!object?.objectId) return
                const { result: enrichResult } = await wc.debugger.sendCommand('Runtime.callFunctionOn', {
                  objectId: object.objectId,
                  functionDeclaration: `function() {
                    var el = this;
                    var rect = el.getBoundingClientRect();
                    var depth = 0; var p = el; while (p.parentElement) { depth++; p = p.parentElement; }
                    var idx = 0; if (el.parentElement) { var sibs = Array.from(el.parentElement.children); idx = sibs.indexOf(el); }
                    return {
                      tagName: el.tagName?.toLowerCase() || '',
                      inputType: el.type || '',
                      href: el.href || '',
                      innerText: (el.innerText || el.textContent || '').trim().substring(0, 80),
                      ariaLabel: el.getAttribute('aria-label') || '',
                      placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
                      classes: Array.from(el.classList || []).slice(0, 3),
                      boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                      siblingIndex: idx,
                      domDepth: depth
                    };
                  }`,
                  returnByValue: true
                })
                if (enrichResult?.value && refMap[refId]) {
                  const v = enrichResult.value
                  refMap[refId].tagName = v.tagName || undefined
                  refMap[refId].inputType = v.inputType || undefined
                  refMap[refId].href = v.href || undefined
                  refMap[refId].innerText = v.innerText || undefined
                  refMap[refId].ariaLabel = v.ariaLabel || undefined
                  refMap[refId].placeholder = v.placeholder || undefined
                  refMap[refId].classes = v.classes?.length ? v.classes : undefined
                  refMap[refId].boundingBox = v.boundingBox || undefined
                  refMap[refId].siblingIndex = v.siblingIndex
                  refMap[refId].domDepth = v.domDepth
                }
                // Release the object
                try { await wc.debugger.sendCommand('Runtime.releaseObject', { objectId: object.objectId }) } catch { /* ok */ }
              } catch { /* single element enrichment failed, skip */ }
            })
            await Promise.all(enrichPromises)
          } catch { /* bulk enrichment failed entirely, fingerprints still have a11y data */ }
        }

        // Add URL and title at the top
        const url = wc.getURL()
        const title = wc.getTitle()
        const header = `URL: ${url}\nTitle: ${title}\n\nAccessibility tree (${refIndex} interactive elements):`

        // Append refMap as structured block for renderer to parse and strip
        const snapshot = header + '\n' + lines.join('\n')
        return snapshot + '\n---REFMAP---\n' + JSON.stringify(refMap)
      } finally {
        try { wc.debugger.detach() } catch { /* already detached */ }
      }
    } catch (err) {
      return `Error: Failed to get accessibility tree — ${(err as Error).message}`
    }
  })

  // === Adaptive Element Resolution: RESOLVE_NODE via CDP ===
  // Given a backendNodeId, checks if the DOM node is still alive and returns a unique CSS selector
  ipcMain.handle(IPC.RESOLVE_NODE, async (_, wcId: number, backendNodeId: number) => {
    try {
      const wc = webContents.fromId(wcId)
      if (!wc || wc.isDestroyed()) return { alive: false }

      wc.debugger.attach('1.3')
      try {
        await wc.debugger.sendCommand('DOM.getDocument', {})
        const { object } = await wc.debugger.sendCommand('DOM.resolveNode', { backendNodeId })
        if (!object?.objectId) return { alive: false }

        // Check isConnected and build a unique selector
        const { result } = await wc.debugger.sendCommand('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: `function() {
            var el = this;
            if (!el.isConnected) return { alive: false };
            // Build unique CSS selector
            if (el.id) return { alive: true, selector: '#' + CSS.escape(el.id) };
            var path = [];
            var current = el;
            while (current && current !== document.body && current !== document.documentElement) {
              var tag = current.tagName.toLowerCase();
              if (current.id) { path.unshift('#' + CSS.escape(current.id)); break; }
              var parent = current.parentElement;
              if (parent) {
                var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === current.tagName; });
                if (siblings.length > 1) {
                  var index = siblings.indexOf(current) + 1;
                  tag += ':nth-of-type(' + index + ')';
                }
              }
              path.unshift(tag);
              current = current.parentElement;
            }
            return { alive: true, selector: path.join(' > ') };
          }`,
          returnByValue: true
        })
        try { await wc.debugger.sendCommand('Runtime.releaseObject', { objectId: object.objectId }) } catch { /* ok */ }
        return result?.value || { alive: false }
      } finally {
        try { wc.debugger.detach() } catch { /* already detached */ }
      }
    } catch {
      return { alive: false }
    }
  })

  // === Clipboard Write Image (Phase 5) ===
  ipcMain.handle(IPC.CLIPBOARD_WRITE_IMAGE, async (_, base64Png: string) => {
    try {
      const buffer = Buffer.from(base64Png, 'base64')
      const img = nativeImage.createFromBuffer(buffer)
      clipboard.writeImage(img)
      return true
    } catch {
      return false
    }
  })

  // === Run Cache (Compile-to-Code) ===
  ipcMain.handle('run-cache:save', async (_, url: string, steps: any[], description?: string) => {
    return runCache?.saveWorkflow(url, steps, description) || null
  })

  ipcMain.handle('run-cache:find', async (_, url: string) => {
    return runCache?.findForUrl(url) || []
  })

  ipcMain.handle('run-cache:get', async (_, id: string) => {
    return runCache?.getWorkflow(id) || null
  })

  ipcMain.handle('run-cache:mark-failed', async (_, id: string) => {
    runCache?.markFailed(id)
    return true
  })

  ipcMain.handle('run-cache:mark-success', async (_, id: string) => {
    runCache?.markSuccess(id)
    return true
  })

  ipcMain.handle('run-cache:summary', async (_, domain: string) => {
    return runCache?.getSummaryForDomain(domain) || ''
  })

  // === Skills (tested workflows) ===
  ipcMain.handle('run-cache:skills', async (_, domain?: string) => {
    if (domain) return runCache?.getSkillsForDomain(domain) || []
    return runCache?.getSkillsSummary() || ''
  })

  // === Print to PDF ===
  ipcMain.handle(IPC.PRINT_TO_PDF, async (_, wcId: number) => {
    try {
      const wc = webContents.fromId(wcId)
      if (!wc || wc.isDestroyed()) return 'Error: WebContents not found'
      const pdfData = await wc.printToPDF({
        printBackground: true,
        landscape: false,
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
      })
      const dir = path.join(app.getPath('temp'), 'oculo-pdfs')
      fs.mkdirSync(dir, { recursive: true })
      const filePath = path.join(dir, `page-${Date.now()}.pdf`)
      fs.writeFileSync(filePath, pdfData)
      return filePath
    } catch (err) {
      return `Error: PDF generation failed — ${(err as Error).message}`
    }
  })

  // === Network Interception via CDP ===
  ipcMain.handle('network:intercept', async (_, wcId: number, enable: boolean) => {
    try {
      const wc = webContents.fromId(wcId)
      if (!wc || wc.isDestroyed()) return 'Error: WebContents not found'

      if (enable) {
        // Start intercepting
        try { wc.debugger.attach('1.3') } catch { /* already attached */ }
        await wc.debugger.sendCommand('Network.enable', {})

        // Store captured requests in a map
        if (!(wc as any).__oculo_network) {
          (wc as any).__oculo_network = []
        }

        // Remove previous listener if any to prevent leaks
        if ((wc as any).__oculo_network_listener) {
          wc.debugger.removeListener('message', (wc as any).__oculo_network_listener)
        }

        const listener = (_event: any, method: string, params: any) => {
          if (method === 'Network.responseReceived') {
            const entry = {
              url: params.response?.url || '',
              status: params.response?.status || 0,
              mimeType: params.response?.mimeType || '',
              method: params.type || 'GET',
              requestId: params.requestId,
              headers: params.response?.headers || {}
            }
            ;(wc as any).__oculo_network.push(entry)
            // Cap at 100 entries
            if ((wc as any).__oculo_network.length > 100) {
              (wc as any).__oculo_network = (wc as any).__oculo_network.slice(-50)
            }
          }
        }
        ;(wc as any).__oculo_network_listener = listener
        wc.debugger.on('message', listener)

        return 'Network interception started via CDP'
      } else {
        // Return captured data and stop
        const data = (wc as any).__oculo_network || []
        // Remove the listener before detaching
        if ((wc as any).__oculo_network_listener) {
          wc.debugger.removeListener('message', (wc as any).__oculo_network_listener)
          ;(wc as any).__oculo_network_listener = null
        }
        try { wc.debugger.detach() } catch { /* not attached */ }
        ;(wc as any).__oculo_network = []
        return JSON.stringify(data.slice(-20))
      }
    } catch (err) {
      return `Error: ${(err as Error).message}`
    }
  })

  // === Get response body for a specific request ===
  ipcMain.handle('network:get-body', async (_, wcId: number, requestId: string) => {
    try {
      const wc = webContents.fromId(wcId)
      if (!wc || wc.isDestroyed()) return 'Error: WebContents not found'

      const { body, base64Encoded } = await wc.debugger.sendCommand('Network.getResponseBody', { requestId })
      if (base64Encoded) {
        return '(base64 encoded, ' + body.length + ' chars)'
      }
      return body.substring(0, 5000) // Cap at 5KB
    } catch (err) {
      return `Error: ${(err as Error).message}`
    }
  })

  // === Lessons for MCP ===
  ipcMain.handle('lessons:for-domain', async (_, domain: string) => {
    if (!agent) return ''
    try {
      const lessons = agent.getLessons() as Array<{ text: string }>
      const domainRoot = domain.split('.').slice(-2, -1)[0]?.toLowerCase() || ''
      const relevant = lessons.filter(l =>
        l.text.toLowerCase().includes(domain.toLowerCase()) ||
        (domainRoot && l.text.toLowerCase().includes(domainRoot))
      )
      if (!relevant.length) return ''
      return '\nLearned from past experience on this site:\n' +
        relevant.map(l => '  - ' + l.text).join('\n')
    } catch { return '' }
  })

  // === MCP Client (Connected Apps) ===
  ipcMain.handle(IPC.MCP_CLIENT_LIST, async () => {
    return security.getSettings()?.mcpClients || []
  })

  ipcMain.handle(IPC.MCP_CLIENT_ADD, async (_, config: import('../shared/types').McpClientConfig) => {
    const settings = security.getSettings()
    const clients = settings?.mcpClients || []
    clients.push(config)
    security.saveSettings({ mcpClients: clients })
    if (config.enabled && mcpClientManager) {
      await mcpClientManager.connect(config)
    }
    return true
  })

  ipcMain.handle(IPC.MCP_CLIENT_REMOVE, async (_, serverId: string) => {
    if (mcpClientManager) await mcpClientManager.disconnect(serverId)
    const settings = security.getSettings()
    const clients = (settings?.mcpClients || []).filter(c => c.id !== serverId)
    security.saveSettings({ mcpClients: clients })
    return true
  })

  ipcMain.handle(IPC.MCP_CLIENT_TOGGLE, async (_, serverId: string, enabled: boolean) => {
    const settings = security.getSettings()
    const clients = settings?.mcpClients || []
    const cfg = clients.find(c => c.id === serverId)
    if (!cfg) return false
    cfg.enabled = enabled
    security.saveSettings({ mcpClients: clients })
    if (mcpClientManager) {
      if (enabled) await mcpClientManager.connect(cfg)
      else await mcpClientManager.disconnect(serverId)
    }
    return true
  })

  ipcMain.handle(IPC.MCP_CLIENT_STATUS, async () => {
    return mcpClientManager?.getStatus() || []
  })

  ipcMain.handle(IPC.MCP_CLIENT_TOOLS, async () => {
    return mcpClientManager?.listAllTools() || []
  })

  ipcMain.handle(IPC.MCP_CLIENT_CALL, async (_, namespacedName: string, args: Record<string, unknown>) => {
    if (!mcpClientManager) return 'Error: MCP client not initialized'
    return mcpClientManager.callTool(namespacedName, args || {})
  })

  // === Session Memory ===
  ipcMain.handle(IPC.MEMORY_LIST, async () => {
    return sessionMemoryStore?.list() || []
  })

  ipcMain.handle(IPC.MEMORY_ADD, async (_, summary: string, urls: string[], tags?: string[]) => {
    return sessionMemoryStore?.add(summary, urls, tags) || null
  })

  ipcMain.handle(IPC.MEMORY_CLEAR, async () => {
    sessionMemoryStore?.clear()
    return true
  })

  // === Containers ===
  ipcMain.handle(IPC.CONTAINER_LIST, async () => {
    return containerStore?.list() || []
  })

  ipcMain.handle(IPC.CONTAINER_CREATE, async (_, name: string, color: string, icon: string) => {
    return containerStore?.create(name, color, icon) || null
  })

  ipcMain.handle(IPC.CONTAINER_UPDATE, async (_, id: string, updates: Partial<Pick<import('../shared/types').Container, 'name' | 'color' | 'icon'>>) => {
    return containerStore?.update(id, updates) || null
  })

  ipcMain.handle(IPC.CONTAINER_DELETE, async (_, id: string) => {
    return containerStore?.delete(id) || false
  })

  // === Cards / AI Skills ===
  ipcMain.handle(IPC.CARD_LIST, async () => {
    return cardStore?.list() || []
  })

  ipcMain.handle(IPC.CARD_CREATE, async (_, name: string, icon: string, systemInstruction: string, triggerDomains?: string[]) => {
    return cardStore?.create(name, icon, systemInstruction, triggerDomains) || null
  })

  ipcMain.handle(IPC.CARD_UPDATE, async (_, id: string, updates: Partial<Omit<import('../shared/types').Card, 'id' | 'createdAt'>>) => {
    return cardStore?.update(id, updates) || null
  })

  ipcMain.handle(IPC.CARD_DELETE, async (_, id: string) => {
    return cardStore?.delete(id) || false
  })

  ipcMain.handle(IPC.CARD_ACTIVATE, async (_, id: string) => {
    return cardStore?.activate(id) || null
  })

  // === Workspaces ===
  ipcMain.handle(IPC.WORKSPACE_LIST, async () => {
    return workspaceStore?.list() || []
  })

  ipcMain.handle(IPC.WORKSPACE_CREATE, async (_, name: string, color: string) => {
    return workspaceStore?.create(name, color) || null
  })

  ipcMain.handle(IPC.WORKSPACE_SWITCH, async (_, id: string) => {
    return workspaceStore?.get(id) || null
  })

  ipcMain.handle(IPC.WORKSPACE_DELETE, async (_, id: string) => {
    return workspaceStore?.delete(id) || false
  })

  ipcMain.handle(IPC.WORKSPACE_SAVE, async (_, id: string, tabIds: string[], tabUrls: string[], aiHistory: Array<{ role: string; content: unknown }>) => {
    workspaceStore?.saveState(id, tabIds, tabUrls, aiHistory)
    return true
  })

  // === Macros ===
  ipcMain.handle(IPC.MACRO_LIST, async () => {
    return macroStore?.list() || []
  })

  ipcMain.handle(IPC.MACRO_CREATE, async (_, name: string, steps: import('../shared/types').PipelineStep[], shortcut?: string, description?: string) => {
    return macroStore?.create(name, steps, shortcut, description) || null
  })

  ipcMain.handle(IPC.MACRO_UPDATE, async (_, id: string, updates: Partial<Omit<import('../shared/types').Macro, 'id' | 'createdAt'>>) => {
    return macroStore?.update(id, updates) || null
  })

  ipcMain.handle(IPC.MACRO_DELETE, async (_, id: string) => {
    return macroStore?.delete(id) || false
  })

  // === Run Cache (Pipelines Panel) ===
  ipcMain.handle(IPC.RUN_CACHE_LIST, async () => {
    return runCache?.list() || []
  })

  ipcMain.handle(IPC.RUN_CACHE_DELETE, async (_, id: string) => {
    return runCache?.delete(id) || false
  })

  // === Pipeline Pattern Detection ===
  ipcMain.handle(IPC.PIPELINE_DISMISS, async (_, id: string) => {
    patternDetector?.dismiss(id)
    return true
  })

  ipcMain.handle(IPC.MACRO_EXECUTE, async (_, id: string) => {
    const macro = macroStore?.get(id)
    if (!macro) return false
    mainWindow.webContents.send(IPC.MACRO_EXECUTE, macro)
    return true
  })

  // === Pinned Sidebar Apps ===
  ipcMain.handle(IPC.PINNED_APP_LIST, async () => {
    return pinnedAppStore?.list() || []
  })

  ipcMain.handle(IPC.PINNED_APP_ADD, async (_, url: string, title: string, favicon?: string, width?: number) => {
    return pinnedAppStore?.add(url, title, favicon, width) || null
  })

  ipcMain.handle(IPC.PINNED_APP_REMOVE, async (_, id: string) => {
    return pinnedAppStore?.remove(id) || false
  })

  ipcMain.handle(IPC.PINNED_APP_UPDATE, async (_, id: string, updates: Partial<Pick<import('../shared/types').PinnedApp, 'title' | 'favicon' | 'width' | 'position'>>) => {
    return pinnedAppStore?.update(id, updates) || null
  })

  ipcMain.handle(IPC.PINNED_APP_SAVE, async (_, apps: import('../shared/types').PinnedApp[]) => {
    pinnedAppStore?.saveAll(apps)
    return true
  })

  // === Session Cookies Export/Import ===
  ipcMain.handle(IPC.COOKIES_EXPORT, async (_, url?: string) => {
    try {
      const { session } = require('electron')
      const filter = url ? { url } : {}
      const cookies = await session.defaultSession.cookies.get(filter)
      return cookies.map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: c.expirationDate
      }))
    } catch (e: any) {
      return { error: e.message }
    }
  })

  ipcMain.handle(IPC.COOKIES_IMPORT, async (_, cookies: any[]) => {
    try {
      const { session } = require('electron')
      let imported = 0
      let skipped = 0
      for (const cookie of cookies) {
        // Validate required fields
        if (typeof cookie.name !== 'string' || !cookie.name ||
            typeof cookie.value !== 'string' ||
            typeof cookie.domain !== 'string' || !cookie.domain) {
          skipped++
          continue
        }
        const url = `http${cookie.secure ? 's' : ''}://${cookie.domain?.replace(/^\./, '')}${cookie.path || '/'}`
        await session.defaultSession.cookies.set({
          url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite || 'lax',
          expirationDate: cookie.expirationDate
        })
        imported++
      }
      return { success: true, imported, skipped }
    } catch (e: any) {
      return { error: e.message }
    }
  })

  // === CAPTCHA Solving (CDP-based, main process) ===
  ipcMain.handle(IPC.CAPTCHA_SOLVE, async (_, webContentsId: number) => {
    try {
      const { webContents } = require('electron')
      const wc = webContents.fromId(webContentsId)
      if (!wc || wc.isDestroyed()) return { error: 'WebContents not found' }
      const { CaptchaStrategy } = require('./captcha/strategy')
      const strategy = new CaptchaStrategy()
      const result = await strategy.solve(wc)
      return { success: true, message: result }
    } catch (e: any) {
      return { error: e.message }
    }
  })

  // === Webpage Change Monitoring (v0.3.0) ===
  ipcMain.handle(IPC.WATCHER_LIST, async () => {
    return watcherStore?.list() || []
  })

  ipcMain.handle(IPC.WATCHER_ADD, async (_, url: string, intervalMs?: number) => {
    return watcherStore?.add(url, intervalMs) || null
  })

  ipcMain.handle(IPC.WATCHER_REMOVE, async (_, id: string) => {
    return watcherStore?.remove(id) || false
  })

  // === PTY Terminal ===
  if (ptyManager) {
    ipcMain.on(IPC.PTY_SPAWN, (_event, cols: number, rows: number) => {
      ptyManager.spawn(cols, rows)
    })

    ipcMain.on(IPC.PTY_DATA, (_event, data: string) => {
      ptyManager.write(data)
    })

    ipcMain.on(IPC.PTY_RESIZE, (_event, cols: number, rows: number) => {
      ptyManager.resize(cols, rows)
    })

    ipcMain.on(IPC.PTY_KILL, () => {
      ptyManager.kill()
    })
  }
}
