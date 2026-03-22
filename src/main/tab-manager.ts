/**
 * TabManager — manages WebContentsView instances for browser tabs.
 *
 * Replaces <webview> tags (guest pages detected as "embedded browsers" by Google et al.)
 * with top-level WebContentsView instances that are indistinguishable from real Chrome tabs.
 *
 * v0.4.3: Initial implementation replacing webview architecture.
 */
import { BrowserWindow, WebContentsView, ipcMain, session as electronSession, WebContents } from 'electron'
import { join } from 'path'
import type { Tab } from '@shared/types'

export interface TabViewInfo {
  id: string
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  containerId?: string
  webContentsId: number
}

export class TabManager {
  private views = new Map<string, WebContentsView>()
  private tabMeta = new Map<string, { containerId?: string; openerId?: number }>()
  private activeTabId: string | null = null
  private mainWindow: BrowserWindow
  private contentBounds = { x: 0, y: 0, width: 800, height: 600 }
  private preloadPath: string
  private adBlocker: any // AdBlocker instance from index.ts

  constructor(mainWindow: BrowserWindow, adBlocker?: any) {
    this.mainWindow = mainWindow
    this.preloadPath = join(__dirname, '../preload/webview-preload.js')
    this.adBlocker = adBlocker
    this.setupIPC()
  }

  private setupIPC(): void {
    // Renderer reports content area bounds
    ipcMain.on('view:bounds-update', (_e, bounds: { x: number; y: number; width: number; height: number }) => {
      this.contentBounds = bounds
      this.layoutActiveView()
    })

    // Renderer requests tab creation
    ipcMain.handle('view:create', (_e, tabId: string, url: string, opts?: { containerId?: string; background?: boolean }) => {
      return this.createTab(tabId, url, opts)
    })

    // Renderer requests tab close
    ipcMain.handle('view:close', (_e, tabId: string) => {
      this.closeTab(tabId)
    })

    // Renderer requests tab activation
    ipcMain.on('view:activate', (_e, tabId: string) => {
      this.activateTab(tabId)
    })

    // Renderer requests navigation
    ipcMain.on('view:navigate', (_e, tabId: string, url: string) => {
      const view = this.views.get(tabId)
      if (view && !view.webContents.isDestroyed()) {
        view.webContents.loadURL(url).catch(() => {})
      }
    })

    // Forward text:selected and image:describe from WebContentsView preloads to renderer.
    // With ipcRenderer.send() (vs sendToHost), messages arrive on ipcMain.
    ipcMain.on('text:selected', (event, data) => {
      if (!this.isWindowAlive()) return
      // Only forward if this came from the active tab's WebContentsView
      const senderWcId = event.sender.id
      if (this.activeTabId) {
        const activeView = this.views.get(this.activeTabId)
        if (activeView && !activeView.webContents.isDestroyed() && activeView.webContents.id === senderWcId) {
          this.mainWindow.webContents.send('text:selected', data)
        }
      }
    })

    ipcMain.on('image:describe', (_event, src) => {
      if (!this.isWindowAlive()) return
      this.mainWindow.webContents.send('image:describe', src)
    })
  }

