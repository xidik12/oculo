// Ignore EPIPE errors on stdout/stderr (broken pipe when parent process closes)
process.stdout?.on('error', (err: any) => { if (err.code !== 'EPIPE') throw err })
process.stderr?.on('error', (err: any) => { if (err.code !== 'EPIPE') throw err })

import { app, BrowserWindow, shell, nativeTheme, nativeImage, Menu, clipboard, ipcMain, webContents, WebContentsView, session as electronSession } from 'electron'
import { join } from 'path'
import fs from 'fs'
import path from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
// electron-updater loaded dynamically — may not be available in all builds

// Stabilize GPU process without disabling hardware acceleration
// (disableHardwareAcceleration breaks webview compositing on macOS Sequoia + Electron 34)
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')
app.commandLine.appendSwitch('enable-features', 'WebAuthenticationMacOS,WebAuthentication')
app.commandLine.appendSwitch('enable-web-authentication-platform-support')

// Global UA cleanup — removes Electron/oculo markers from ALL sessions before any windows open.
// This is critical: per-webContents UA only affects page-level requests, but sub-resource requests
// (XHR, fetch, preflight, service worker) use the session-level UA. Google detects the Electron
// marker in these requests and blocks sign-in on fresh installs.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s*Electron\/[\d.]+/, '')
  .replace(/\s*oculo\/[\d.]+/i, '')
import { isHeadless, headlessLog } from './headless'
import { setupIPC, StoreRegistry } from './ipc'
import { createMenu } from './menu'
import { McpServerManager } from './mcp/server'
import { SecurityManager } from './security/vault'
import { AdBlocker } from './security/ad-block'
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
import { TabManager } from './tab-manager'

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
let downloadManager: DownloadManager | null = null
let ptyManager: PtyManager | null = null
let mcpClientManager: McpClientManager | null = null
let patternDetector: PatternDetector | null = null
let watcherStore: WatcherStore | null = null
let tabManager: TabManager | null = null

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
    if (!isHeadless) {
      mainWindow?.show()
    } else {
      headlessLog('Window created (hidden)')
    }
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

