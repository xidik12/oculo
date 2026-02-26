import { app, BrowserWindow, shell, nativeTheme, nativeImage, Menu, clipboard, ipcMain, webContents, WebContentsView } from 'electron'
import { join } from 'path'
import fs from 'fs'
import path from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Stabilize GPU process without disabling hardware acceleration
// (disableHardwareAcceleration breaks webview compositing on macOS Sequoia + Electron 34)
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
import { setupIPC } from './ipc'
import { createMenu } from './menu'
import { McpServerManager } from './mcp/server'
import { SecurityManager } from './security/vault'
import { AuditLog } from './security/audit'
import { Redactor } from './security/redactor'
import { AgentController } from './ai/agent'
import { BookmarkStore } from './data/bookmarks'
import { HistoryStore } from './data/history'
import { DownloadManager } from './data/downloads'
import { ZoomStore } from './data/zoom'

/** Clean up temp files older than 1 hour from oculo-screenshots/ and oculo-generated/ */
function cleanupTempFiles(): void {
  const tempDir = app.getPath('temp')
  const dirs = ['oculo-screenshots', 'oculo-generated']
  const maxAge = 60 * 60 * 1000 // 1 hour

  for (const dirName of dirs) {
    const dir = path.join(tempDir, dirName)
    try {
      if (!fs.existsSync(dir)) continue
      const files = fs.readdirSync(dir)
      const now = Date.now()
      for (const file of files) {
        const filePath = path.join(dir, file)
        try {
          const stat = fs.statSync(filePath)
          if (now - stat.mtimeMs > maxAge) {
            fs.unlinkSync(filePath)
          }
        } catch { /* skip individual file errors */ }
      }
    } catch { /* skip if dir doesn't exist */ }
  }
}

