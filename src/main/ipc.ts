import { BrowserWindow, ipcMain, shell, app, nativeImage, clipboard, webContents } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC } from '../shared/ipc-channels'
import { SecurityManager } from './security/vault'
import { AuditLog } from './security/audit'
import { Redactor } from './security/redactor'
import { AgentController } from './ai/agent'
import { BookmarkStore } from './data/bookmarks'
import { HistoryStore } from './data/history'
import { DownloadManager } from './data/downloads'
import { ZoomStore } from './data/zoom'

export function setupIPC(
  mainWindow: BrowserWindow,
  security: SecurityManager,
  audit: AuditLog,
  redactor: Redactor,
  agent?: AgentController,
  bookmarkStore?: BookmarkStore,
  historyStore?: HistoryStore,
  downloadManager?: DownloadManager,
  zoomStore?: ZoomStore
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

  // Audit
  ipcMain.handle(IPC.AUDIT_QUERY, async (_, limit?: number) => {
    return audit.query(limit || 100)
  })

  // Settings
  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    return security.getSettings()
  })

  ipcMain.handle(IPC.SETTINGS_SET, async (_, settings: any) => {
    return security.saveSettings(settings)
  })

  // Permission request from MCP server
  ipcMain.handle(IPC.PERMISSION_REQUEST, async (_, action: string, details: string) => {
    // Send to renderer to show confirmation dialog
    return new Promise((resolve) => {
      mainWindow.webContents.send(IPC.PERMISSION_REQUEST, { action, details })
      ipcMain.once(IPC.PERMISSION_RESPONSE, (_, approved: boolean) => {
        resolve(approved)
      })
    })
  })

  // MCP status
  ipcMain.handle(IPC.MCP_STATUS, async () => {
    return { connected: true, serverName: 'oculo', version: '0.1.0' }
  })

  // Chat Panel
  ipcMain.handle(IPC.CHAT_SEND, async (_, message: string) => {
    if (!agent) return { error: 'Agent not initialized' }
    agent.handleMessage(message)
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

  ipcMain.handle(IPC.AI_SET_CONFIG, async (_, config: any) => {
    agent?.setProviderConfig(config)
    return true
  })

  ipcMain.handle(IPC.AI_GET_PROVIDER_STATUS, async (_, providerId: string) => {
    return agent?.getProviderStatus(providerId as any) || { providerId, connected: false, ready: false }
  })

  ipcMain.handle(IPC.AI_GET_ACTIVE, async () => {
    return agent?.getActiveProvider() || { providerId: 'claude', modelId: 'claude-sonnet-4-6' }
  })

  // === Auth (in-app OAuth) ===
  ipcMain.handle(IPC.AUTH_LOGIN, async (_, providerId: string) => {
    if (!agent) return { success: false, error: 'Agent not initialized' }
    if (providerId === 'claude') return agent.startClaudeAuth()
    if (providerId === 'openai') return agent.startCodexAuth()
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

  ipcMain.handle(IPC.BOOKMARKS_UPDATE, async (_, id: string, updates: any) => {
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

  // === Screenshot Save (Phase 1) ===
  ipcMain.handle(IPC.SCREENSHOT_SAVE, async (_, base64Png: string) => {
    const dir = path.join(app.getPath('temp'), 'oculo-screenshots')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `screenshot-${Date.now()}.png`)
    const buffer = Buffer.from(base64Png, 'base64')
    fs.writeFileSync(filePath, buffer)
    return filePath
  })

  // === File Upload via CDP (Phase 2) ===
  ipcMain.handle(IPC.FILE_UPLOAD, async (_, wcId: number, selector: string, filePaths: string[]) => {
    // Validate file paths — only allow temp, downloads, desktop
    const allowedDirs = [
      app.getPath('temp'),
      app.getPath('downloads'),
      app.getPath('desktop'),
    ]
    for (const fp of filePaths) {
      const resolved = path.resolve(fp)
      const allowed = allowedDirs.some(dir => resolved.startsWith(dir))
      if (!allowed) {
        return `Error: File path "${fp}" is outside allowed directories (temp, downloads, desktop)`
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
  ipcMain.handle(IPC.FILE_READ_SAFE, async (_, filePath: string) => {
    const allowedDirs = [
      app.getPath('temp'),
      app.getPath('downloads'),
      app.getPath('desktop'),
    ]
    const resolved = path.resolve(filePath)
    const allowed = allowedDirs.some(dir => resolved.startsWith(dir))
    if (!allowed) {
      return `Error: Cannot read file outside allowed directories (temp, downloads, desktop): ${filePath}`
    }
    if (!fs.existsSync(resolved)) {
      return `Error: File not found: ${filePath}`
    }
    try {
      const stat = fs.statSync(resolved)
      if (stat.size > 1024 * 1024) {
        return `Error: File too large (${Math.round(stat.size / 1024)}KB, max 1MB)`
      }
      return fs.readFileSync(resolved, 'utf-8')
    } catch (err) {
      return `Error: Failed to read file — ${(err as Error).message}`
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
}