  /**
   * Create a new tab backed by a WebContentsView.
   * Returns the webContentsId for CDP operations.
   */
  createTab(tabId: string, url: string, opts?: { containerId?: string; background?: boolean; openerId?: number }): number {
    const partition = opts?.containerId
      ? `persist:container-${opts.containerId}`
      : 'persist:oculo'

    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        partition,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        // WebContentsView doesn't need webviewTag
      },
    })

    const wc = view.webContents

    // Store metadata
    this.views.set(tabId, view)
    this.tabMeta.set(tabId, { containerId: opts?.containerId, openerId: opts?.openerId })

    // Clean UA (remove Electron marker) — inherits from app.userAgentFallback
    // but also do it per-webContents for safety
    const ua = wc.getUserAgent()
    wc.setUserAgent(ua.replace(/\s*Electron\/[\d.]+/, '').replace(/\s*oculo\/[\d.]+/i, ''))

    // Navigation event handlers → send state updates to renderer
    this.attachNavigationEvents(tabId, wc)

    // Window.open handler (OAuth popups, new tabs)
    this.attachWindowOpenHandler(tabId, wc)

    // Context menu
    this.attachContextMenu(wc)

    // Add to main window's content view
    this.mainWindow.contentView.addChildView(view)

    // Position based on whether this is the active tab
    if (!opts?.background || !this.activeTabId) {
      this.activateTab(tabId)
    } else {
      // Background tab — hide it
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }

    // Navigate to URL (unless it's an internal page)
    if (url && !url.startsWith('oculo://')) {
      wc.loadURL(url).catch(() => {})
    }

    return wc.id
  }

  /**
   * Close a tab and destroy its view.
   */
  closeTab(tabId: string): void {
    const view = this.views.get(tabId)
    if (!view) return

    this.views.delete(tabId)
    this.tabMeta.delete(tabId)

    try {
      this.mainWindow.contentView.removeChildView(view)
    } catch { /* view may already be detached */ }

    if (!view.webContents.isDestroyed()) {
      view.webContents.close()
    }

    // If we closed the active tab, activate the last remaining one
    if (this.activeTabId === tabId) {
      this.activeTabId = null
      const remaining = Array.from(this.views.keys())
      if (remaining.length > 0) {
        this.activateTab(remaining[remaining.length - 1])
      }
    }
  }

  /**
   * Switch active tab — show the target view, hide all others.
   */
  activateTab(tabId: string): void {
    const targetView = this.views.get(tabId)
    if (!targetView) return

    this.activeTabId = tabId

    // Hide all views, show only the active one
    for (const [id, view] of this.views) {
      if (id === tabId) {
        view.setBounds(this.contentBounds)
        // Bring to front by re-adding
        try {
          this.mainWindow.contentView.removeChildView(view)
        } catch { /* not attached */ }
        this.mainWindow.contentView.addChildView(view)
      } else {
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      }
    }
  }

  /**
   * Update the content area bounds and re-layout the active view.
   */
  setContentBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.contentBounds = bounds
    this.layoutActiveView()
  }

  private layoutActiveView(): void {
    if (!this.activeTabId) return
    const view = this.views.get(this.activeTabId)
    if (view) {
      view.setBounds(this.contentBounds)
    }
  }

  /**
   * Get WebContents for a specific tab.
   */
  getWebContents(tabId: string): WebContents | null {
    const view = this.views.get(tabId)
    if (!view || view.webContents.isDestroyed()) return null
    return view.webContents
  }

  /**
   * Get the active tab's WebContents.
   */
  getActiveWebContents(): WebContents | null {
    if (!this.activeTabId) return null
    return this.getWebContents(this.activeTabId)
  }

  getActiveTabId(): string | null {
    return this.activeTabId
  }

  getAllTabIds(): string[] {
    return Array.from(this.views.keys())
  }

  /**
   * Get tab info for all tabs (used by MCP 'tabs' tool).
   */
  getAllTabInfo(): TabViewInfo[] {
    const result: TabViewInfo[] = []
    for (const [id, view] of this.views) {
      const wc = view.webContents
      if (wc.isDestroyed()) continue
      const meta = this.tabMeta.get(id)
      result.push({
        id,
        url: wc.getURL() || 'oculo://newtab',
        title: wc.getTitle() || 'New Tab',
        isLoading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        containerId: meta?.containerId,
        webContentsId: wc.id,
      })
    }
    return result
  }

  /**
   * Navigate a tab to a URL.
   */
  async navigateTo(tabId: string, url: string): Promise<void> {
    const wc = this.getWebContents(tabId)
    if (!wc) return
    await wc.loadURL(url)
  }

  /**
   * Check if a tab ID exists.
   */
  hasTab(tabId: string): boolean {
    return this.views.has(tabId)
  }

  // --- Event Wiring ---

  private isWindowAlive(): boolean {
    return !!(this.mainWindow && !this.mainWindow.isDestroyed())
  }

  private attachNavigationEvents(tabId: string, wc: WebContents): void {
    const sendUpdate = () => {
      if (wc.isDestroyed() || !this.isWindowAlive()) return
      // Auto-tidy title
      let title = wc.getTitle() || ''
      title = title
        .replace(/\s*[-|–—]\s*YouTube$/i, '')
        .replace(/\s*[-|–—]\s*Google Search$/i, '')
        .replace(/\s*[-|–—]\s*Wikipedia$/i, '')
        .replace(/\s*[-|–—]\s*Reddit$/i, '')
        .replace(/\s*\|\s*LinkedIn$/i, '')
        .replace(/\s*[-|–—·]\s*[A-Za-z0-9 ]{3,25}$/, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .trim() || wc.getTitle()

      this.mainWindow.webContents.send('view:state-update', tabId, {
        url: wc.getURL(),
        title,
        originalTitle: wc.getTitle(),
        isLoading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      })
    }

    wc.on('did-navigate', sendUpdate)
    wc.on('did-navigate-in-page', sendUpdate)
    wc.on('did-start-loading', sendUpdate)
    wc.on('did-stop-loading', sendUpdate)
    wc.on('page-title-updated', sendUpdate)

    wc.on('did-fail-load', (_e, errorCode) => {
      if (errorCode !== -3 && this.isWindowAlive()) { // -3 = ERR_ABORTED (normal for navigation changes)
        this.mainWindow.webContents.send('view:state-update', tabId, {
          isLoading: false,
          title: 'Failed to load',
        })
      }
    })

    // Crash recovery
    wc.on('render-process-gone', (_e, details) => {
      console.warn('[TabManager] View crashed:', tabId, details.reason)
      if (this.isWindowAlive()) {
        this.mainWindow.webContents.send('view:state-update', tabId, {
          isLoading: true,
          title: 'Reloading...',
        })
      }
      setTimeout(() => {
        if (!wc.isDestroyed()) wc.reload()
      }, 500)
    })

    // Text selection from preload (Highlight-to-Ask) — legacy sendToHost path
    wc.on('ipc-message', (_e, channel, ...args) => {
      if (!this.isWindowAlive()) return
      if (channel === 'text:selected' && tabId === this.activeTabId) {
        this.mainWindow.webContents.send('text:selected', args[0])
      } else if (channel === 'image:describe') {
        this.mainWindow.webContents.send('image:describe', args[0])
      }
    })
  }

  private attachWindowOpenHandler(tabId: string, wc: WebContents): void {
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
      if (this.adBlocker?.isAdDomain?.(details.url)) {
        return { action: 'deny' as const }
      }

      // Chrome extension popups (MetaMask, etc.) — open as child window
      if (details.url.startsWith('chrome-extension://')) {
        return {
          action: 'allow' as const,
          overrideBrowserWindowOptions: {
            width: 360,
            height: 600,
            resizable: true,
            autoHideMenuBar: true,
            parent: this.mainWindow,
            modal: false,
            alwaysOnTop: true,
            webPreferences: {
              partition: 'persist:oculo',
              nodeIntegration: false,
              contextIsolation: true,
            },
          },
        }
      }

      const url = details.url.toLowerCase()
      const isOAuth = OAUTH_DOMAINS.some(d => url.includes(d))

      if (isOAuth) {
        return {
          action: 'allow' as const,
          overrideBrowserWindowOptions: {
            width: 520,
            height: 720,
            autoHideMenuBar: true,
            parent: this.mainWindow,
            modal: false,
            webPreferences: {
              partition: 'persist:oculo',
              nodeIntegration: false,
              contextIsolation: true,
            },
          },
        }
      }

      // Non-OAuth links → create a new tab
      // Generate a tab ID and send to renderer
      const newTabId = `tab-${Date.now()}-${Math.floor(Math.random() * 100000)}`
      this.createTab(newTabId, details.url, { background: false })
      if (this.isWindowAlive()) {
        this.mainWindow.webContents.send('tab:create', details.url, wc.id, newTabId)
      }
      return { action: 'deny' as const }
    })

    // OAuth popup cleanup
    wc.on('did-create-window', (popupWindow) => {
      const popupWC = popupWindow.webContents
      const popupUA = popupWC.getUserAgent()
      popupWC.setUserAgent(popupUA.replace(/\s*Electron\/[\d.]+/, '').replace(/\s*oculo\/[\d.]+/i, ''))

      const openerUrl = wc.getURL()
      let openerOrigin = ''
      try { openerOrigin = new URL(openerUrl).origin } catch {}

      popupWC.on('will-navigate', (_e, navUrl) => {
        try {
          const navOrigin = new URL(navUrl).origin
          if (openerOrigin && navOrigin === openerOrigin) {
            setTimeout(() => {
              if (!popupWindow.isDestroyed()) popupWindow.close()
            }, 1500)
          }
        } catch {}
      })

      popupWC.on('did-navigate', (_e, navUrl) => {
        if (navUrl.includes('/sso-callback') || navUrl.includes('/oauth/callback') || navUrl.includes('accounts.google.com/o/oauth2/approval')) {
          setTimeout(() => {
            if (!popupWindow.isDestroyed()) popupWindow.close()
          }, 2000)
        }
      })
    })
  }

  private attachContextMenu(wc: WebContents): void {
    const { clipboard, Menu } = require('electron')

    wc.on('context-menu', (_, params) => {
      const menuItems: Electron.MenuItemConstructorOptions[] = []

      if (params.selectionText) {
        menuItems.push(
          { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => clipboard.writeText(params.selectionText) },
          { type: 'separator' }
        )
      }

      if (params.linkURL) {
        menuItems.push(
          { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
          { type: 'separator' }
        )
      }

      menuItems.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => wc.reload() },
        { type: 'separator' },
        { label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) }
      )

      Menu.buildFromTemplate(menuItems).popup()
    })
  }

  /**
   * Cleanup all views on shutdown.
   */
  destroy(): void {
    for (const [tabId] of this.views) {
      this.closeTab(tabId)
    }
  }
}