let mainWindow: BrowserWindow | null = null
let mcpServer: McpServerManager | null = null
let securityManager: SecurityManager | null = null
let auditLog: AuditLog | null = null
let redactor: Redactor | null = null
let agentController: AgentController | null = null
let bookmarkStore: BookmarkStore | null = null
let historyStore: HistoryStore | null = null
let downloadManager: DownloadManager | null = null
let zoomStore: ZoomStore | null = null

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  // Resolve icon path — works in both dev and production
  const iconPath = join(__dirname, '../../resources/icon.png')

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Oculo',
    icon: iconPath,
    // macOS: hidden inset titlebar with traffic lights in sidebar
    // Windows/Linux: standard frame with native window controls
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 12 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#0a0a12', symbolColor: '#9ca3af', height: 38 } }
    ),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a12' : '#f0f1f4',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Null out reference when window is closed to prevent "Object has been destroyed"
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.oculo.browser')

  // Phase 5: Clean up old temp files
  cleanupTempFiles()

  // Set app name and Dock icon for dev mode
  app.setName('Oculo')
  if (process.platform === 'darwin') {
    const dockIconPath = join(__dirname, '../../resources/icon.png')
    try {
      const dockIcon = nativeImage.createFromPath(dockIconPath)
      if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon)
    } catch { /* icon not found in dev, that's ok */ }
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Context menu for webview pages (right-click → Inspect Element, Copy, etc.)
  app.on('web-contents-created', (_, wc) => {
    // Only handle webview guest pages, not the main renderer
    if (wc.getType() !== 'webview') return

    wc.on('context-menu', (_, params) => {
      const menuItems: Electron.MenuItemConstructorOptions[] = []

      // Text selection actions
      if (params.selectionText) {
        menuItems.push(
          { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => clipboard.writeText(params.selectionText) },
          { type: 'separator' }
        )
      }

      // Link actions
      if (params.linkURL) {
        menuItems.push(
          { label: 'Open Link in New Tab', click: () => mainWindow?.webContents.send('tab:create', params.linkURL) },
          { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) },
          { type: 'separator' }
        )
      }

      // Image actions
      if (params.hasImageContents && params.srcURL) {
        menuItems.push(
          { label: 'Open Image in New Tab', click: () => mainWindow?.webContents.send('tab:create', params.srcURL) },
          { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) },
          { type: 'separator' }
        )
      }

      // Editable field actions
      if (params.isEditable) {
        menuItems.push(
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
          { type: 'separator' }
        )
      }

      // Standard page actions
      menuItems.push(
        { label: 'Back', enabled: wc.canGoBack(), click: () => wc.goBack() },
        { label: 'Forward', enabled: wc.canGoForward(), click: () => wc.goForward() },
        { label: 'Reload', click: () => wc.reload() },
        { type: 'separator' },
        { label: 'View Page Source', accelerator: 'CmdOrCtrl+Option+U', click: () => mainWindow?.webContents.send('view-page-source') },
        { type: 'separator' },
        { label: 'Inspect Element', accelerator: 'CmdOrCtrl+Shift+C', click: () => {
          // Opens DevTools docked at bottom, focused on the clicked element
          if (!wc.isDevToolsOpened()) {
            wc.openDevTools({ mode: 'bottom', activate: true })
          }
          wc.inspectElement(params.x, params.y)
        }}
      )

      const contextMenu = Menu.buildFromTemplate(menuItems)
      contextMenu.popup()
    })
  })

  // === DevTools management — docked panel inside main window (like Chrome) ===
  let activeWebContentsId: number | null = null
  let devToolsView: WebContentsView | null = null
  let devToolsHeight = 300 // default height
  let devToolsTargetWcId: number | null = null

  ipcMain.on('webview:tab-activated', (_, wcId: number) => {
    activeWebContentsId = wcId
  })

  // Helper: find the active webview webContents
  function findActiveWebviewWC(): Electron.WebContents | null {
    if (activeWebContentsId) {
      try {
        const wc = webContents.fromId(activeWebContentsId)
        if (wc && !wc.isDestroyed()) return wc
      } catch { /* stale ID */ }
    }
    const all = webContents.getAllWebContents()
    for (const wc of all) {
      if (wc.getType() === 'webview' && !wc.isDestroyed()) {
        activeWebContentsId = wc.id
        return wc
      }
    }
    return null
  }

  // Resize the docked DevTools panel to fit the window
  function layoutDevTools(): void {
    if (!devToolsView || !mainWindow || mainWindow.isDestroyed()) return
    const [width, height] = mainWindow.getContentSize()
    devToolsView.setBounds({ x: 0, y: height - devToolsHeight, width, height: devToolsHeight })
    // Tell renderer how much space DevTools is taking so it can shrink content
    try { mainWindow.webContents.send('devtools:resized', devToolsHeight) } catch {}
  }

  // Open DevTools docked at bottom of main window
  function openDockedDevTools(targetWcId?: number | null): void {
    if (!mainWindow || mainWindow.isDestroyed()) return

    // Resolve target webContents
    let wc: Electron.WebContents | null = null
    if (targetWcId != null) {
      try { wc = webContents.fromId(targetWcId) } catch {}
    }
    if (!wc || wc.isDestroyed()) wc = findActiveWebviewWC()
    if (!wc) return

    // If DevTools already open for this target, close instead (toggle)
    if (devToolsView && devToolsTargetWcId === wc.id) {
      closeDockedDevTools()
      return
    }

    // Close existing DevTools if switching targets
    if (devToolsView) closeDockedDevTools()

    devToolsTargetWcId = wc.id

    // Create a WebContentsView to host DevTools
    devToolsView = new WebContentsView()
    mainWindow.contentView.addChildView(devToolsView)

    // Use setDevToolsWebContents to render DevTools INTO our view
    wc.setDevToolsWebContents(devToolsView.webContents)
    wc.openDevTools({ activate: true })

    layoutDevTools()

    // Re-layout when window resizes
    mainWindow.on('resize', layoutDevTools)

    // If the DevTools webContents is destroyed externally
    devToolsView.webContents.on('destroyed', () => {
      closeDockedDevTools()
    })
  }

  function closeDockedDevTools(): void {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.removeListener('resize', layoutDevTools)

    if (devToolsTargetWcId != null) {
      try {
        const wc = webContents.fromId(devToolsTargetWcId)
        if (wc && !wc.isDestroyed() && wc.isDevToolsOpened()) {
          wc.closeDevTools()
        }
      } catch {}
    }

    if (devToolsView) {
      try { mainWindow.contentView.removeChildView(devToolsView) } catch {}
      try { (devToolsView.webContents as any)?.close?.() } catch {}
      devToolsView = null
    }
    devToolsTargetWcId = null

    // Tell renderer DevTools closed so it reclaims space
    try { mainWindow.webContents.send('devtools:resized', 0) } catch {}
  }

  function isDevToolsOpen(): boolean {
    return devToolsView !== null
  }

  // IPC handlers for DevTools

  // Toggle (legacy + menu shortcuts)
  ipcMain.on('devtools:toggle', (_, mode?: string) => {
    if (isDevToolsOpen()) {
      closeDockedDevTools()
    } else {
      openDockedDevTools()
    }
  })

  // Open with explicit webContentsId (from AI tool / renderer)
  ipcMain.on('devtools:open', (_, wcId: number | null, _mode?: string) => {
    openDockedDevTools(wcId)
  })

  // Close
  ipcMain.on('devtools:close', (_, _wcId?: number | null) => {
    closeDockedDevTools()
  })

  // Query if open (for AI to check)
  ipcMain.handle('devtools:is-open', () => {
    return isDevToolsOpen()
  })

  // Set DevTools panel height
  ipcMain.on('devtools:set-height', (_, height: number) => {
    devToolsHeight = Math.max(150, Math.min(height, 800))
    layoutDevTools()
  })

  // Inspect specific element at coordinates
  ipcMain.on('devtools:inspect-element', (_, x: number, y: number) => {
    const wc = findActiveWebviewWC()
    if (!wc) return
    try {
      if (!isDevToolsOpen()) openDockedDevTools(wc.id)
      wc.inspectElement(x, y)
    } catch { /* webContents error */ }
  })

  // Initialize security components
  auditLog = new AuditLog()
  redactor = new Redactor()
  try {
    securityManager = new SecurityManager()
  } catch (err) {
    console.error('SecurityManager init failed:', err)
    securityManager = {} as SecurityManager
  }

  // Initialize data stores
  bookmarkStore = new BookmarkStore()
  historyStore = new HistoryStore()
  zoomStore = new ZoomStore()

  // Create window
  const window = createWindow()

  // Initialize download manager (needs window)
  downloadManager = new DownloadManager(window)

  // Create app menu
  createMenu(window)

  // Start MCP server
  mcpServer = new McpServerManager(window, securityManager, auditLog, redactor)
  try {
    await mcpServer.start()
  } catch (err) {
    console.error('MCP server start failed:', err)
  }

  // Initialize AI agent (lazy — only connects when user sends a message)
  agentController = new AgentController(window)

  // Wire up MCP server to receive provider configs from agent for media generation
  const originalSetConfig = agentController.setProviderConfig.bind(agentController)
  agentController.setProviderConfig = (config: any) => {
    originalSetConfig(config)
    mcpServer?.setProviderConfigs(agentController.getProviderConfigs())
  }

  // Setup IPC handlers (after agent init so chat handlers are wired)
  setupIPC(window, securityManager, auditLog, redactor, agentController, bookmarkStore, historyStore, downloadManager, zoomStore)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Abort agent before cleaning up — safe even if window is already destroyed
  agentController?.abort()
  mcpServer?.stop()
  auditLog?.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