function lazy<T>(factory: () => T): () => T {
  let instance: T | null = null
  return () => {
    if (!instance) instance = factory()
    return instance
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.oculo.browser')

  // Phase 5: Clean up old temp files
  cleanupTempFiles()

  // Set app name and Dock icon for dev mode
  app.setName('Oculo')
  if (process.platform === 'darwin' && !isHeadless) {
    const dockIconPath = join(__dirname, '../../resources/icon.png')
    try {
      const dockIcon = nativeImage.createFromPath(dockIconPath)
      if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon)
    } catch { /* icon not found in dev, that's ok */ }
  }
  if (isHeadless && process.platform === 'darwin') {
    app.dock?.hide()
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // --- Passkey / WebAuthn / Permissions (set ONCE on persistent session) ---
  const webviewSession = electronSession.fromPartition('persist:oculo')

  // Clean UA at session level — ensures ALL requests (XHR, fetch, preflight, sub-resources)
  // use a Chrome-compatible UA. Without this, Google detects the Electron marker.
  const sessionUA = webviewSession.getUserAgent()
  webviewSession.setUserAgent(
    sessionUA.replace(/\s*Electron\/[\d.]+/, '').replace(/\s*oculo\/[\d.]+/i, '')
  )

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

  // --- Ad/Tracker/Malware Blocking (Brave Shields-style) ---
  const adBlocker = new AdBlocker()

  // Apply saved ad-block setting (read directly from disk since securityManager
  // isn't initialized yet at this point in the startup sequence)
  try {
    const { existsSync: fileExists, readFileSync: readFile } = require('fs')
    const settingsPath = require('path').join(app.getPath('userData'), 'oculo-data', 'settings.json')
    if (fileExists(settingsPath)) {
      const saved = JSON.parse(readFile(settingsPath, 'utf-8'))
      if (saved.adBlockEnabled === false) {
        adBlocker.setEnabled(false)
      }
    }
  } catch { /* settings not available yet, keep default (enabled) */ }

  // Block ad/tracking/malware requests at network level — before content loads
  webviewSession.webRequest.onBeforeRequest(
    { urls: ['https://*/*', 'http://*/*'] },
    (details, callback) => {
      const pageUrl = details.webContents?.getURL() || ''
      if (adBlocker.shouldBlock(details.url, details.resourceType, pageUrl)) {
        callback({ cancel: true })
      } else {
        callback({})
      }
    }
  )

  // Spoof Sec-CH-UA headers globally so all sites see Chrome (not Electron)
  webviewSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*/*', 'http://*/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      headers['Sec-CH-UA'] = '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"'
      headers['Sec-CH-UA-Mobile'] = '?0'
      headers['Sec-CH-UA-Platform'] = process.platform === 'win32' ? '"Windows"' : process.platform === 'linux' ? '"Linux"' : '"macOS"'
      headers['Sec-CH-UA-Full-Version-List'] = '"Not A(Brand";v="8.0.0.0", "Chromium";v="132.0.6834.210", "Google Chrome";v="132.0.6834.210"'
      // Consistent Accept-Language (match spoofed navigator.languages)
      headers['Accept-Language'] = 'en-US,en;q=0.9'
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

    // All anti-bot fingerprint patches are in webview-preload.ts (runs before page scripts).
    // The executeJavaScript approach was too late — ThreatMetrix/PerimeterX run on first script.

    // Handle native dialogs — prevent "beforeunload" from blocking MCP automation.
    // The webview-preload.ts already overrides window.alert/confirm/prompt and
    // suppresses beforeunload via event listener, but will-prevent-unload is the
    // main-process safety net for pages that still manage to trigger the dialog.
    wc.on('will-prevent-unload', (event) => {
      // Always allow navigation — don't let "Leave site?" dialogs block automation
      event.preventDefault()
    })

    // Intercept window.open / target="_blank" → open as new tab, not new window
    // Block popups to known ad/malware domains; allow legitimate ones (OAuth, payment, SSO)
    const OAUTH_DOMAINS = [
      'accounts.google.com',
      'appleid.apple.com',
      'github.com/login/oauth',
      'login.microsoftonline.com',
      'clerk.', 'accounts.clerk', 'clerk.accounts',
      'auth0.com',
      'login.live.com',
      'login.yahoo.com',
      'api.twitter.com',
      'facebook.com/v',
    ]

    wc.setWindowOpenHandler((details) => {
      if (adBlocker.isAdDomain(details.url)) {
        return { action: 'deny' }
      }

      // OAuth/SSO popups need to open as real child windows so window.opener works
      const url = details.url.toLowerCase()
      const isOAuth = OAUTH_DOMAINS.some(d => url.includes(d))

      if (isOAuth) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 720,
            autoHideMenuBar: true,
            parent: mainWindow!,
            modal: false,
            webPreferences: {
              partition: 'persist:oculo',
              nodeIntegration: false,
              contextIsolation: true,
            },
          },
        }
      }

      // Everything else → open as a new tab
      mainWindow?.webContents.send('tab:create', details.url, wc.id)
      return { action: 'deny' }
    })

    // When an OAuth popup window is created, configure it and auto-close on completion
    wc.on('did-create-window', (popupWindow) => {
      // Clean UA in popup (remove Electron marker)
      const popupWC = popupWindow.webContents
      const popupUA = popupWC.getUserAgent()
      popupWC.setUserAgent(popupUA.replace(/\s*Electron\/[\d.]+/, '').replace(/\s*oculo\/[\d.]+/i, ''))

      // Auto-close popup when it navigates back to the opener's origin (OAuth callback done)
      const openerUrl = wc.getURL()
      let openerOrigin = ''
      try { openerOrigin = new URL(openerUrl).origin } catch {}

      popupWC.on('will-navigate', (_e, navUrl) => {
        try {
          const navOrigin = new URL(navUrl).origin
          // If the popup redirects back to the opener's origin, auth is done
          if (openerOrigin && navOrigin === openerOrigin) {
            setTimeout(() => {
              if (!popupWindow.isDestroyed()) popupWindow.close()
            }, 1500)
          }
        } catch {}
      })

      // Also close if popup navigates to a known "done" page
      popupWC.on('did-navigate', (_e, navUrl) => {
        if (navUrl.includes('/sso-callback') || navUrl.includes('/oauth/callback') || navUrl.includes('accounts.google.com/o/oauth2/approval')) {
          setTimeout(() => {
            if (!popupWindow.isDestroyed()) popupWindow.close()
          }, 2000)
        }
      })
    })

    // Google sign-in fallback: Google blocks sign-in inside <webview> (guest pages)
    // because it detects them as "embedded browsers." When rejection is detected,
    // re-open sign-in in a proper BrowserWindow (top-level Chromium window) which
    // Google treats as a real browser. Both share the persist:oculo session, so
    // cookies carry over automatically after sign-in succeeds.
    wc.on('did-navigate', (_e, navUrl) => {
      try {
        const u = new URL(navUrl)
        const isGoogleRejection =
          u.hostname === 'accounts.google.com' &&
          (u.pathname.includes('/signin/rejected') ||
           u.pathname.includes('/signin/disallowed') ||
           u.searchParams.get('disallowed_useragent') === '1')

        if (!isGoogleRejection) return

        // Get the URL to redirect to after sign-in, or default to Google homepage
        const continueUrl =
          u.searchParams.get('continue') || 'https://accounts.google.com'

        const signInWin = new BrowserWindow({
          width: 480,
          height: 680,
          autoHideMenuBar: true,
          parent: mainWindow ?? undefined,
          modal: false,
          title: 'Sign in — Google',
          webPreferences: {
            partition: 'persist:oculo',
            nodeIntegration: false,
            contextIsolation: true,
          },
        })

        // UA is already cleaned globally via app.userAgentFallback and session-level
        // setUserAgent. BrowserWindow inherits the cleaned UA from the session.

        signInWin.loadURL(continueUrl)

        // Auto-close when user finishes sign-in (navigates away from Google accounts)
        signInWin.webContents.on('did-navigate', (_e2, postUrl) => {
          try {
            const postHost = new URL(postUrl).hostname
            // Still on Google accounts/auth pages → sign-in in progress
            if (
              postHost.includes('accounts.google') ||
              postHost.includes('myaccount.google') ||
              postHost.includes('accounts.youtube')
            )
              return
            // Left Google accounts → sign-in complete, close window + reload webview
            setTimeout(() => {
              if (!signInWin.isDestroyed()) signInWin.close()
              if (!wc.isDestroyed()) wc.reload()
            }, 1500)
          } catch {}
        })

        // Also handle the window being closed manually by the user
        signInWin.on('closed', () => {
          // Reload webview to pick up any cookies set during partial sign-in
          if (!wc.isDestroyed()) wc.reload()
        })

        // Navigate webview back so user doesn't see the rejection page
        if (!wc.isDestroyed()) {
          wc.goBack()
        }
      } catch {}
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
          { label: 'Save Image As…', click: () => {
            wc.downloadURL(params.srcURL)
          }},
          { label: 'Copy Image', click: () => {
            wc.copyImageAt(params.x, params.y)
          }},
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
        { label: 'Back', enabled: wc.navigationHistory?.canGoBack() ?? false, click: () => wc.navigationHistory?.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory?.canGoForward() ?? false, click: () => wc.navigationHistory?.goForward() },
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

  // === Direct navigation via main-process webContents (toolbar buttons) ===
  // WebviewTag.goBack() in preload is unreliable in Electron 34;
  // webContents.goBack() from main process works correctly (same path MCP uses).
  ipcMain.on('nav:back-direct', () => {
    const wc = findActiveWebviewWC()
    if (wc?.navigationHistory?.canGoBack()) wc.navigationHistory.goBack()
  })
  ipcMain.on('nav:forward-direct', () => {
    const wc = findActiveWebviewWC()
    if (wc?.navigationHistory?.canGoForward()) wc.navigationHistory.goForward()
  })
  ipcMain.on('nav:reload-direct', () => {
    const wc = findActiveWebviewWC()
    if (wc) wc.reload()
  })

  // Helper: find the active tab's webContents (prefers WebContentsView via TabManager, falls back to webview)
  function findActiveWebviewWC(): Electron.WebContents | null {
    // v0.4.3: Prefer TabManager's active WebContentsView
    if (tabManager) {
      const wc = tabManager.getActiveWebContents()
      if (wc) return wc
    }
    // Fallback: legacy webview lookup
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
      try { wc = webContents.fromId(targetWcId) ?? null } catch {}
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
    wc.openDevTools({ activate: true, mode: 'detach' })

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
    console.error('SecurityManager init failed — retrying without vault:', err)
    // Create a functional SecurityManager — vault/settings load gracefully handle errors internally,
    // so a second attempt should succeed even if the data dir didn't exist yet
    try {
      securityManager = new SecurityManager()
    } catch (err2) {
      console.error('SecurityManager init failed twice — app may have limited functionality:', err2)
      // Last resort: still create the instance so method calls don't TypeError
      securityManager = Object.create(SecurityManager.prototype) as SecurityManager
      ;(securityManager as any).vault = []
      ;(securityManager as any).settings = {}
    }
  }

  // Lazy data stores — only instantiated on first access
  const getBookmarkStore = lazy(() => new BookmarkStore())
  const getHistoryStore = lazy(() => new HistoryStore())
  const getZoomStore = lazy(() => new ZoomStore())
  const getRunCache = lazy(() => new RunCache())
  const getSessionMemoryStore = lazy(() => new SessionMemoryStore())
  const getContainerStore = lazy(() => new ContainerStore())
  const getCardStore = lazy(() => new CardStore())
  const getWorkspaceStore = lazy(() => new WorkspaceStore())
  const getMacroStore = lazy(() => new MacroStore())
  const getPinnedAppStore = lazy(() => new PinnedAppStore())

  // Create window
  const window = createWindow()

  // Initialize TabManager (v0.4.3 — manages WebContentsView instances for tabs)
  tabManager = new TabManager(window, adBlocker)

  // Initialize download manager (needs window)
  downloadManager = new DownloadManager(window)

  // Create app menu
  createMenu(() => mainWindow)

  // Initialize pattern detector
  patternDetector = new PatternDetector(window)

  // Initialize webpage change monitor (v0.3.0)
  watcherStore = new WatcherStore(window)

  // Start MCP server
  mcpServer = new McpServerManager(window, securityManager, auditLog, redactor, patternDetector)
  try {
    await mcpServer.start()
    if (isHeadless) {
      headlessLog('MCP server started — ready for tool calls')
    }
  } catch (err) {
    console.error('MCP server start failed:', err)
  }

  // Auto-updater — check for updates silently after startup
  if (!is.dev) {
    try {
      const { autoUpdater } = require('electron-updater')
      autoUpdater.logger = null
      autoUpdater.autoDownload = false
      autoUpdater.checkForUpdatesAndNotify().catch(() => {})
    } catch { /* electron-updater not available in this build */ }
  }

  // Initialize AI agent (lazy — only connects when user sends a message)
  agentController = new AgentController(window, getSessionMemoryStore(), getCardStore())

  // Wire up persistence — save API keys to settings.json, restore on startup
  const allSettings = securityManager!.getSettings()
  const savedProviders = (allSettings as any)?.aiProviders as Record<string, any> | undefined
  console.log('[Oculo] Restoring provider configs:', savedProviders ? Object.keys(savedProviders) : 'none')

  agentController!.setPersistence(
    (configs) => securityManager!.saveSettings({ aiProviders: configs } as any),
    savedProviders
  )

  // Wire up MCP server to receive provider configs from agent for media generation
  const originalSetConfig = agentController!.setProviderConfig.bind(agentController!)
  agentController!.setProviderConfig = (config: any) => {
    originalSetConfig(config)
    mcpServer?.setProviderConfigs(agentController!.getProviderConfigs())
  }

  // Push restored configs to MCP server so media generation works on startup
  const agentConfigs = agentController!.getProviderConfigs()
  console.log('[Oculo] Agent has configs for:', [...agentConfigs.keys()])
  if (agentConfigs.size > 0) {
    mcpServer?.setProviderConfigs(agentConfigs)
    console.log('[Oculo] Pushed configs to MCP server')
  }

  // Initialize PTY manager (for terminal tab + AI shell tool)
  ptyManager = new PtyManager(window)
  mcpServer.setPtyManager(ptyManager)

  // Initialize MCP Client Manager (Connected Apps)
  mcpClientManager = new McpClientManager()
  // Load saved client configs and connect enabled servers
  try {
    const savedClients = (allSettings as any)?.mcpClients || []
    if (savedClients.length > 0) {
      console.log(`[Oculo] Loading ${savedClients.length} MCP client config(s)`)
      mcpClientManager.loadConfigs(savedClients).catch(err =>
        console.error('[Oculo] MCP client load error:', err)
      )
    }
  } catch (err) {
    console.error('[Oculo] MCP client init error:', err)
  }

  // Wire MCP client manager to AI agent for connected app tool routing
  agentController.setMcpClientManager(mcpClientManager)

  // Wire AI agent to download manager for auto-rename (v0.3.0)
  downloadManager!.setAgent(agentController)

  // Setup IPC handlers (after agent init so chat handlers are wired)
  const registry: StoreRegistry = {
    mainWindow: window,
    security: securityManager!,
    audit: auditLog!,
    redactor: redactor!,
    agent: agentController,
    getBookmarkStore,
    getHistoryStore,
    getDownloadManager: () => downloadManager!,
    getZoomStore,
    getRunCache,
    getPtyManager: () => ptyManager!,
    getMcpClientManager: () => mcpClientManager!,
    getSessionMemoryStore,
    getContainerStore,
    getCardStore,
    getWorkspaceStore,
    getMacroStore,
    getPinnedAppStore,
    getPatternDetector: () => patternDetector!,
    getWatcherStore: () => watcherStore!,
    getProxyManager: () => mcpServer!.getProxyManager(),
    getSessionRecorder: () => mcpServer!.getSessionRecorder()
  }
  setupIPC(registry)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Abort agent before cleaning up — safe even if window is already destroyed
  agentController?.abort()
  ptyManager?.kill()
  mcpClientManager?.disconnectAll().catch(() => {})
  try {
    mcpServer?.stop()
  } catch (err) {
    console.error('[Oculo] MCP server stop error during cleanup:', err)
  }
  auditLog?.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
