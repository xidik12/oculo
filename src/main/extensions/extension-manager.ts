/**
 * ExtensionManager — loads and manages Chrome extensions in Electron.
 *
 * Scans ~/.oculo/extensions/ for unpacked Chrome extensions and loads them
 * via session.extensions.loadExtension(). Supports MetaMask and other
 * Manifest V2/V3 extensions.
 *
 * Limitations (Electron):
 * - Only unpacked extensions (no .crx, no Chrome Web Store)
 * - chrome.storage.sync is not supported (use chrome.storage.local)
 * - Must reload on every app start (extensions don't persist across sessions)
 */
import { session as electronSession, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  path: string
  enabled: boolean
  manifest: any
  hasPopup: boolean
  popupPage: string | null
  icons: Record<string, string>
}

interface ExtensionConfig {
  /** Map of extension directory name to enabled state */
  extensions: Record<string, { enabled: boolean }>
}

const EXTENSIONS_DIR = path.join(os.homedir(), '.oculo', 'extensions')
const CONFIG_FILE = path.join(EXTENSIONS_DIR, 'config.json')

export class ExtensionManager {
  private session: Electron.Session
  private loaded = new Map<string, ExtensionInfo>()
  private config: ExtensionConfig = { extensions: {} }
  private mainWindow: BrowserWindow | null = null

  constructor(sess: Electron.Session, mainWindow?: BrowserWindow) {
    this.session = sess
    this.mainWindow = mainWindow ?? null
    this.ensureExtensionsDir()
    this.loadConfig()
  }

  /** Ensure ~/.oculo/extensions/ exists */
  private ensureExtensionsDir(): void {
    try {
      if (!fs.existsSync(EXTENSIONS_DIR)) {
        fs.mkdirSync(EXTENSIONS_DIR, { recursive: true })
        console.log('[Extensions] Created extensions directory:', EXTENSIONS_DIR)
      }
    } catch (err) {
      console.error('[Extensions] Failed to create extensions directory:', err)
    }
  }

