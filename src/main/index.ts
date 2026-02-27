// Ignore EPIPE errors on stdout/stderr (broken pipe when parent process closes)
process.stdout?.on('error', (err: any) => { if (err.code !== 'EPIPE') throw err })
process.stderr?.on('error', (err: any) => { if (err.code !== 'EPIPE') throw err })

import { app, BrowserWindow, shell, nativeTheme, nativeImage, Menu, clipboard, ipcMain, webContents, WebContentsView, session as electronSession } from 'electron'
import { join } from 'path'
import fs from 'fs'
import path from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Stabilize GPU process without disabling hardware acceleration
// (disableHardwareAcceleration breaks webview compositing on macOS Sequoia + Electron 34)
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')
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
import { RunCache } from './data/run-cache'

/** Clean up temp files older than 1 hour (only transient dirs, NOT ~/Pictures/Oculo) */
function cleanupTempFiles(): void {
  const tempDir = app.getPath('temp')
  const dirs = ['oculo-pdfs']
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
let runCache: RunCache | null = null

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

  // Anti-bot: clean user-agent string (remove Electron/version from UA)
  const defaultUA = mainWindow.webContents.getUserAgent()
  const cleanUA = defaultUA
    .replace(/\s*Electron\/[\d.]+/, '')
    .replace(/\s*oculo\/[\d.]+/i, '')
  mainWindow.webContents.setUserAgent(cleanUA)

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

  // --- Passkey / WebAuthn / Permissions (set ONCE on persistent session) ---
  const webviewSession = electronSession.fromPartition('persist:oculo')

  // Permission REQUEST handler — called when site uses WebAuthn, media, etc.
  webviewSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const blocked = ['openExternal']
    callback(!blocked.includes(permission))
  })

  // Permission CHECK handler — called BEFORE request; must return true or request is silently blocked
  webviewSession.setPermissionCheckHandler((_wc, permission) => {
    const blocked = ['openExternal']
    return !blocked.includes(permission)
  })

  // Device permission handler — auto-grant HID/USB for FIDO2/WebAuthn hardware keys
  webviewSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'hid' || details.deviceType === 'usb') return true
    return false
  })

  // HID device selection (YubiKey, Titan, etc.) — must be on SESSION, not app
  webviewSession.on('select-hid-device', (event, details, callback) => {
    event.preventDefault()
    if (details.deviceList?.length > 0) {
      callback(details.deviceList[0].deviceId)
    } else {
      callback('')
    }
  })

  // USB device selection (USB-based security keys)
  webviewSession.on('select-usb-device', (event, details, callback) => {
    event.preventDefault()
    if (details.deviceList?.length > 0) {
      callback(details.deviceList[0].deviceId)
    } else {
      callback()
    }
  })

  // Spoof Sec-CH-UA headers globally so all sites see Chrome (not Electron)
  webviewSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*/*', 'http://*/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      headers['Sec-CH-UA'] = '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"'
      headers['Sec-CH-UA-Mobile'] = '?0'
      headers['Sec-CH-UA-Platform'] = '"macOS"'
      headers['Sec-CH-UA-Full-Version-List'] = '"Not A(Brand";v="8.0.0.0", "Chromium";v="132.0.6834.210", "Google Chrome";v="132.0.6834.210"'
      callback({ requestHeaders: headers })
    }
  )

  webviewSession.setSpellCheckerEnabled(false)

  // Per-webview anti-bot + UA cleanup
  app.on('web-contents-created', (_, wc) => {
    if (wc.getType() !== 'webview') return

    // Anti-bot: clean user-agent for webview (remove Electron marker)
    const defaultWvUA = wc.getUserAgent()
    const cleanWvUA = defaultWvUA
      .replace(/\s*Electron\/[\d.]+/, '')
      .replace(/\s*oculo\/[\d.]+/i, '')
    wc.setUserAgent(cleanWvUA)

    // Comprehensive anti-bot fingerprint patching
    // Run on EVERY navigation (did-start-navigation fires before page scripts)
    const antiBotScript = `
      (function() {
        if (window.__oculoPatched) return;
        window.__oculoPatched = true;

        // 1. navigator.webdriver — must be undefined
        try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true }) } catch {}

        // 2. navigator.languages — real Chrome value
        try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true }) } catch {}

        // 3. navigator.plugins — fake a realistic plugin array
        try {
          const fakePlugins = {
            length: 5,
            0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
            1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
            2: { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 },
            3: { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
            4: { name: 'Chromium PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
            item: function(i) { return this[i] || null; },
            namedItem: function(name) { for (let i = 0; i < this.length; i++) { if (this[i].name === name) return this[i]; } return null; },
            refresh: function() {},
            [Symbol.iterator]: function*() { for (let i = 0; i < 5; i++) yield this[i]; }
          };
          Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins, configurable: true });
        } catch {}

        // 4. navigator.mimeTypes — fake realistic mime types
        try {
          const fakeMimeTypes = {
            length: 4,
            0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
            1: { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
            2: { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
            3: { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' },
            item: function(i) { return this[i] || null; },
            namedItem: function(name) { for (let i = 0; i < this.length; i++) { if (this[i].type === name) return this[i]; } return null; },
            [Symbol.iterator]: function*() { for (let i = 0; i < 4; i++) yield this[i]; }
          };
          Object.defineProperty(navigator, 'mimeTypes', { get: () => fakeMimeTypes, configurable: true });
        } catch {}

        // 5. window.chrome — comprehensive fake
        try {
          if (!window.chrome || !window.chrome.runtime || !window.chrome.runtime.connect) {
            const fakeChrome = {
              app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }, getDetails: function() { return null; }, getIsInstalled: function() { return false; } },
              runtime: { OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' }, OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }, PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformOs: { ANDROID: 'android', CROS: 'cros', FUCHSIA: 'fuchsia', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' }, RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }, connect: function() { return { onDisconnect: { addListener: function() {} }, onMessage: { addListener: function() {} }, postMessage: function() {} }; }, sendMessage: function() {} },
              csi: function() { return {}; },
              loadTimes: function() { return { requestTime: Date.now() / 1000, startLoadTime: Date.now() / 1000, commitLoadTime: Date.now() / 1000, finishDocumentLoadTime: Date.now() / 1000, finishLoadTime: Date.now() / 1000, firstPaintTime: Date.now() / 1000, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: false, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' }; }
            };
            Object.defineProperty(window, 'chrome', { get: () => fakeChrome, configurable: true });
          }
        } catch {}

        // 6. Notification.permission — must not throw
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            // Already fine
          }
        } catch {}

        // 7. navigator.permissions.query — make it resolve like real Chrome
        try {
          const origQuery = navigator.permissions.query.bind(navigator.permissions);
          navigator.permissions.query = function(desc) {
            if (desc.name === 'notifications') {
              return Promise.resolve({ state: Notification.permission || 'prompt', onchange: null });
            }
            return origQuery(desc);
          };
        } catch {}

        // 8. navigator.connection — fake NetworkInformation
        try {
          if (!navigator.connection) {
            Object.defineProperty(navigator, 'connection', {
              get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, onchange: null }),
              configurable: true
            });
          }
        } catch {}

        // 9. navigator.hardwareConcurrency — reasonable value
        try {
          if (!navigator.hardwareConcurrency || navigator.hardwareConcurrency < 2) {
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
          }
        } catch {}

        // 10. navigator.deviceMemory — reasonable value
        try {
          if (!navigator.deviceMemory) {
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
          }
        } catch {}

        // 11. WebGL vendor/renderer — make it look normal (not SwiftShader)
        try {
          const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
          WebGLRenderingContext.prototype.getParameter = function(p) {
            if (p === 37445) return 'Google Inc. (Apple)';  // UNMASKED_VENDOR_WEBGL
            if (p === 37446) return 'ANGLE (Apple, Apple M1, OpenGL 4.1)';  // UNMASKED_RENDERER_WEBGL
            return getParameterOrig.call(this, p);
          };
          if (typeof WebGL2RenderingContext !== 'undefined') {
            const getParameter2Orig = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(p) {
              if (p === 37445) return 'Google Inc. (Apple)';
              if (p === 37446) return 'ANGLE (Apple, Apple M1, OpenGL 4.1)';
              return getParameter2Orig.call(this, p);
            };
          }
        } catch {}
      })();
    `

    // Intercept window.open / target="_blank" → open as new tab, not new window
    wc.setWindowOpenHandler((details) => {
      mainWindow?.webContents.send('tab:create', details.url)
      return { action: 'deny' }
    })

    wc.on('did-start-navigation', (_event, _url, isInPlace) => {
      if (isInPlace) return
      // Reset patch flag so it re-runs on new pages
      wc.executeJavaScript('window.__oculoPatched = false').catch(() => {})
      wc.executeJavaScript(antiBotScript).catch(() => {})
    })
    wc.on('dom-ready', () => {
      // Re-run on dom-ready as backup (some sites check late)
      wc.executeJavaScript(antiBotScript).catch(() => {})
    })
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
  runCache = new RunCache()

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

  // Wire up persistence — save API keys to settings.json, restore on startup
  const allSettings = securityManager.getSettings()
  const savedProviders = (allSettings as any)?.aiProviders as Record<string, any> | undefined
  console.log('[Oculo] Restoring provider configs:', savedProviders ? Object.keys(savedProviders) : 'none')

  agentController.setPersistence(
    (configs) => securityManager.saveSettings({ aiProviders: configs } as any),
    savedProviders
  )

  // Wire up MCP server to receive provider configs from agent for media generation
  const originalSetConfig = agentController.setProviderConfig.bind(agentController)
  agentController.setProviderConfig = (config: any) => {
    originalSetConfig(config)
    mcpServer?.setProviderConfigs(agentController.getProviderConfigs())
  }

  // Push restored configs to MCP server so media generation works on startup
  const agentConfigs = agentController.getProviderConfigs()
  console.log('[Oculo] Agent has configs for:', [...agentConfigs.keys()])
  if (agentConfigs.size > 0) {
    mcpServer?.setProviderConfigs(agentConfigs)
    console.log('[Oculo] Pushed configs to MCP server')
  }

  // Setup IPC handlers (after agent init so chat handlers are wired)
  setupIPC(window, securityManager, auditLog, redactor, agentController, bookmarkStore, historyStore, downloadManager, zoomStore, runCache)

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