  /** Load config from disk */
  private loadConfig(): void {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
        this.config = JSON.parse(raw)
      }
    } catch (err) {
      console.warn('[Extensions] Failed to load config, using defaults:', err)
      this.config = { extensions: {} }
    }
  }

  /** Save config to disk */
  private saveConfig(): void {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Extensions] Failed to save config:', err)
    }
  }

  /** Check if a directory contains a valid Chrome extension */
  private isValidExtension(dirPath: string): boolean {
    const manifestPath = path.join(dirPath, 'manifest.json')
    if (!fs.existsSync(manifestPath)) return false
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      return !!(manifest.name && manifest.manifest_version)
    } catch {
      return false
    }
  }

  /** Read manifest.json from extension directory */
  private readManifest(dirPath: string): any {
    const manifestPath = path.join(dirPath, 'manifest.json')
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  }

  /**
   * Inject polyfills into extension background scripts for missing Electron APIs.
   * Creates a _polyfills.js file in the extension directory and prepends it to
   * the background scripts list in manifest.json.
   */
  private injectPolyfills(extPath: string, manifest: any): void {
    const polyfillFilename = 'oculo-polyfills.js'
    const polyfillPath = path.join(extPath, polyfillFilename)
    const manifestPath = path.join(extPath, 'manifest.json')

    // Polyfill content -- provides missing APIs that MetaMask and other MV3 extensions need
    const polyfillCode = `
// Oculo Polyfills — provides missing Electron extension APIs
(function() {
  'use strict';

  // requestAnimationFrame / cancelAnimationFrame (missing in service worker context)
  if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = function(cb) { return setTimeout(cb, 16); };
  }
  if (typeof globalThis.cancelAnimationFrame === 'undefined') {
    globalThis.cancelAnimationFrame = function(id) { clearTimeout(id); };
  }

  // chrome.windows polyfill (Electron doesn't support chrome.windows)
  if (typeof chrome !== 'undefined' && !chrome.windows) {
    chrome.windows = {
      WINDOW_ID_NONE: -1,
      WINDOW_ID_CURRENT: -2,
      onRemoved: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
      onCreated: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
      onFocusChanged: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
      onBoundsChanged: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
      getAll: function(opts, cb) { if (cb) cb([]); return Promise.resolve([]); },
      get: function(id, opts, cb) { var w = {id: 1, focused: true, type: 'normal', state: 'normal'}; if (cb) cb(w); return Promise.resolve(w); },
      getCurrent: function(opts, cb) { var w = {id: 1, focused: true, type: 'normal', state: 'normal'}; if (cb) cb(w); return Promise.resolve(w); },
      getLastFocused: function(opts, cb) { var w = {id: 1, focused: true, type: 'normal', state: 'normal'}; if (cb) cb(w); return Promise.resolve(w); },
      create: function(opts, cb) { var w = {id: Date.now(), focused: true, type: 'normal', state: 'normal'}; if (cb) cb(w); return Promise.resolve(w); },
      update: function(id, opts, cb) { var w = {id: id, focused: true, type: 'normal', state: 'normal'}; if (cb) cb(w); return Promise.resolve(w); },
      remove: function(id, cb) { if (cb) cb(); return Promise.resolve(); }
    };
  }

  // chrome.notifications polyfill
  if (typeof chrome !== 'undefined' && !chrome.notifications) {
    chrome.notifications = {
      create: function(id, opts, cb) { if (cb) cb(id || 'notif_' + Date.now()); return Promise.resolve(); },
      update: function(id, opts, cb) { if (cb) cb(true); return Promise.resolve(); },
      clear: function(id, cb) { if (cb) cb(true); return Promise.resolve(); },
      getAll: function(cb) { if (cb) cb({}); return Promise.resolve({}); },
      onClicked: { addListener: function() {}, removeListener: function() {} },
      onClosed: { addListener: function() {}, removeListener: function() {} },
      onButtonClicked: { addListener: function() {}, removeListener: function() {} }
    };
  }

  // chrome.identity polyfill
  if (typeof chrome !== 'undefined' && !chrome.identity) {
    chrome.identity = {
      getAuthToken: function(opts, cb) { if (cb) cb(undefined); return Promise.resolve(); },
      launchWebAuthFlow: function(opts, cb) { if (cb) cb(undefined); return Promise.resolve(); },
      getRedirectURL: function() { return 'https://localhost'; }
    };
  }

  // chrome.cookies polyfill
  if (typeof chrome !== 'undefined' && !chrome.cookies) {
    chrome.cookies = {
      get: function(details, cb) { if (cb) cb(null); return Promise.resolve(null); },
      getAll: function(details, cb) { if (cb) cb([]); return Promise.resolve([]); },
      set: function(details, cb) { if (cb) cb(null); return Promise.resolve(null); },
      remove: function(details, cb) { if (cb) cb(null); return Promise.resolve(null); },
      onChanged: { addListener: function() {}, removeListener: function() {} }
    };
  }

  // chrome.sidePanel polyfill
  if (typeof chrome !== 'undefined' && !chrome.sidePanel) {
    chrome.sidePanel = {
      setOptions: function() { return Promise.resolve(); },
      setPanelBehavior: function() { return Promise.resolve(); },
      getOptions: function() { return Promise.resolve({}); },
      open: function() { return Promise.resolve(); }
    };
  }

  console.log('[Oculo Polyfills] Injected missing Chrome APIs');
})();
`

    try {
      // Write polyfill file
      fs.writeFileSync(polyfillPath, polyfillCode, 'utf-8')

      let modified = false

      // For MV3 (service_worker background)
      if (manifest.background?.service_worker) {
        // Prepend polyfill code directly into the service worker file
        const swPath = path.join(extPath, manifest.background.service_worker)
        if (fs.existsSync(swPath)) {
          const originalCode = fs.readFileSync(swPath, 'utf-8')
          if (!originalCode.includes('Oculo Polyfills')) {
            fs.writeFileSync(swPath, polyfillCode + '\n' + originalCode, 'utf-8')
            modified = true
          }
        }
      }

      // For MV3 background scripts array
      if (manifest.background?.scripts && Array.isArray(manifest.background.scripts)) {
        if (!manifest.background.scripts.includes(polyfillFilename)) {
          manifest.background.scripts.unshift(polyfillFilename)
          modified = true
        }
      }

      // For MV2 background scripts
      if (manifest.background?.scripts && !manifest.background?.service_worker) {
        if (!manifest.background.scripts.includes(polyfillFilename)) {
          manifest.background.scripts.unshift(polyfillFilename)
          modified = true
        }
      }

      if (modified) {
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
        console.log('[Extensions] Injected polyfills for:', manifest.name || path.basename(extPath))
      }
    } catch (err) {
      console.warn('[Extensions] Failed to inject polyfills:', err)
    }
  }

  /** Get the popup page from manifest */
  private getPopupPage(manifest: any): string | null {
    // Manifest V3
    if (manifest.action?.default_popup) return manifest.action.default_popup
    // Manifest V2
    if (manifest.browser_action?.default_popup) return manifest.browser_action.default_popup
    if (manifest.page_action?.default_popup) return manifest.page_action.default_popup
    return null
  }

  /** Get extension icons from manifest */
  private getIcons(manifest: any): Record<string, string> {
    // Manifest V3
    if (manifest.action?.default_icon) {
      if (typeof manifest.action.default_icon === 'string') {
        return { '128': manifest.action.default_icon }
      }
      return manifest.action.default_icon
    }
    // Manifest V2
    if (manifest.browser_action?.default_icon) {
      if (typeof manifest.browser_action.default_icon === 'string') {
        return { '128': manifest.browser_action.default_icon }
      }
      return manifest.browser_action.default_icon
    }
    // Fallback to top-level icons
    if (manifest.icons) return manifest.icons
    return {}
  }

  /**
   * Scan extensions directory and load all enabled extensions.
   * Called on app startup after session permission handlers are configured.
   */
  async loadAll(): Promise<void> {
    console.log('[Extensions] Scanning:', EXTENSIONS_DIR)

    let entries: string[]
    try {
      entries = fs.readdirSync(EXTENSIONS_DIR)
    } catch (err) {
      console.warn('[Extensions] Cannot read extensions directory:', err)
      return
    }

    let loadedCount = 0
    for (const entry of entries) {
      // Skip config.json and hidden files
      if (entry === 'config.json' || entry.startsWith('.')) continue

      const extPath = path.join(EXTENSIONS_DIR, entry)
      const stat = fs.statSync(extPath)
      if (!stat.isDirectory()) continue

      if (!this.isValidExtension(extPath)) {
        console.warn(`[Extensions] Skipping invalid extension: ${entry}`)
        continue
      }

      // Check if extension is disabled in config
      const configEntry = this.config.extensions[entry]
      if (configEntry && configEntry.enabled === false) {
        console.log(`[Extensions] Skipping disabled extension: ${entry}`)
        continue
      }

      try {
        await this.loadExtension(extPath)
        loadedCount++
      } catch (err) {
        console.error(`[Extensions] Failed to load extension "${entry}":`, err)
      }
    }

    console.log(`[Extensions] Loaded ${loadedCount} extension(s)`)
  }

  /**
   * Load a single extension from a directory path.
   * Returns the extension info on success.
   */
  async loadExtension(extPath: string): Promise<ExtensionInfo> {
    const resolvedPath = path.resolve(extPath)

    if (!this.isValidExtension(resolvedPath)) {
      throw new Error(`Invalid extension at ${resolvedPath}: missing or invalid manifest.json`)
    }

    const manifest = this.readManifest(resolvedPath)
    const dirName = path.basename(resolvedPath)

    console.log(`[Extensions] Loading: ${manifest.name} v${manifest.version || '0.0.0'} (${dirName})`)

    // Inject polyfills for APIs that Electron doesn't provide
    // This fixes MetaMask and other MV3 extensions that crash without these APIs
    this.injectPolyfills(resolvedPath, manifest)

    // Use Electron's session extension API
    const ext = await this.session.loadExtension(resolvedPath, {
      allowFileAccess: true
    })

    const popupPage = this.getPopupPage(manifest)
    const icons = this.getIcons(manifest)

    const info: ExtensionInfo = {
      id: ext.id,
      name: ext.name || manifest.name,
      version: manifest.version || '0.0.0',
      path: resolvedPath,
      enabled: true,
      manifest,
      hasPopup: !!popupPage,
      popupPage,
      icons
    }

    this.loaded.set(ext.id, info)

    // Update config
    this.config.extensions[dirName] = { enabled: true }
    this.saveConfig()

    console.log(`[Extensions] Loaded: ${info.name} (${info.id})`)
    return info
  }

  /**
   * Remove (unload) an extension by its ID.
   */
  async removeExtension(id: string): Promise<boolean> {
    const info = this.loaded.get(id)
    if (!info) return false

    try {
      await this.session.removeExtension(id)
    } catch (err) {
      console.warn(`[Extensions] Error removing extension "${info.name}":`, err)
    }

    // Update config to mark as disabled
    const dirName = path.basename(info.path)
    this.config.extensions[dirName] = { enabled: false }
    this.saveConfig()

    this.loaded.delete(id)
    console.log(`[Extensions] Removed: ${info.name}`)
    return true
  }

  /**
   * Toggle an extension's enabled state.
   * If currently loaded, removes it. If not loaded, loads it.
   */
  async toggleExtension(id: string): Promise<ExtensionInfo | null> {
    const info = this.loaded.get(id)

    if (info) {
      // Currently loaded — disable it
      await this.removeExtension(id)
      return null
    }

    // Extension not loaded — find it in config and load
    for (const [dirName, cfg] of Object.entries(this.config.extensions)) {
      const extPath = path.join(EXTENSIONS_DIR, dirName)
      if (!fs.existsSync(extPath) || !this.isValidExtension(extPath)) continue

      const manifest = this.readManifest(extPath)
      // Try to match by directory name since we don't know the ID before loading
      // The caller should use the directory-level toggle mechanism
      try {
        const loaded = await this.loadExtension(extPath)
        if (loaded.id === id) return loaded
      } catch {
        // Not this one
      }
    }

    return null
  }

  /**
   * Get list of all known extensions (loaded and disabled).
   */
  getExtensions(): ExtensionInfo[] {
    const result: ExtensionInfo[] = [...this.loaded.values()]

    // Also include disabled extensions from config
    for (const [dirName, cfg] of Object.entries(this.config.extensions)) {
      if (cfg.enabled) continue // Already in loaded map

      const extPath = path.join(EXTENSIONS_DIR, dirName)
      if (!fs.existsSync(extPath) || !this.isValidExtension(extPath)) continue

      try {
        const manifest = this.readManifest(extPath)
        result.push({
          id: `disabled:${dirName}`,
          name: manifest.name || dirName,
          version: manifest.version || '0.0.0',
          path: extPath,
          enabled: false,
          manifest,
          hasPopup: !!this.getPopupPage(manifest),
          popupPage: this.getPopupPage(manifest),
          icons: this.getIcons(manifest)
        })
      } catch { /* skip broken extensions */ }
    }

    return result
  }

  /**
   * Open an extension's popup window (e.g., MetaMask popup).
   */
  openPopup(id: string, parentWindow?: BrowserWindow): BrowserWindow | null {
    const info = this.loaded.get(id)
    if (!info || !info.hasPopup || !info.popupPage) {
      console.warn(`[Extensions] No popup for extension: ${id}`)
      return null
    }

    const popupUrl = `chrome-extension://${id}/${info.popupPage}`
    console.log(`[Extensions] Opening popup: ${popupUrl}`)

    const parent = parentWindow || this.mainWindow
    const popup = new BrowserWindow({
      width: 360,
      height: 600,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      title: info.name,
      parent: parent ?? undefined,
      modal: false,
      autoHideMenuBar: true,
      webPreferences: {
        session: this.session,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    popup.loadURL(popupUrl)

    // Clean UA in popup
    const popupUA = popup.webContents.getUserAgent()
    popup.webContents.setUserAgent(
      popupUA.replace(/\s*Electron\/[\d.]+/, '').replace(/\s*oculo\/[\d.]+/i, '')
    )

    return popup
  }

  /**
   * Install a new extension from a directory path.
   * Copies to ~/.oculo/extensions/ if not already there.
   */
  async installExtension(sourcePath: string): Promise<ExtensionInfo> {
    const resolvedSource = path.resolve(sourcePath)

    if (!this.isValidExtension(resolvedSource)) {
      throw new Error(`Invalid extension at ${resolvedSource}: missing or invalid manifest.json`)
    }

    const manifest = this.readManifest(resolvedSource)
    const safeName = (manifest.name || path.basename(resolvedSource))
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')

    const destPath = path.join(EXTENSIONS_DIR, safeName)

    // If source is already inside EXTENSIONS_DIR, just load it
    if (resolvedSource.startsWith(EXTENSIONS_DIR)) {
      return this.loadExtension(resolvedSource)
    }

    // Copy to extensions directory
    if (fs.existsSync(destPath)) {
      // Remove existing to allow updates
      fs.rmSync(destPath, { recursive: true, force: true })
    }
    this.copyDir(resolvedSource, destPath)

    return this.loadExtension(destPath)
  }

  /** Recursively copy a directory */
  private copyDir(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true })
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      if (entry.isDirectory()) {
        this.copyDir(srcPath, destPath)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  /**
   * Get the extensions directory path.
   */
  getExtensionsDir(): string {
    return EXTENSIONS_DIR
  }

  /**
   * Set up IPC handlers for extension management.
   */
  setupIPC(): void {
    ipcMain.handle('extensions:list', async () => {
      return this.getExtensions()
    })

    ipcMain.handle('extensions:install', async (_, extPath: string) => {
      try {
        // If no path provided, open a directory picker
        if (!extPath && this.mainWindow) {
          const result = await dialog.showOpenDialog(this.mainWindow, {
            title: 'Select Extension Directory',
            properties: ['openDirectory'],
            message: 'Select the unpacked Chrome extension folder'
          })
          if (result.canceled || !result.filePaths[0]) {
            return { success: false, error: 'Cancelled' }
          }
          extPath = result.filePaths[0]
        }
        const info = await this.installExtension(extPath)
        return { success: true, extension: info }
      } catch (err: any) {
        console.error('[Extensions] Install error:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('extensions:remove', async (_, id: string) => {
      const success = await this.removeExtension(id)
      return { success }
    })

    ipcMain.handle('extensions:toggle', async (_, id: string) => {
      try {
        const info = this.loaded.get(id)
        if (info) {
          // Currently loaded — disable
          await this.removeExtension(id)
          return { success: true, enabled: false }
        }

        // Not loaded — find by disabled ID pattern or by directory name scan
        // Try to find and load the extension
        const dirName = id.startsWith('disabled:') ? id.replace('disabled:', '') : id
        const extPath = path.join(EXTENSIONS_DIR, dirName)

        if (fs.existsSync(extPath) && this.isValidExtension(extPath)) {
          const loaded = await this.loadExtension(extPath)
          return { success: true, enabled: true, extension: loaded }
        }

        return { success: false, error: 'Extension not found' }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('extensions:open-folder', async () => {
      this.ensureExtensionsDir()
      await shell.openPath(EXTENSIONS_DIR)
      return { success: true }
    })

    ipcMain.handle('extensions:open-popup', async (_, id: string) => {
      const popup = this.openPopup(id)
      return { success: !!popup }
    })
  }
}
